/**
 * 秒杀档期 store（deals 表）
 * ═════════════════════
 *
 * 一次读全表，按 sku 建索引。档期数量是"商品数的若干倍"但不是"每次渲染都要的
 * 数据"，所以和 products 分开缓存：页面只订阅，不重复请求。
 *
 * 没跑 `16-deals.sql` 时全部退回空 Map —— 前台照旧读 products 上那五个旧列，
 * 行为等于这次改造之前。
 */

import { isConfigured, requireClient } from '../lib/supabase.js'
import { slotOf } from '../utils/dealSlots.js'

let slotsBySku = {}
/* 原始行（带 id），档期面板要靠它改 / 删。 */
let rows = []
let status = isConfigured ? 'idle' : 'ready'
let inflight = null
const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

export function getDealSlots() {
  return slotsBySku
}

export function getDealRows() {
  return rows
}

export function getDealSlotsStatus() {
  return status
}

export function subscribeDealSlots(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function isMissingTable(error) {
  return /does not exist|42P01|not find the table/i.test(String(error?.message || ''))
}

/** 行 → sku 索引。一次遍历，前台每次渲染只做一次 Map 查询。 */
export function indexSlots(rows) {
  const map = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const slot = slotOf(row)
    if (!slot || !slot.sku) continue
    ;(map[slot.sku] ||= []).push(slot)
  }
  return map
}

export async function loadDealSlots({ silent = false } = {}) {
  if (!isConfigured) return slotsBySku
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    const { data, error } = await requireClient()
      .from('deals')
      .select('id, sku, sale_start, sale_end, sale_price, original_price, is_campaign, sub_tag')
      .order('sale_start', { ascending: false })

    if (error) {
      status = isMissingTable(error) ? 'missing' : status === 'idle' ? 'ready' : status
      notify()
      return slotsBySku
    }

    rows = Array.isArray(data) ? data : []
    slotsBySku = indexSlots(rows)
    status = 'ready'
    notify()
    return slotsBySku
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** 改一条档期（只允许改时间 / 价格 —— sku 是关联键，不动）。 */
export async function updateDealSlot(id, patch) {
  if (!id) throw new Error("缺少档期 id")

  const payload = { updated_at: new Date().toISOString() }
  if (patch.saleStart !== undefined) payload.sale_start = patch.saleStart
  if (patch.saleEnd !== undefined) payload.sale_end = patch.saleEnd
  if (patch.salePrice !== undefined) payload.sale_price = patch.salePrice || null
  if (patch.originalPrice !== undefined) payload.original_price = patch.originalPrice || null
  if (patch.isCampaign !== undefined) payload.is_campaign = Boolean(patch.isCampaign)
  if (patch.subTag !== undefined) payload.sub_tag = patch.subTag || ''

  const { error } = await requireClient().from('deals').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
  await loadDealSlots({ silent: true })
}

/** 删掉一条档期。 */
export async function deleteDealSlot(id) {
  const { error } = await requireClient().from('deals').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await loadDealSlots({ silent: true })
}

/** 批量删掉所有已经结束的档期（清理用）。返回删除条数。 */
export async function deleteEndedDealSlots(now = Date.now()) {
  const cutoff = new Date(now).toISOString()
  const { data, error } = await requireClient()
    .from('deals')
    .delete()
    .lt('sale_end', cutoff)
    .select('id')
  if (error) throw new Error(error.message)
  await loadDealSlots({ silent: true })
  return Array.isArray(data) ? data.length : 0
}

/**
 * 导入：把一批档期写进 deals。
 *
 * 同一 (sku, sale_start, sale_end) 视为同一条 —— 重复导入同一张表不会产生
 * 重复行，也不会报错。
 *
 * @param {Array<{sku:string, saleStart:string, saleEnd:string, salePrice:string, originalPrice:string, isCampaign?:boolean, subTag?:string}>} rows
 * @returns {Promise<number>} 写入的行数
 */
export async function appendDealSlots(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.sku)
  if (!list.length) return 0

  const { error } = await requireClient()
    .from('deals')
    .upsert(
      list.map((row) => ({
        sku: String(row.sku).trim(),
        sale_start: row.saleStart,
        sale_end: row.saleEnd,
        sale_price: row.salePrice || null,
        original_price: row.originalPrice || null,
        is_campaign: Boolean(row.isCampaign),
        sub_tag: row.subTag || '',
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'sku,sale_start,sale_end' },
    )

  if (error) {
    if (isMissingTable(error)) {
      status = 'missing'
      notify()
      throw new Error('deals 表不存在。先在 Supabase 跑一次 supabase/16-deals.sql。')
    }
    throw new Error(error.message)
  }

  await loadDealSlots({ silent: true })
  return list.length
}
