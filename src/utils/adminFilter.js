/**
 * Admin catalogue filter
 * ═════════════════════
 * The three narrowing controls on /admin/products — search box, category
 * dropdown, sold-out toggle — as one pure function, so the rules can be tested
 * without a browser and there is exactly one place that decides what "visible"
 * means.
 *
 * WHY IT MATTERS THAT IT IS ONE FUNCTION
 * "Visible" is not only a render detail here: Select all, the bulk Hide /
 * Unhide / Delete actions and the reorder buttons all operate on the visible
 * rows, and dragging is disabled whenever a filter is on. If the list and those
 * actions computed visibility differently, a bulk delete would hit rows the
 * admin cannot see. One predicate, three controls, one answer.
 *
 * COMBINING IS AND, NOT OR
 * Picking a category and typing a 货号 narrows twice — the search matches on
 * id / 货号 / ASIN and the category matches on the product's own category. A
 * creator's "did I already add this style?" check is exactly that pair, and an
 * OR would make the second control useless the moment the first one is used.
 */

import { matchesQuery } from './sku.js'
import { soldOutSummary } from './soldOut.js'
import { dealWindow } from './deal.js'

/* Splitting a pasted list. Beyond the four separators we document (newline,
 * space, comma, semicolon) this also takes tab and the full-width Chinese
 * punctuation Excel emits on a Chinese keyboard — `，` `；` `、`. A 货号 never
 * contains any of them, so accepting them costs nothing and saves the admin
 * from "I pasted 10 and got 1 result, with a comma in it". */
const SEPARATORS = /[\s,;，；、]+/

/**
 * "10 货号 from Excel" → ["P9B013", "H4E311", …]
 *
 * Empty parts are dropped (a trailing newline is the normal case, not an error)
 * and duplicates are removed case-insensitively so "p9b013, P9B013" counts as
 * one SKU rather than making the counter lie.
 *
 * @param {string} raw
 * @returns {string[]} in the order they were pasted
 */
export function parseBulkQuery(raw) {
  const text = String(raw ?? '')
  if (!text) return []

  const tokens = []
  const seen = new Set()
  for (const part of text.split(SEPARATORS)) {
    const token = part.trim()
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(token)
  }
  return tokens
}

/** Two or more 货号 means "bulk mode"; one is ordinary fuzzy search. */
export const BULK_MIN_TOKENS = 2

/** Sentinel for "no category filter". Deliberately not '' — that is a legal
 *  (if unusual) category name and must stay selectable. */
export const ALL_CATEGORIES = 'All'

/**
 * 「秒杀商品」视图的哨兵值。
 *
 * 秒杀状态不是一列，是 `sale_start` / `sale_end` 两个字符串算出来的，所以
 * `categories` 表里永远不会有它 —— 这就是运营以前只能把 100 个货号贴进搜索框
 * 的原因。这里把它做成分类下拉里的一个伪选项，和前台 `DEALS_TAB` 同构：
 * 一个不可能撞上真实分类名的值，`filterProducts` 分支处理。
 *
 * 命中条件：两端都填了，**且还没结束**（进行中 + 排期中）。已结束的不算 ——
 * 运营点开这个视图是为了"今天要跟的活动"，不是翻历史。
 */
export const DEAL_ITEMS = '__deal_items__'

/** 这件商品当前是否算"秒杀商品"（进行中或排期中）。 */
export function isDealItem(product, now = Date.now()) {
  const window = dealWindow(product, now)
  if (!window) return false
  return window.endsAt > Number(now)
}

/** One product against one category name. A blank filter matches everything. */
export function matchesCategory(product, category) {
  if (!category || category === ALL_CATEGORIES) return true
  return String(product?.category || '') === String(category)
}

/**
 * @param {Array<object>} products
 * @param {{ query?: string, category?: string, soldOutOnly?: boolean, asinMap?: object, now?: number }} options
 * @returns {Array<object>} in catalogue order (input order is preserved)
 */
export function filterProducts(
  products,
  { query = '', category = ALL_CATEGORIES, soldOutOnly = false, asinMap = {}, now = Date.now() } = {},
) {
  if (!Array.isArray(products)) return []

  const tokens = parseBulkQuery(query)
  /* Why the switch at two tokens:
   *
   *   1 token  → the search box has always been fuzzy (id / 货号 / name /
   *              category / ASIN). Keeping that for "P9" is the whole point.
   *   ≥2 tokens → almost certainly a paste from Excel, where the admin wants
   *              exactly those 货号 and nothing else. "P9B013 P9B018" as two
   *              fuzzy substrings would match nothing anyway; as an OR of exact
   *              SKUs it matches exactly what was pasted.
   *
   * The Set is built once per call, not per product: 100 pasted SKUs × 273 rows
   * with `includes` is ~27k substring scans on every keystroke; this is 273
   * hash lookups. */
  const bulk = tokens.length >= BULK_MIN_TOKENS
    ? new Set(tokens.map((token) => token.toLowerCase()))
    : null

  return products.filter((product) => {
    /* 伪选项先判：它不是分类名，交给 `matchesCategory` 只会永远返回 false。 */
    if (category === DEAL_ITEMS) {
      if (!isDealItem(product, now)) return false
    } else if (!matchesCategory(product, category)) {
      return false
    }

    /* Sold out = at least one combination is gone. A product with 4 of 5 sizes
       still orderable stays in this view on purpose: one dead size is one dead
       size, and it is the thing purchasing has to act on. */
    if (soldOutOnly && !(soldOutSummary(product).soldOut > 0)) return false

    if (!bulk) return matchesQuery(product, query, asinMap)

    /* Exact 货号 only, case-insensitive: pasting "p9b013" must find P9B013. */
    return bulk.has(String(product?.sku ?? '').trim().toLowerCase())
  })
}

/**
 * 下拉里那个伪选项要显示的数字（"⚡ Deal Items (12)"）。
 *
 * 按**当前筛选后的集合**算会自相矛盾（选中它之后变成"12 of 12"），所以这里
 * 和分类选项一样，按整本目录算：它回答的是"点下去能看到多少件"。
 *
 * @param {Array<object>} products
 * @param {number} [now]
 * @returns {number}
 */
export function dealItemsCountOf(products, now = Date.now()) {
  if (!Array.isArray(products)) return 0
  return products.filter((product) => isDealItem(product, now)).length
}

/**
 * Category names that actually have products, sorted for the dropdown.
 *
 * Derived from the catalogue rather than from `categories`, so the list can
 * never offer a category with zero results — an empty result set after picking
 * a category looks like a broken filter, not like an empty category.
 */
export function categoryOptionsOf(products) {
  const seen = new Set()
  for (const product of Array.isArray(products) ? products : []) {
    const name = product?.category
    /* A category literally named "All" would collide with the sentinel: the
     * dropdown would carry two `value="All"` options and the second one could
     * never be selected. Leaving it out of the list is the honest trade — those
     * products are still reachable with the search box. */
    if (name && name !== ALL_CATEGORIES) seen.add(name)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}
