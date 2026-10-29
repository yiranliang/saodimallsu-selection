/**
 * Product store
 * ══════════════════════════════════════════════════════════
 * Single source of truth for the catalogue at runtime.
 *
 * WHY A STORE AND NOT DIRECT QUERIES
 * Every consumer — cards, detail sheet, encoder, decoder — must read the SAME
 * list, otherwise a code would be encoded against one catalogue and decoded
 * against another. So the network result lands in one cache and everything
 * subscribes to it.
 *
 * READS ARE SYNCHRONOUS, WRITES ARE ASYNC
 * `getProducts()` returns the cache. That keeps `utils/code.js` untouched: the
 * v3/v4 encoder and decoder are pure functions over a product array and must
 * not learn about promises. `loadProducts()` fills the cache; `createProduct`
 * and friends write to Postgres and patch the cache.
 *
 * NO LOCALSTORAGE
 * The catalogue lives in Supabase. The only local fallback is the shipped
 * `data/products.js`, and only when Supabase is not configured at all (Node
 * scripts, or a fresh clone before `.env` exists).
 */

import { supabase, isConfigured, requireClient } from '../lib/supabase.js'
import { products as DEFAULT_PRODUCTS } from '../data/products.js'
import { normalizeProduct, rowToProduct, productToRow, UNCATEGORISED } from './mapping.js'
import { normaliseBadgeColor } from '../utils/badge.js'
import { BATCH_CHUNK, chunk } from '../utils/batchOps.js'
import { dropsCampaignTag } from '../utils/deal.js'

export { UNCATEGORISED }

/** idle → loading → ready | error */
let status = isConfigured ? 'idle' : 'ready'
let lastError = ''

/** Shipped data is only a fallback for the unconfigured case. */
let cache = isConfigured ? [] : DEFAULT_PRODUCTS.map(normalizeProduct)

/** id → sort_order, kept out of the product object so exports stay clean. */
const orderById = new Map()

const listeners = new Set()
const statusListeners = new Set()
let inflight = null

function notify() {
  listeners.forEach((fn) => fn())
  statusListeners.forEach((fn) => fn())
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function getProducts() {
  return cache
}

export function getCatalogueStatus() {
  return status
}

export function getCatalogueError() {
  return lastError
}

export function subscribeProducts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function subscribeCatalogueStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/* Optional columns arrived with later scripts:
 *   sold_out_variants → supabase/05-sold-out.sql
 *   badge_color       → supabase/07-badge-color.sql
 *
 * Shipping the app before one of those runs must not take the storefront down —
 * a missing column fails the whole `select`, not just that field. So the first
 * query asks for everything, and whichever column is missing is dropped from the
 * column list and the query retried. Same tolerance `linkStore` gives a missing
 * `product_links` view.
 *
 * WRITES respect the same discovery: `badgeColumnAvailable` stays false until a
 * select actually returned the column, and `rowFor()` strips it from every write
 * payload until then. Without that, every save would fail with "column
 * badge_color does not exist" — and losing the ability to edit products is a far
 * worse outcome than losing the badge colour for a few minutes. */
const BASE_COLUMNS = 'id, sku, name, category, image, specs, variant_images, hidden, tag, sort_order'
/* Five separate columns for one feature: a database that has run 09-deal.sql
 * has all five, and one that has not has none, so they are discovered (and
 * stripped from writes) individually like every other optional column. The
 * cost of that granularity is up to five extra probe attempts on a stale
 * database — paid once per page load, and only until the migration is run. */
const DEAL_COLUMNS = ['sale_start', 'sale_end', 'sale_price', 'original_price', 'discount_label']
/* ACC is two columns that always arrive together (10-acc.sql adds both), so it
 * gets one status like the deal card: "is the switch storable" is one question. */
const ACC_COLUMNS = ['acc_id', 'has_acc']
/* 副角标两列总是成对出现（11-*.sql 一条语句加两列），所以和 ACC 一样用
 * 一个状态问一次"副角标能不能存"。置顶权重单独一列：它和副角标是同一个
 * 迁移，但语义无关 —— 一个数据库跑到一半（只加了 sub_*）也该让置顶降级
 * 而不是整块失效。 */
const SUB_BADGE_COLUMNS = ['sub_tag', 'sub_badge_color']
const OPTIONAL_COLUMNS = [
  'sold_out_variants',
  'badge_color',
  'is_teaser',
  ...DEAL_COLUMNS,
  ...ACC_COLUMNS,
  ...SUB_BADGE_COLUMNS,
  'deal_priority',
]

/* What an absent optional column means for the operator, and the SQL that adds
 * it. Kept next to the list so a new optional column cannot ship without an
 * honest warning. */
const ABSENT_HINTS = {
  sold_out_variants: { meaning: '「全部有货」', sql: 'supabase/05-sold-out.sql' },
  badge_color: { meaning: '「角标无自定义颜色」', sql: 'supabase/07-badge-color.sql' },
  is_teaser: { meaning: '「全部不是预告」', sql: 'supabase/08-teaser.sql' },
  sale_start: { meaning: '「全部没有秒杀」', sql: 'supabase/09-deal.sql' },
  sale_end: { meaning: '「全部没有秒杀」', sql: 'supabase/09-deal.sql' },
  sale_price: { meaning: '「全部没有秒杀」', sql: 'supabase/09-deal.sql' },
  original_price: { meaning: '「全部没有秒杀」', sql: 'supabase/09-deal.sql' },
  discount_label: { meaning: '「全部没有秒杀」', sql: 'supabase/09-deal.sql' },
  acc_id: { meaning: '「全部没有 ACC 佣金」', sql: 'supabase/10-acc.sql' },
  has_acc: { meaning: '「全部没有 ACC 佣金」', sql: 'supabase/10-acc.sql' },
  sub_tag: { meaning: '「全部没有副角标」', sql: 'supabase/11-sub-badge-deal-priority.sql' },
  sub_badge_color: { meaning: '「全部没有副角标」', sql: 'supabase/11-sub-badge-deal-priority.sql' },
  deal_priority: { meaning: '「秒杀专区全部不置顶」', sql: 'supabase/11-sub-badge-deal-priority.sql' },
}

/** Columns the database turned out not to have (yet). */
const missingColumns = new Set()
let badgeColumnAvailable = false
/* Tri-state: 'unknown' until a read has actually answered the question. The
 * admin UI reads this so a picked badge colour cannot silently vanish — see
 * `getBadgeColumnStatus` below. */
let badgeColumnStatus = 'unknown'
let teaserColumnAvailable = false
let teaserColumnStatus = 'unknown'
let dealColumnStatus = 'unknown'
let accColumnAvailable = false
let accColumnStatus = 'unknown'
let subBadgeAvailable = false
let subBadgeStatus = 'unknown'
let priorityColumnAvailable = false
let priorityColumnStatus = 'unknown'
/* Five missing columns would otherwise print five identical warnings on every
 * cold load. One per SQL file is enough to act on. */
const warnedSqlFiles = new Set()

/**
 * Can a badge colour be stored right now?
 *
 * `'missing'` is the honest answer on a database that has not run
 * `supabase/07-badge-color.sql`: the column is stripped from every write, so the
 * colour the admin picked is dropped and the storefront keeps rendering the
 * default charcoal pill. That is a data-loss-shaped bug that looks like a CSS
 * bug, so both the editor and the save toast ask this and say so out loud.
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getBadgeColumnStatus() {
  return badgeColumnStatus
}

/**
 * Can the Coming Soon flag be stored right now?
 *
 * Same shape as `getBadgeColumnStatus`: `'missing'` means
 * `supabase/08-teaser.sql` has not been run, the column is stripped from every
 * write, and the editor must say so instead of letting the switch look saved.
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getTeaserColumnStatus() {
  return teaserColumnStatus
}

/**
 * Can the flash-sale fields be stored right now?
 *
 * One status for five columns: the editor shows one card, so it asks one
 * question. `'missing'` means at least one of them is absent — writing that
 * payload is stripped column by column, so a half-migrated database would save
 * three of five fields and look like it worked. The editor says so instead.
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getDealColumnStatus() {
  return dealColumnStatus
}

/**
 * Can the ACC switch be stored right now?
 *
 * `'missing'` means `supabase/10-acc.sql` has not been run: the two columns are
 * stripped from each write, so the switch looks saved and the storefront shows
 * nothing. The editor says so instead of letting it look done.
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getAccColumnStatus() {
  return accColumnStatus
}

/**
 * 副角标（右上角）能不能存？
 *
 * `'missing'` 表示 11-sub-badge-deal-priority.sql 没跑：两列从每次写入里
 * 被剔掉，后台填的副角标会静静消失。和角标颜色同一条逻辑 —— 存不进去就
 * 要当面说，不能让运营以为是前台没渲染。
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getSubBadgeStatus() {
  return subBadgeStatus
}

/**
 * 秒杀专区置顶权重能不能存？单独一个状态，理由见 SUB_BADGE_COLUMNS 的注释。
 *
 * @returns {'unknown' | 'ok' | 'missing'}
 */
export function getPriorityColumnStatus() {
  return priorityColumnStatus
}

/**
 * Monotonic counter, bumped by every local write that changes `sort_order`.
 *
 * WHY IT EXISTS — the bug it kills
 * A SELECT that left before a reorder can land after it. Its payload then
 * describes the order the catalogue had *before* the drop, and applying it
 * snaps the list back to where it started while the database already holds the
 * new order. That reads as "saving a product reset my drag": the save was
 * innocent — it fired a realtime refetch, `loadProducts` handed back the
 * request already in flight from before the reorder (see the `inflight`
 * guard), and that stale response overwrote the cache.
 *
 * So a read records the epoch before it starts, and refuses to apply a payload
 * whose epoch no longer matches: it reads again instead. Two rounds are enough
 * for any human-scale race; the loop is capped so a pathological channel
 * cannot spin forever.
 */
let orderEpoch = 0

/** Rows in `sort_order` order. The query already asks for it — this is the belt
 *  to that braces, so the cache can never depend on PostgREST honouring an
 *  `order` clause (and a hand-edited/legacy response cannot reorder the admin
 *  list either). */
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const diff = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id))
  })
}

function selectColumns() {
  const extra = OPTIONAL_COLUMNS.filter((column) => !missingColumns.has(column))
  return extra.length ? `${BASE_COLUMNS}, ${extra.join(', ')}` : BASE_COLUMNS
}

function queryProducts(columns) {
  return requireClient()
    .from('products')
    .select(columns)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
}

/**
 * Which optional columns does this database actually have?
 *
 * `select('*')` on ONE row answers it in a single request, and it cannot fail:
 * the keys that come back ARE the columns. The obvious alternative — ask for
 * everything, drop the column named in the error, retry — costs one round trip
 * per absent optional column, and a database that has not run 05 / 07 / 08 / 09
 * has SIX of them. Measured on the gate: 21 rejected requests per run became
 * 105 the moment 09-deal.sql added five columns, i.e. five extra round trips
 * before the catalogue lands, on the one screen where a delay is most visible.
 *
 * Returns `null` when the table is empty (no row to read the shape from) — the
 * caller then falls back to the retry loop, which still works.
 *
 * @returns {Promise<Set<string>|null>}
 */
async function probeColumns() {
  const { data, error } = await requireClient().from('products').select('*').limit(1)
  if (error || !Array.isArray(data) || !data.length) return null
  return new Set(Object.keys(data[0]))
}

/** Say which migration is missing — once per SQL file, not once per column. */
function warnAbsent(absent) {
  const hint = ABSENT_HINTS[absent] || { meaning: '默认值', sql: 'supabase/01-schema.sql' }
  if (warnedSqlFiles.has(hint.sql)) return
  warnedSqlFiles.add(hint.sql)
  console.warn(
    `[products] ${absent} 列不存在，本次按${hint.meaning}处理。` +
      `在 Supabase SQL Editor 里跑一次 ${hint.sql} 即可。`,
  )
}

/**
 * One read, retried without any optional column the database does not have.
 * Returns the rows plus the column list that produced them, so the caller knows
 * whether `badge_color` can be written.
 */
async function fetchCatalogueRows() {
  /* One probe first: on a fully migrated database this is the only extra
   * request, and on a stale one it replaces up to six failures with one
   * success. */
  const present = await probeColumns()
  if (present) {
    for (const column of OPTIONAL_COLUMNS) {
      if (present.has(column)) continue
      missingColumns.add(column)
      warnAbsent(column)
    }
  }

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const columns = selectColumns()
    const { data, error } = await queryProducts(columns)
    if (!error) return { data, columns }

    const absent = OPTIONAL_COLUMNS.find(
      (column) => !missingColumns.has(column) && new RegExp(column, 'i').test(error.message),
    )
    if (!absent) throw new Error(error.message)

    missingColumns.add(absent)
    warnAbsent(absent)
  }
  throw new Error('products: no readable column set')
}

/** A write payload the database will accept — optional columns stripped if absent. */
function rowFor(product, options) {
  const row = productToRow(product, options)
  if (!badgeColumnAvailable) delete row.badge_color
  if (!teaserColumnAvailable) delete row.is_teaser
  if (missingColumns.has('sold_out_variants')) delete row.sold_out_variants
  for (const column of DEAL_COLUMNS) if (missingColumns.has(column)) delete row[column]
  if (!accColumnAvailable) {
    delete row.acc_id
    delete row.has_acc
  }
  if (!subBadgeAvailable) {
    delete row.sub_tag
    delete row.sub_badge_color
  }
  if (!priorityColumnAvailable) delete row.deal_priority
  return row
}

/**
 * Fetch the whole catalogue.
 * `silent` keeps the current UI on screen — used by realtime, where flashing a
 * skeleton on every remote edit would be worse than a 200 ms stale view.
 */
export async function loadProducts({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    /* A hydrated grid must never blink back to a skeleton: `loading` is only
     * for "nothing to show yet". A background refresh of an already-painted
     * catalogue keeps status 'ready' and swaps the data underneath. */
    status = cache.length ? 'ready' : 'loading'
    notify()
  }

  inflight = (async () => {
    try {
      /* Read → check → maybe read again. A payload fetched before the epoch
       * moved is a snapshot of the old order, so it is thrown away rather than
       * shown; the second read (issued after the reorder committed) is the one
       * that agrees with the database. */
      let result = { data: [], columns: selectColumns() }
      for (let attempt = 0; attempt < 3; attempt++) {
        const epoch = orderEpoch
        result = await fetchCatalogueRows()
        if (epoch === orderEpoch) break
      }

      const { data, columns } = result
      const rows = sortRows(data || [])
      badgeColumnAvailable = columns.includes('badge_color')
      /* Only now is the question answered — set it before `notify()` so the
       * first render that sees the catalogue also sees the truth. */
      badgeColumnStatus = badgeColumnAvailable ? 'ok' : 'missing'
      teaserColumnAvailable = columns.includes('is_teaser')
      teaserColumnStatus = teaserColumnAvailable ? 'ok' : 'missing'
      /* All five or none: a partially migrated database is exactly the case the
       * editor must refuse to pretend about. */
      dealColumnStatus = DEAL_COLUMNS.every((column) => columns.includes(column)) ? 'ok' : 'missing'
      /* Both columns or neither — 10-acc.sql adds them in one statement. */
      accColumnAvailable = ACC_COLUMNS.every((column) => columns.includes(column))
      accColumnStatus = accColumnAvailable ? 'ok' : 'missing'
      subBadgeAvailable = SUB_BADGE_COLUMNS.every((column) => columns.includes(column))
      subBadgeStatus = subBadgeAvailable ? 'ok' : 'missing'
      priorityColumnAvailable = columns.includes('deal_priority')
      priorityColumnStatus = priorityColumnAvailable ? 'ok' : 'missing'

      cache = rows.map(rowToProduct)
      orderById.clear()
      for (const row of rows) orderById.set(row.id, row.sort_order ?? 0)
      persistCatalogue(rows)

      status = 'ready'
      lastError = ''
    } catch (error) {
      status = 'error'
      lastError = error.message
      throw error
    } finally {
      inflight = null
      notify()
    }
  })()

  return inflight
}

/** Load once, for callers that must not proceed without a catalogue. */
export async function ensureCatalogue() {
  if (status === 'ready' && cache.length) return cache
  await loadProducts({ silent: status === 'ready' })
  return cache
}

/* ── writes ──────────────────────────────────────────────────────────────── */

function sortOrderForNewProduct() {
  let max = -1
  for (const value of orderById.values()) max = Math.max(max, Number(value) || 0)
  return max + 1
}

/**
 * Insert. The id comes from the database sequence (`p140`, `p141`, …) — never
 * from the client, so two admins adding at the same moment cannot collide and
 * a deleted id is never reissued.
 */
export async function createProduct(product) {
  const row = rowFor(product, { sortOrder: sortOrderForNewProduct() })
  delete row.id

  const { data, error } = await requireClient().from('products').insert(row).select().single()
  if (error) throw new Error(error.message)

  cache = [...cache, rowToProduct(data)]
  orderById.set(data.id, data.sort_order ?? 0)
  /* A new product lands at `max + 1`, i.e. last — `resort()` is what enforces
   * that from the data instead of trusting the append. */
  resort()
  return data.id
}

export async function updateProduct(id, patch) {
  const current = cache.find((product) => product.id === id) || {}
  const row = rowFor({ ...current, ...patch }, { id })

  /* A save never moves a row. `productToRow` only emits `sort_order` when the
   * caller passes it explicitly (creation does; an edit does not), and this
   * delete is the belt to that brace: a stale `sort_order` smuggled onto the
   * patch — from a draft, a snapshot, a console call — cannot roll a drag back. */
  delete row.sort_order

  if (!badgeColumnAvailable && row.badge_color === undefined && patch?.badgeColor) {
    /* The UI let a colour be picked on a database that has no column for it. Say
     * so once, instead of quietly losing it on the next reload. */
    console.warn('[products] badge_color 列不存在，角标颜色未保存。先跑 supabase/07-badge-color.sql。')
  }

  if (!teaserColumnAvailable && row.is_teaser === undefined && patch?.isTeaser !== undefined) {
    /* Same shape as the badge warning: the switch looked saved but the column
     * is absent, so the next read comes back as "not a teaser". */
    console.warn('[products] is_teaser 列不存在，Coming Soon 开关未保存。先跑 supabase/08-teaser.sql。')
  }

  /* The editor's own banner covers the common case; this is for the other
   * paths (a console call, an import, a stale tab) where nobody looked at it. */
  const wroteDeal = ['saleStart', 'saleEnd', 'salePrice', 'originalPrice', 'discountLabel'].some(
    (key) => String(patch?.[key] ?? '').trim() !== '',
  )
  if (dealColumnStatus === 'missing' && wroteDeal && !('sale_start' in row)) {
    console.warn('[products] sale_* 列不存在，秒杀信息未保存。先跑 supabase/09-deal.sql。')
  }

  /* Same shape again, for the switch that looks saved but has no column. */
  if (accColumnStatus === 'missing' && !('has_acc' in row) && patch && ('hasAcc' in patch || 'accId' in patch)) {
    console.warn('[products] has_acc / acc_id 列不存在，ACC 开关未保存。先跑 supabase/10-acc.sql。')
  }

  const { data, error } = await requireClient()
    .from('products')
    .update(row)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)

  cache = cache.map((product) => (product.id === id ? rowToProduct(data) : product))
  orderById.set(id, data.sort_order ?? orderById.get(id) ?? 0)
  /* Re-derive the order from `orderById`, which only the reorder writers touch.
   * If a save had moved the row, this line would put it straight back where the
   * drag left it — and if another admin moved it remotely, the fresh
   * `data.sort_order` above is what carries their change. */
  resort()
  return data
}

/**
 * Write the `specs` column and nothing else.
 *
 * Used by the batch import (/#/admin/products → Import), whose whole promise
 * is that an existing product's name / image / category / badge / hidden /
 * sort_order cannot be touched by a sheet. `updateProduct` rebuilds every
 * column from the cached product, which is right for the editor — the editor
 * IS the source of those fields — and wrong for a merge whose input is only
 * colours and sizes. So the payload here is one column wide, by construction.
 *
 * The local cache is refreshed from the returned row, so the list on screen
 * shows the new chips without a reload.
 */
export async function updateProductSpecs(id, specs) {
  const { data, error } = await requireClient()
    .from('products')
    .update({ specs })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)

  cache = cache.map((product) => (product.id === id ? rowToProduct(data) : product))
  notify()
  return data
}

/**
 * Delete for good.
 * Ids are NEVER reassigned — the survivors keep theirs, which is what keeps
 * every code already in the wild valid. The database sequence only ever moves
 * forward, so a deleted id is retired permanently.
 */
export async function deleteProducts(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return

  const { error } = await requireClient().from('products').delete().in('id', list)
  if (error) throw new Error(error.message)

  const drop = new Set(list)
  cache = cache.filter((product) => !drop.has(product.id))
  for (const id of list) orderById.delete(id)
  notify()
}

/**
 * Show / hide without deleting.
 * A hidden product leaves the storefront but stays in the catalogue, so codes
 * already generated still resolve to a name and an image.
 */
export async function setProductsHidden(ids, hidden) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return

  const { error } = await requireClient()
    .from('products')
    .update({ hidden: Boolean(hidden) })
    .in('id', list)

  if (error) throw new Error(error.message)

  const target = new Set(list)
  cache = cache.map((product) => {
    if (!target.has(product.id)) return product
    if (hidden) return { ...product, hidden: true }
    const { hidden: _dropped, ...visible } = product
    return visible
  })
  notify()
}

/**
 * 批量改角标：只写 `tag` + `badge_color`（可选的还有副角标两列）。
 *
 * 为什么不复用 `updateProduct`：它用缓存里的商品重建**整行**，那对编辑器是
 * 正确的（编辑器就是这些字段的主人），对批量是危险的 —— 一次"给十件商品挂
 * Black Friday"不该有机会把秒杀窗口、库存或价格一起写回去（哪怕值一样，
 * 一次网络抖动也会让别的管理员刚改的价格被旧快照覆盖）。
 *
 * `badge_color` 是可选的（07-badge-color.sql）：列不存在时把这一列从 payload
 * 里剔掉再发，宁可只存文字，也不要让整批写失败。文字清空时颜色一并不写，
 * 见 utils/batchBadge.js。
 *
 * `options.sub` 是**可选的副角标**：只有显式传进来才写 `sub_*` 两列。
 * 传 `undefined`（默认）= 完全不碰副角标 —— 这一点很关键，否则"只改主角标"
 * 会顺手清掉运营一早上填好的黑五标识。
 *
 * @param {string[]} ids
 * @param {{ tag?: string, badgeColor?: string }} badge 已由 normaliseBadgeDraft 规整
 * @param {{ sub?: { subTag?: string, subBadgeColor?: string } }} [options]
 * @returns {Promise<number>} 实际提交的 id 数
 */
export async function setProductsBadge(ids, badge, { sub, touchTag = true } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return 0

  const payload = {}
  if (touchTag) {
    const tag = String(badge?.tag ?? '').trim()
    payload.tag = tag
    if (badgeColumnAvailable) {
      payload.badge_color = tag ? normaliseBadgeColor(badge?.badgeColor) || null : null
    }
  }

  const touchSub = sub !== undefined && sub !== null
  if (touchSub) {
    if (subBadgeAvailable) {
      const subTag = String(sub?.subTag ?? '').trim()
      payload.sub_tag = subTag
      payload.sub_badge_color = subTag ? normaliseBadgeColor(sub?.subBadgeColor) || null : null
    } else {
      console.warn(
        '[products] sub_tag / sub_badge_color 列不存在，副角标未保存。先跑 supabase/11-sub-badge-deal-priority.sql。',
      )
    }
  }

  if (touchTag && !badgeColumnAvailable) {
    console.warn('[products] badge_color 列不存在，批量角标只保存了文字。先跑 supabase/07-badge-color.sql。')
  }

  /* 没勾主角标、又没勾副角标 = 什么都不该写。返回 0 而不是发一个空 update
   * （PostgREST 会拒绝空 payload，报一句和现场无关的错）。 */
  if (!Object.keys(payload).length) return 0

  /* 分批：一次 Select all 很容易超过一百件，单条 update 的 in(...) 会把 id
   * 列表拼进查询串，条数一多就是一次没有上限的请求。每批都回传整行，所以
   * 缓存按批刷新，界面在第一批回来时就已经更新。 */
  let written = 0
  for (const part of chunk(list, BATCH_CHUNK)) {
    const { data, error } = await requireClient()
      .from('products')
      .update(payload)
      .in('id', part)
      .select()

    if (error) throw new Error(error.message)

    const patched = new Map((data || []).map((row) => [String(row.id), rowToProduct(row)]))
    cache = cache.map((product) => patched.get(String(product.id)) || product)
    written += part.length
    notify()
  }

  return written
}

/**
 * 批量写秒杀：只写 `sale_start` / `sale_end` / `sale_price` /
 * `original_price` / `discount_label` 五列（以及可选的 `deal_priority`）。
 *
 * 与 `setProductsBadge` 同一个隔离原则：这里的输入只有时间窗和两个价格，
 * 不该有机会把商品名、库存、角标、排序一起写回去。`planDealImport` /
 * `buildDealFromDates` 已经把时间补全成了整天的边界，这里只负责落库。
 *
 * **唯一的例外**：这次写入真的改动了窗口、而商品原来挂着**活动标**
 * （`Black Friday` / `Cyber Monday` / `50% OFF`…）时，`sub_tag` 与
 * `sub_badge_color` 会被一起置空 —— 见 `deal.js` 的 `dropsCampaignTag`。
 * 不清的话，清空秒杀再导新表，货架上显示的还是上一场活动的名字，而表格里
 * 没有"活动标"这一列，运营无从发现。运营自己的标（`NEW` /
 * `Highly Recommend`）不属于活动类，原样保留。
 *
 * `discount_label` 现在会被写入：表格里的「折扣率」比两个价格更权威 ——
 * 尤其是**没有原价**的那种表，除了它没有任何东西能说明便宜了多少。
 * 空值仍然写 null，前台就会退回"从价格算"，算不出来就不显示标签：
 * 一份手工填的文案不该覆盖运营刚改的价格，所以优先级是
 * 「填了就用，没填才算」。
 *
 * `options.priority` 是**可选**的置顶权重：`undefined` = 不动这一列。
 * 0 是有效值（取消置顶），所以不能用 `||` 判断 —— 见 utils/batchOps.js 的
 * `parsePriorityInput`。
 *
 * @param {Array<{ id: string, deal: object|null }>} targets 传 `deal: null` 即清空
 * @param {{ priority?: number }} [options]
 * @returns {Promise<number>} 实际提交的商品数
 */
export async function setProductsDeals(targets, { priority } = {}) {
  const list = (Array.isArray(targets) ? targets : []).filter(
    (t) => t && t.id && (t.deal === null || typeof t.deal === 'object'),
  )
  if (!list.length) return 0

  if (dealColumnStatus === 'missing') {
    /* 与编辑器一致：列没建，宁可整体不写，也不写一个"看起来成功"的半截
     * 秒杀。五个字段一起出，一起进。 */
    throw new Error('sale_* 列不存在，秒杀信息无法写入。先跑 supabase/09-deal.sql。')
  }

  const text = (value) => {
    const t = String(value ?? '').trim()
    return t || null
  }

  const setsPriority =
    priority !== undefined && Number.isFinite(Number(priority))
  const priorityValue = setsPriority ? Math.max(0, Math.trunc(Number(priority))) : 0

  /* 写入前的商品：清活动标要看它当前挂的是什么、窗口到底有没有变。 */
  const byId = new Map(cache.map((product) => [String(product.id), product]))

  /* 两组分开写。PostgREST 的批量 upsert 要求**同一批对象键完全一致**
   * （PGRST102），所以"要清活动标"的行不能和"不动它"的行混在一批：
   * 前者多出 `sub_tag` / `sub_badge_color` 两个键。分开写也顺带保证
   * 不清的那些行连碰都不碰这两列。 */
  const plainRows = []
  const clearRows = []

  for (const { id, deal } of list) {
    const row = {
      id,
      sale_start: text(deal?.saleStart),
      sale_end: text(deal?.saleEnd),
      sale_price: text(deal?.salePrice),
      original_price: text(deal?.originalPrice),
      /* 表格里的折扣率（已由 normaliseDiscountLabel 规整成 `30% OFF`）；
       * 没有就写 null，前台按价格算。关闭秒杀时自然一起清掉。 */
      discount_label: text(deal?.discountLabel),
    }
    if (setsPriority) row.deal_priority = priorityValue

    /* 秒杀一改（或一清），上一场活动的标就该让位 —— 否则货架上显示的是
     * `Black Friday` 而不是 `Limited Deal`，而导入表格里没有"活动标"这一列，
     * 运营根本无从发现（见 deal.js 的 `dropsCampaignTag`）。只清活动类的
     * 文字，`NEW` / `Highly Recommend` 原样保留；副角标列不存在时整段跳过，
     * 因为那个功能此刻本来就没生效。 */
    if (subBadgeAvailable && dropsCampaignTag(byId.get(String(id)), deal || {})) {
      clearRows.push({ ...row, sub_tag: null, sub_badge_color: null })
    } else {
      plainRows.push(row)
    }
  }

  if (setsPriority && !priorityColumnAvailable) {
    for (const row of [...plainRows, ...clearRows]) delete row.deal_priority
    console.warn(
      '[products] deal_priority 列不存在，置顶未保存。先跑 supabase/11-sub-badge-deal-priority.sql。',
    )
  }

  /* 分批 upsert：每批自带 select，回传的行直接刷新缓存 —— 后台列表上的
   * "⚡ 25% OFF" 在第一批回来时就变了，不必等整批。 */
  const write = async (batch) => {
    let done = 0
    for (const part of chunk(batch, BATCH_CHUNK)) {
      const { data, error } = await requireClient()
        .from('products')
        .upsert(part, { onConflict: 'id' })
        .select()

      if (error) throw new Error(error.message)

      if (data) {
        const patched = new Map(data.map((row) => [String(row.id), rowToProduct(row)]))
        cache = cache.map((product) => patched.get(String(product.id)) || product)
      }
      done += part.length
      notify()
    }
    return done
  }

  /* 先写不动角标的那批，再写要清的 —— 两批互不依赖，顺序只是让"常规写入"
   * 先落地，万一第二批失败，第一批的秒杀已经是新的了。 */
  return (await write(plainRows)) + (await write(clearRows))
}

/**
 * 批量清空秒杀（活动结束后的那一下）。等价于 `setProductsDeals` 写五个
 * null，并把置顶一并归零 —— 一个已经结束的窗口留着权重没有意义。
 *
 * @param {string[]} ids
 * @returns {Promise<number>}
 */
export async function clearProductsDeals(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return 0
  return setProductsDeals(
    list.map((id) => ({ id, deal: null })),
    { priority: 0 },
  )
}

/**
 * 批量改分类 —— 按 id 直接写，不复用 `setProductsCategory(from, to)`。
 *
 * 那个函数按**名字**匹配（重命名用），这里选中的是一批 id，可能横跨好几个
 * 原分类；按名字改会把没勾选的商品一起拖下水。
 *
 * `mode = 'fill'` 只动还没有分类的商品（`Uncategorised`）。一个商品只有一
 * 个 category 列（还有 FK 指向 categories.name），所以"追加"不可能真的变成
 * 两个分类 —— 这里的语义是"补空的"，见 utils/batchOps.js 的 CATEGORY_MODES。
 *
 * 调用方必须先保证分类行存在（`addCategory`），否则 FK 会拒绝更新。
 *
 * @param {string[]} ids
 * @param {string} category 已规范化的分类名（存在于 categories 表）
 * @param {'replace'|'fill'} [mode]
 * @returns {Promise<number>} 实际被改动的商品数
 */
export async function setProductsCategoryByIds(ids, category, mode = 'replace') {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  const name = String(category ?? '').trim()
  if (!list.length || !name) return 0

  let changed = 0

  for (const part of chunk(list, BATCH_CHUNK)) {
    let query = requireClient().from('products').update({ category: name }).in('id', part)
    if (mode === 'fill') {
      /* 只补空：`Uncategorised` 是 schema 的默认值，所以"没有分类"在库里
       * 就是这一个字符串（外加理论上可能的 null）。 */
      query = query.or(`category.is.null,category.eq.${UNCATEGORISED}`)
    }

    const { data, error } = await query.select()
    if (error) throw new Error(error.message)

    if (data) {
      const patched = new Map(data.map((row) => [String(row.id), rowToProduct(row)]))
      cache = cache.map((product) => patched.get(String(product.id)) || product)
      changed += data.length
    }
    notify()
  }

  return changed
}

/**
 * Move a category's products to another name.
 * Used by rename and by delete-category; both need the products re-pointed
 * before the old category row can go.
 */
export async function setProductsCategory(from, to) {
  if (!from || !to || from === to) return 0

  const affected = cache.filter((product) => product.category === from)
  if (!affected.length) return 0

  const { error } = await requireClient()
    .from('products')
    .update({ category: to })
    .eq('category', from)

  if (error) throw new Error(error.message)

  cache = cache.map((product) =>
    product.category === from ? { ...product, category: to } : product,
  )
  notify()
  return affected.length
}

/**
 * Swap a product with its neighbour by swapping their sort_order values.
 * Two updates, no reindex — a full reindex would touch every row and fire a
 * realtime storm for a one-slot move.
 */
export async function moveProduct(id, direction) {
  const list = [...cache].sort(
    (a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0),
  )
  const index = list.findIndex((product) => product.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= list.length) return

  const a = list[index]
  const b = list[target]
  const aOrder = orderById.get(a.id) ?? index
  const bOrder = orderById.get(b.id) ?? target

  const client = requireClient()
  const [first, second] = await Promise.all([
    client.from('products').update({ sort_order: bOrder }).eq('id', a.id),
    client.from('products').update({ sort_order: aOrder }).eq('id', b.id),
  ])

  const failure = first.error || second.error
  if (failure) throw new Error(failure.message)

  /* The local order changes here — anything read before this line describes the
   * previous arrangement. See `orderEpoch`. */
  orderEpoch++
  orderById.set(a.id, bOrder)
  orderById.set(b.id, aOrder)

  resort()
}

/* ── reordering to the ends ────────────────────────────────────────────────
 *
 * `sort_order` is dense today (0..194, no gaps), which is exactly why a drag
 * would be expensive: landing a row at slot 3 means rewriting the ~190 rows
 * between. "Send to top" avoids that entirely — it writes ONE number, `min - 1`,
 * and every other row keeps its own.
 *
 * The numbers drift (tops go -1, -2, -3 …). That is harmless: the only consumer
 * is `order by sort_order`, and nothing asserts density. If the drift ever gets
 * ugly, a single renumber pass fixes it — but that is a maintenance chore, not
 * a correctness requirement.
 *
 * One write also means one chance to fail. A partial failure is impossible:
 * either the row moved or it did not, and the UI says which.
 */

/** Re-sort the cache the way the query would, then wake the subscribers. */
function resort() {
  cache = [...cache].sort((x, y) => {
    const diff = (orderById.get(x.id) ?? 0) - (orderById.get(y.id) ?? 0)
    return diff !== 0 ? diff : x.id.localeCompare(y.id)
  })
  notify()
}

/** Current extremes of sort_order across the catalogue. */
function orderRange() {
  let min = Infinity
  let max = -Infinity
  for (const product of cache) {
    const value = orderById.get(product.id) ?? 0
    if (value < min) min = value
    if (value > max) max = value
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 }
}

/**
 * Move one product to the very front (`edge = 'top'`) or the very back.
 * A no-op when it is already there — otherwise every click would nudge the
 * number and the ordering would drift for no reason.
 */
export async function moveProductToEdge(id, edge) {
  const { min, max } = orderRange()
  const current = orderById.get(id)
  if (current === undefined) return

  const target = edge === 'top' ? min - 1 : max + 1
  if (edge === 'top' ? current === min : current === max) return

  const client = requireClient()
  const { error } = await client.from('products').update({ sort_order: target }).eq('id', id)
  if (error) throw new Error(error.message)

  orderEpoch++
  orderById.set(id, target)
  resort()
}

/**
 * Same, for a multi-selection. The block keeps its internal order — selecting
 * five rows and hitting "to top" gives you those five, in the order they were
 * already in, at the front. Otherwise a multi-select would silently shuffle.
 *
 * This one is genuinely N writes, because each row needs its own number. It is
 * bounded by the selection size (a handful), not by the catalogue.
 */
export async function moveProductsToEdge(ids, edge) {
  const known = (ids || []).filter((id) => orderById.has(id))
  if (known.length === 0) return 0

  const { min, max } = orderRange()
  const ordered = [...known].sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0))

  const client = requireClient()
  const results = await Promise.all(
    ordered.map((id, index) =>
      client
        .from('products')
        .update({ sort_order: edge === 'top' ? min - ordered.length + index : max + 1 + index })
        .eq('id', id),
    ),
  )

  let moved = 0
  orderEpoch++
  ordered.forEach((id, index) => {
    if (results[index].error) return
    orderById.set(id, edge === 'top' ? min - ordered.length + index : max + 1 + index)
    moved++
  })
  resort()

  if (moved !== ordered.length) {
    throw new Error(
      `${ordered.length - moved} of ${ordered.length} could not be moved — refresh and try again`,
    )
  }
  return moved
}

/**
 * Drag-and-drop reorder: one RPC, one transaction, whole catalogue at once.
 *
 * The client sends the complete ordered id list and `reorder_products` writes
 * `sort_order = index` for every row in a single statement. That is the whole
 * point of the function — a drag that moves row 190 to slot 3 changes ~187
 * numbers, and doing that as 187 HTTP requests has no transaction around it:
 * a failure halfway leaves the catalogue in an order nobody chose.
 *
 * The local order is applied *before* the round trip. Dragging is a direct
 * manipulation gesture; waiting 200ms and then snapping the row back to where
 * it started reads as "the drag failed". If the RPC does fail, we refetch —
 * the server's order is the truth and it is one request away.
 *
 * `p_ids` must be the FULL catalogue. The SQL function rejects anything else,
 * and the UI only enables dragging when no filter is active.
 */
export async function reorderProducts(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  /* First bump, before the optimistic apply: a refetch already in flight was
   * reading the pre-drag order and must not land on top of this one. */
  orderEpoch++

  const previous = new Map(orderById)
  ids.forEach((id, index) => orderById.set(id, index))
  resort()

  const client = requireClient()
  const { data, error } = await client.rpc('reorder_products', { p_ids: ids })

  if (error) {
    // Put the old numbers back before refetching, so a failed drag does not
    // leave the optimistic order on screen while the network request is in
    // flight for the recovery reload.
    orderById.clear()
    previous.forEach((value, id) => orderById.set(id, value))
    orderEpoch++
    resort()
    loadProducts().catch(() => {})
    throw new Error(error.message)
  }

  /* Second bump, after the commit. A read that started while the RPC was in
   * flight matches the first bump's epoch but may have sampled the table before
   * the transaction committed — this is the one window the first bump cannot
   * cover, and covering it is the whole point: otherwise that read lands
   * afterwards and the list jumps back to the pre-drag order. */
  orderEpoch++

  return data ?? ids.length
}

/**
 * Test-only seam.
 * The pure codec tests need to swap the catalogue (reorder it, delete from it)
 * to prove that v3/v4 survive catalogue edits. There is no localStorage to
 * write any more, so they write the cache directly. Never call this from app
 * code — every real read goes through `loadProducts`.
 */
export function __setCatalogueForTests(list) {
  cache = (list || []).map((product, index) => normalizeProduct(product, index))
  orderById.clear()
  cache.forEach((product, index) => orderById.set(product.id, index))
  notify()
}

/** Used by the developer console surface. */
export async function refresh() {
  await loadProducts()
  return cache
}

/* ── first-paint cache (sessionStorage) ─────────────────────────────────────
 *
 * A creator on a slow phone waits 2-6 s for a 39 kB gzip answer plus the round
 * trip. She usually opens the link twice (her phone, then again while picking),
 * and every one of those visits paid the full price for data that had not
 * changed in between.
 *
 * So the last catalogue is kept in sessionStorage and painted immediately, then
 * replaced by the real fetch in the background. sessionStorage rather than
 * localStorage on purpose: the copy dies with the tab, so a stale catalogue can
 * never outlive the session that produced it. The trade is explicit — for the
 * few hundred milliseconds until the fetch lands, a product deleted since the
 * last visit is still on screen. `reconcileLines` then drops any cart line that
 * no longer exists, exactly as it does for a live deletion.
 *
 * Raw rows, not mapped products: hydration runs the same `rowToProduct` the
 * network path runs, so there is only one mapping implementation to keep true.
 */
const CACHE_KEY = 'mako_catalogue_v1'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

function persistCatalogue(rows) {
  if (typeof window === 'undefined' || !rows?.length) return
  const write = () => {
    try {
      window.sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ v: 1, at: Date.now(), rows }),
      )
    } catch {
      /* Quota or private mode — the next visit just waits like before. */
    }
  }
  /* Stringifying 258 kB costs ~10 ms; never spend that on the frame that is
   * already showing the grid. */
  if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 3000 })
  else setTimeout(write, 1200)
}

/** Cached rows, or null when there is nothing usable. Never throws. */
function readCatalogueCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows) || !parsed.rows.length) return null
    if (Date.now() - Number(parsed.at || 0) > CACHE_TTL_MS) return null
    return parsed.rows
  } catch {
    return null
  }
}

/* Runs once, at import. Doing it here rather than in an effect means the very
 * first render already has the catalogue — no skeleton on a warm visit. */
if (isConfigured) {
  const seeded = readCatalogueCache()
  if (seeded) {
    const rows = sortRows(seeded)
    cache = rows.map(rowToProduct)
    orderById.clear()
    for (const row of rows) orderById.set(row.id, row.sort_order ?? 0)
    status = 'ready'
  }
}
