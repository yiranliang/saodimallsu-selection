/**
 * Catalogue pipeline
 * ──────────────────
 * One place that decides what the creator sees, in what order, and how much of
 * it. Everything here is a pure function over a plain array, so the whole
 * filter → search → page chain is testable in Node without a browser.
 *
 *   products  →  filterCatalogue({ category, query })  →  slicePage(limit)
 *
 * The order matters: paging is the LAST step. If you slice first and filter
 * after, "Load more" starts counting from the wrong place and a category with
 * 3 matches can appear empty.
 */

/* `isTeaser` rather than `product?.isTeaser === true`: the "only a strict true
 * counts" rule lives in one file, so a stray `'false'` string can never unlock
 * a teaser by accident. teaser.js has no imports, so there is no cycle. */
import { isTeaser } from './teaser.js'

/** How many cards one batch adds */
export const PAGE_SIZE = 24

/** Normalise a search box value: trim, collapse runs of spaces, lowercase */
export function normaliseQuery(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Does one product match a query?
 * Matches the 货号 (sku) and the display name, case-insensitively, on every
 * token — so "p9b 013" still finds P9B013.
 *
 * ASINs are deliberately not searchable here: the storefront never receives
 * the ASIN map (it is admin-only), so matching on it is impossible by design.
 */
export function matchesQuery(product, query) {
  const needle = normaliseQuery(query)
  if (!needle) return true

  const haystack = `${product?.sku ?? ''} ${product?.name ?? ''}`.toLowerCase()
  return needle.split(' ').every((token) => haystack.includes(token))
}

/**
 * Filter by category and query.
 *
 * @param {Array} products            hidden products are removed BEFORE this (see
 *                                    SHOW_HIDDEN_PRODUCTS in SelectionPage)
 * @param {Object} opts
 * @param {string} opts.category      'All' or a category name
 * @param {string} opts.query         raw search box value
 * @param {string} opts.uncategorised bucket name for products without a category
 * @returns {Array} a new array, original order preserved
 */
export function filterCatalogue(products, { category = 'All', query = '', uncategorised = 'Uncategorised' } = {}) {
  const list = Array.isArray(products) ? products : []
  const needle = normaliseQuery(query)

  /* Fast path: nothing to narrow down */
  if (category === 'All' && !needle) return list.slice()

  return list.filter((product) => {
    if (category !== 'All' && (product.category || uncategorised) !== category) return false
    return matchesQuery(product, needle)
  })
}

/**
 * Does this product wear a badge on its card?
 *
 * The badge is the `tag` text (`New`, `Best-seller`, `FP dupe`); `badgeColor`
 * only paints it. So a style with a colour but no text has nothing to show and
 * is NOT badged — pinning an invisible pill to the top of the storefront would
 * look like a sorting bug. The editor trims `tag` on save, so `trim()` here
 * matches exactly what the card can render.
 */
export function hasBadge(product) {
  return String(product?.tag ?? '').trim() !== ''
}

/**
 * Badged styles first, everything else after — both groups keeping the order
 * they arrived in.
 *
 * A STABLE PARTITION, NOT A COMPARATOR
 * ────────────────────────────────────
 * The list handed in is already in `sort_order` (that is what `productStore`
 * caches, and its order is the admin's drag order). Partitioning therefore
 * gives "badged, in their own order, then the rest, in theirs" for free — and
 * it cannot drift from the admin's arrangement the way a `sort((a,b) =>
 * a.sort_order - b.sort_order)` would, because the storefront product shape
 * does not even carry `sort_order` (it is tracked separately in `orderById`).
 *
 * WHY THIS MUST RUN BEFORE `slicePage`
 * ────────────────────────────────────
 * The grid shows 24 cards at a time. Ordering after the slice would only shuffle
 * the batch already on screen — a badged style at position 191 would stay
 * invisible until "Load more" had been pressed eight times. Measured on the live
 * catalogue: of the 7 badged styles, three sit at rank 191, 194 and 196.
 *
 * Storefront only. `/#/admin/products` keeps the raw `sort_order` list (see
 * `utils/adminFilter.js`); making the admin list badge-first would mean the one
 * screen where you drag rows into place disagreed with itself.
 *
 * SUPERSEDED BY `storefrontOrder` (see below), which is what the storefront
 * actually calls now: it needs four tiers, because a Coming Soon style must not
 * hold the first screen. This two-tier partition stays exported because it is
 * the tier-1/2 half of that logic, and its tests are the anchor for "the badge
 * rule did not change when the teaser tier was added".
 *
 * Pure, non-mutating: always returns a new array.
 */
export function badgeFirst(list) {
  const items = Array.isArray(list) ? list : []
  if (items.length < 2) return items.slice()

  const badged = []
  const plain = []
  for (const product of items) (hasBadge(product) ? badged : plain).push(product)

  /* Nothing to reorder — skip the concat so the 99%-of-the-time case stays one
   * allocation. */
  if (!badged.length) return items.slice()
  return badged.concat(plain)
}

/**
 * Storefront tiers — four, highest first.
 *
 *   1  live + an ordinary marketing badge   (New, Best-seller, …)
 *   2  live, no badge                       (the admin's drag order)
 *   3  Coming Soon                          (shown, but sunk)
 *   4  hidden                               (not published)
 *
 * WHY COMING SOON MOVED DOWN
 * ──────────────────────────
 * It used to sit with the badged styles — a teaser carries a badge, and the
 * badge rule won. Ops reported the result: a first screen full of styles that
 * cannot be ordered reads as "this shop has no stock", and the creator leaves
 * before scrolling. So the first screen must be all shoppable, and a teaser is
 * still published — visible, just further down, so it works as a preview
 * instead of a roadblock.
 *
 * WHY A DEAL DOES NOT PROMOTE
 * ───────────────────────────
 * A running flash sale is a time function. Sorting on it would reshuffle the
 * shelf every time a window opened or closed, under a creator who is midway
 * through scrolling, and it would make the order depend on the clock rather
 * than on the admin's drag. So tier 1/2 is decided by `tag` only — a deal-only
 * product shows the ⚡ badge while sitting in tier 2. Deliberate.
 *
 * @param {object} product
 * @returns {1|2|3|4}
 */
export const STOREFRONT_TIERS = Object.freeze({
  LIVE_BADGED: 1,
  LIVE_PLAIN: 2,
  TEASER: 3,
  HIDDEN: 4,
})

export function storefrontTier(product) {
  if (product?.hidden === true) return STOREFRONT_TIERS.HIDDEN
  if (isTeaser(product)) return STOREFRONT_TIERS.TEASER
  return hasBadge(product) ? STOREFRONT_TIERS.LIVE_BADGED : STOREFRONT_TIERS.LIVE_PLAIN
}

/**
 * Storefront order — four tiers, stable inside each.
 *
 * WHY HIDDEN IS A TIER AND NOT A FILTER
 * ─────────────────────────────────────
 * `SelectionPage` decides whether hidden products reach this function at all
 * (see SHOW_HIDDEN_PRODUCTS there — today they do not, because `hidden` means
 * "not published yet": batch imports default to hidden, and a draft must never
 * appear on the storefront). This tier exists so that IF a list containing
 * hidden rows arrives, they cannot land in the middle of the shelf — which is
 * the only thing worse than not showing them: a half-prepared style sitting
 * between two live ones.
 *
 * A badged hidden product still goes last. The badge is the shop's own label;
 * unpublished is a stronger statement than "New".
 *
 * STABILITY IS THE WHOLE POINT
 * ────────────────────────────
 * The input is already in `sort_order` (the admin's drag order), and the
 * storefront shape does not even carry `sort_order` — it is tracked separately
 * in `orderById`. So this must be a partition, never a `sort()`: a comparator
 * would need a field that is not here, and any stable sort by a field we do have
 * would silently reorder the ranks the admin dragged into place.
 *
 * One pass into four buckets. Paging is applied afterwards (`slicePage`), so
 * the first batch can only contain tiers 1 and 2 as long as 24 of them exist.
 *
 * Pure, non-mutating: always a new array.
 */
export function storefrontOrder(list) {
  const items = Array.isArray(list) ? list : []
  if (items.length < 2) return items.slice()

  const badged = []
  const plain = []
  const teasers = []
  const hidden = []

  for (const product of items) {
    if (product?.hidden === true) hidden.push(product)
    else if (isTeaser(product)) teasers.push(product)
    else if (hasBadge(product)) badged.push(product)
    else plain.push(product)
  }

  /* Nothing to reorder — skip the concat so the common case (all live, already
   * in drag order) costs one allocation. */
  if (!teasers.length && !hidden.length && !badged.length) return items.slice()

  return badged.concat(plain, teasers, hidden)
}

/** The first `limit` items. `limit <= 0` means "nothing", not "everything". */
export function slicePage(list, limit) {
  const items = Array.isArray(list) ? list : []
  const size = Math.floor(Number(limit))
  if (!Number.isFinite(size) || size <= 0) return []
  return items.slice(0, size)
}

/** Next batch size, clamped so it never runs past the end */
export function nextLimit(limit, total, step = PAGE_SIZE) {
  const current = Math.max(0, Math.floor(Number(limit) || 0))
  const end = Math.max(0, Math.floor(Number(total) || 0))
  return Math.min(current + step, end)
}

/** Is there anything left to load? */
export function hasMore(limit, total) {
  const current = Math.max(0, Math.floor(Number(limit) || 0))
  const end = Math.max(0, Math.floor(Number(total) || 0))
  return current < end
}
