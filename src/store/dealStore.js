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
/* 最近一次加载失败的原因：界面上直接显示，避免把「缺列」误报成「缺表」。 */
let lastError = ''
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

export function getDealSlotsError() {
  return lastError
}

export function getDealSlotsStatus() {
  return status
}

export function subscribeDealSlots(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* 本地时间串（2026-11-20T10:00，后台输入框的格式）→ ISO；已经是 ISO 的原样返回。 */
function toIso(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function toNumberOrNull(value) {
  const text = String(value ?? '').replace(/[^0-9.-]/g, '').trim()
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function isMissingTable(error) {
  const message = String(error?.message || '')
  /* `column ... does not exist` 也会命中 "does not exist"，但那是缺**列**，
   * 不是缺表 —— 早前就是这样把「没跑 18」误报成「没跑 16」的。 */
  if (/column .* does not exist/i.test(message)) return false
  return /relation .*deals.* does not exist|42P01|not find the table/i.test(message)
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
      .select('id, sku, sale_start, sale_end, sale_price, original_price, is_campaign, sub_tag, discount_label')
      .order('sale_start', { ascending: false })

    if (error) {
      lastError = String(error.message || '')
      status = isMissingTable(error) ? 'missing' : status === 'idle' ? 'ready' : status
      notify()
      return slotsBySku
    }

    rows = Array.isArray(data) ? data : []
    slotsBySku = indexSlots(rows)
    lastError = ''
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
  if (patch.discountLabel !== undefined) payload.discount_label = patch.discountLabel || ''

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

/**
 * 按货号批量删档期 —— "批量清空秒杀"必须连 `deals` 一起清，
 * 否则商品行的窗口没了、档期表还留着，前台会继续按旧档期显示价格。
 *
 * @param {string[]} skus
 * @returns {Promise<number>} 删除条数
 */
export async function deleteDealSlotsBySku(skus) {
  const list = (Array.isArray(skus) ? skus : [skus])
    .map((sku) => String(sku ?? '').trim())
    .filter(Boolean)
  if (!list.length) return 0

  const { data, error } = await requireClient()
    .from('deals')
    .delete()
    .in('sku', list)
    .select('id')
  if (error) throw new Error(error.message)
  await loadDealSlots({ silent: true })
  return Array.isArray(data) ? data.length : 0
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
 * 把折扣文案写回**商品行**（`products.discount_label`）。
 *
 * 档期页改了折扣时两边都要写：档期表是前台的权威来源，商品行是后台列表/
 * 编辑器显示的那一份。少写一边，就会一边新一边旧。
 */
export async function setProductDiscountLabel(id, label) {
  if (!id) return
  const { error } = await requireClient()
    .from('products')
    .update({ discount_label: String(label || '') })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * 一次性迁移：把商品行上现有的秒杀窗口搬进 `deals`。
 *
 * `deals` 表是后加的，之前导入过的秒杀只写在 products 的 sale_* 列上 ——
 * 所以档期面板一开始是空的。这个函数把它们复制过来（幂等：同一窗口重复
 * 写入会被 upsert 合并），运营点一次按钮就行。
 *
 * @returns {Promise<number>} 迁移的档期条数
 */
export async function importProductDeals() {
  const { data, error } = await requireClient()
    .from('products')
    .select('sku, sale_start, sale_end, sale_price, original_price, is_campaign, sub_tag, discount_label')
    .not('sale_start', 'is', null)
    .not('sale_end', 'is', null)

  if (error) throw new Error(error.message)

  const rows = (Array.isArray(data) ? data : [])
    .filter((row) => Boolean(String(row.sku || "").trim() && row.sale_start && row.sale_end))
    .map((row) => ({
      sku: row.sku,
      saleStart: row.sale_start,
      saleEnd: row.sale_end,
      salePrice: row.sale_price == null ? "" : String(row.sale_price),
      originalPrice: row.original_price == null ? "" : String(row.original_price),
      isCampaign: row.is_campaign === true,
      subTag: row.sub_tag || "",
      discountLabel: row.discount_label || "",
    }))

  if (!rows.length) return 0
  await appendDealSlots(rows)
  return rows.length
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
        sale_start: toIso(row.saleStart),
        sale_end: toIso(row.saleEnd),
        sale_price: toNumberOrNull(row.salePrice),
        original_price: toNumberOrNull(row.originalPrice),
        is_campaign: Boolean(row.isCampaign),
        sub_tag: row.subTag || '',
        discount_label: row.discountLabel || '',
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

    /* 缺唯一索引时 PostgREST 会拒绝 upsert（"no unique or exclusion constraint
     * matching the ON CONFLICT specification"）。这时退回普通 insert：数据先
     * 落地，重复导入最多多出一行，比"什么都没写进去"好得多。 */
    if (/unique|exclusion constraint|ON CONFLICT/i.test(String(error.message || ''))) {
      const fallback = await requireClient()
        .from('deals')
        .insert(
          list.map((row) => ({
            sku: String(row.sku).trim(),
            sale_start: toIso(row.saleStart),
            sale_end: toIso(row.saleEnd),
            sale_price: toNumberOrNull(row.salePrice),
            original_price: toNumberOrNull(row.originalPrice),
            is_campaign: Boolean(row.isCampaign),
            sub_tag: row.subTag || '',
            discount_label: row.discountLabel || '',
          })),
        )
      if (fallback.error) throw new Error(fallback.error.message)
      await loadDealSlots({ silent: true })
      return list.length
    }

    throw new Error(error.message)
  }

  await loadDealSlots({ silent: true })
  return list.length
}
