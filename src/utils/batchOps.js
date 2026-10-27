/**
 * 批量操作 — 纯函数
 * ══════════════════
 *
 * The bits three dialogs (deal / category / badge) and three store writers all
 * need, kept out of React and out of Supabase so `test-batch-ops.mjs` can pin
 * them without a browser or a database.
 *
 * WHY CHUNKING LIVES HERE
 * ──────────────────────
 * A batch starts from `Select all` over a pasted 100-货号 search, and "100" is
 * not a limit — the operator can just as easily tick 273. PostgREST turns
 * `.in('id', ids)` into a query string, so an unbounded list is a URL waiting
 * to hit a proxy's length cap, and a single 273-row upsert is one statement
 * that either succeeds entirely or fails entirely. `chunk` caps each request at
 * `BATCH_CHUNK`; the caller reports partial success honestly instead of
 * pretending 273 rows were atomic.
 *
 * Nothing here writes. Every function is a pure transform of its arguments.
 */

import { normaliseBadgeDraft } from './batchBadge.js'

/**
 * Max ids per write request.
 *
 * 100 is deliberately below every relevant ceiling (PostgREST URL length,
 * Supabase's statement timeout, the point where one failed request wastes a
 * visible amount of work) and still large enough that 273 products is three
 * round trips, not ten.
 */
export const BATCH_CHUNK = 100

/**
 * Split an array into fixed-size slices. Never returns an empty slice, so
 * `for (const part of chunk([], 100))` runs zero times instead of once with [].
 *
 * @template T
 * @param {T[]} list
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunk(list, size = BATCH_CHUNK) {
  const items = Array.isArray(list) ? list : []
  const step = Math.max(1, Math.trunc(Number(size) || BATCH_CHUNK))
  const out = []
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step))
  return out
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` and a real calendar day (2026-02-31 is not one). */
export function isValidDateInput(value) {
  const text = String(value ?? '').trim()
  const match = DATE_ONLY.exec(text)
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  )
}

/** Price cell → number, or null. Accepts "29.99", "US$29.99", "1,299". */
export function parsePriceInput(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.replace(/[^0-9.,-]/g, '').match(/-?\d[\d,]*(?:\.\d+)?/)
  if (!match) return null
  const num = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(num) ? num : null
}

/** Day → `...T00:00:00`, the string the rest of the app stores. */
export const startStampOf = (date) => (date ? `${date}T00:00:00` : '')

/** Day → `...T23:59:59`. End-of-day, not start-of-day: a window that says
 *  "27 → 30" has to include the 30th, or it silently ends a day early. */
export const endStampOf = (date) => (date ? `${date}T23:59:59` : '')

/**
 * The batch-deal form → the five strings `setProductsDeals` writes.
 *
 * Returns `{ deal, error }` and never throws: the dialog renders `error` under
 * the fields, which is the only place the operator can fix it.
 *
 * Deliberately NOT defaulting anything. An empty date is not "today" — silently
 * scheduling a flash sale for today because a field was skipped is the kind of
 * mistake that costs money in the wrong direction.
 *
 * @param {{startDate?:string,endDate?:string,originalPrice?:string,salePrice?:string}} draft
 * @returns {{ deal: {saleStart:string,saleEnd:string,salePrice:string,originalPrice:string,discountLabel:string}|null, error: string }}
 */
export function buildDealFromDates(draft) {
  const startDate = String(draft?.startDate ?? '').trim()
  const endDate = String(draft?.endDate ?? '').trim()

  if (!startDate) return { deal: null, error: '开始日期必填' }
  if (!endDate) return { deal: null, error: '结束日期必填' }
  if (!isValidDateInput(startDate)) return { deal: null, error: '开始日期不是有效日期' }
  if (!isValidDateInput(endDate)) return { deal: null, error: '结束日期不是有效日期' }

  /* ISO dates compare lexicographically == chronologically. */
  if (endDate < startDate) return { deal: null, error: '结束日期早于开始日期' }

  const originalPrice = parsePriceInput(draft?.originalPrice)
  const salePrice = parsePriceInput(draft?.salePrice)

  if (originalPrice === null || originalPrice < 0) return { deal: null, error: '原价无法解析' }
  if (salePrice === null || salePrice < 0) return { deal: null, error: '折后价无法解析' }
  if (salePrice > originalPrice) return { deal: null, error: '折后价高于原价' }

  return {
    deal: {
      saleStart: startStampOf(startDate),
      saleEnd: endStampOf(endDate),
      originalPrice: String(originalPrice),
      salePrice: String(salePrice),
      /* 折扣文案由前台从两个价格实时算（utils/deal.js）。预存一份会在改价后
       * 变成陈旧的错误角标 —— 这正是 dealImport 留空同一字段的原因。 */
      discountLabel: '',
    },
    error: '',
  }
}

/**
 * 置顶权重输入 → 整数，`null` = "这次不动这一列"。
 *
 * Batch-deal forms are reused for "extend the window by a day" as often as for
 * "set the whole promotion", so an empty priority box must mean *leave it
 * alone*, not *reset it to 0*. Resetting would quietly unpin the twenty
 * products the operator pinned this morning.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function parsePriorityInput(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const num = Number(text)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(9999, Math.trunc(num)))
}

/**
 * 批量改分类的两种语义。
 *
 * `category` is a single text column with an FK to `categories(name)` — one
 * product has exactly one category, so "追加" cannot mean "keep both". It
 * means "only touch the ones that have no category yet", which is the case
 * that actually happens: a fresh import lands 40 pieces in Uncategorised and
 * the operator wants them in "New In" without moving the 30 already sorted.
 */
export const CATEGORY_MODES = [
  {
    id: 'replace',
    label: 'Overwrite all',
    hint: 'Every selected product moves to this category.',
  },
  {
    id: 'fill',
    label: 'Only fill uncategorised',
    hint: 'Products that already have a category keep it.',
  },
]

/** Rows that the `fill` mode would actually move. Pure so the dialog can show
 *  the real number next to the radio before anything is written. */
export function countFillTargets(products, uncategorised) {
  const label = String(uncategorised || '').trim().toLowerCase()
  return (Array.isArray(products) ? products : []).filter((product) => {
    const current = String(product?.category ?? '').trim().toLowerCase()
    return !current || current === label
  }).length
}

/**
 * 副角标 → 要写入的两个值。规则与主角标完全一致（折叠空白、截断、非法颜色
 * 降级、文字为空则颜色一并清掉），所以直接复用 `normaliseBadgeDraft` —— 
 * 两套截断长度迟早会不一致，那不是两处可以各自演化的地方。
 *
 * @param {{ text?: unknown, color?: unknown }} draft
 * @returns {{ subTag: string, subBadgeColor: string }}
 */
export function normaliseSubBadgeDraft(draft) {
  const { tag, badgeColor } = normaliseBadgeDraft(draft)
  return { subTag: tag, subBadgeColor: badgeColor }
}

/**
 * 输入的分类名 → 数据库里那个拼写，外加"是不是新的"。
 *
 * 为什么要这一步：`products.category` 是 FK 指向 `categories(name)`，而
 * Postgres 的 text 比较**区分大小写**。运营手打 "new in" 时，`addCategory`
 * 会因为已存在 "New In" 而返回 false（它内部不区分大小写），但直接拿
 * "new in" 去 update 会撞 FK —— 报错信息还是一句难以理解的 constraint
 * violation。所以先把输入映射回已有分类的规范拼写，只有真的不存在才新建。
 *
 * @param {unknown} input
 * @param {string[]} existing
 * @returns {{ name: string, isNew: boolean }}
 */
export function resolveCategoryName(input, existing) {
  const text = String(input ?? '').trim()
  if (!text) return { name: '', isNew: false }
  const list = Array.isArray(existing) ? existing : []
  const hit = list.find((name) => String(name).toLowerCase() === text.toLowerCase())
  return { name: hit || text, isNew: !hit }
}
