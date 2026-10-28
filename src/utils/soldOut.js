/**
 * Sold-out variants
 * ═════════════════
 * One combination runs out, the rest of the piece is still orderable. Hiding the
 * whole product is the wrong answer — a creator who wants Black/M should still
 * find the piece.
 *
 *   soldOutVariants: ["Green|S", "Green|M"]
 *
 * WHY COMBINATION KEYS, NOT PER-COLOUR LISTS
 * ──────────────────────────────────────────
 * Stock runs out per SKU, and the first thing to go is always one size. A
 * colour-level list (`soldOutColours: ["Green"]`) cannot express "Green/M is
 * gone but Green/L is fine" — it would grey out a size that is still in stock.
 *
 * The key is `variantKey(colour, size)` from `utils/sku.js`, byte-identical to
 * the keys in `asins.variants` and in the `product_links` view. One definition
 * means a combination cannot be simultaneously in stock, linked, and invisible.
 *
 * WHY THIS NEVER ENTERS A SELECTION CODE
 * ──────────────────────────────────────
 * Sold out is a stock state, not a selection. Codes already sent out must keep
 * decoding to the same colours and sizes, so nothing here touches
 * `utils/code.js`. A code issued before a piece sold out still decodes; the
 * storefront just stops letting a new one be built for that combination.
 *
 * Pure functions only — imported by `scripts/test-sold-out.mjs`.
 *
 * NO ASIN = SOLD OUT
 * ──────────────────
 * A combination the ASIN table has nothing for cannot be ordered either: ops
 * would have no listing to place the order against. Every "available" check
 * below therefore accepts an optional `asinLookup` predicate —
 * `(colour, size) => boolean`, true when that combination has an ASIN/listing.
 * When supplied, a combination counts as sold out if it is *either* marked in
 * `soldOutVariants` *or* has no ASIN. Omitted (as in the Node suites), the
 * check falls back to the stored marks only — so the pure functions stay free
 * of Supabase and the storefront injects its own `hasListingFor` lookup.
 */

import { variantKey, specPair } from './sku.js'
import { isColourType } from './variantImage.js'
import { isSizeType, sortSizes } from './sizes.js'

/** The spec type + its option list for one axis, or empty when absent. */
function axisOf(product, matches) {
  for (const [type, value] of Object.entries(product?.specs || {})) {
    if (!matches(type)) continue
    const options = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean)
    return { type, options }
  }
  return { type: '', options: [] }
}

/** Colours keep the order the product declares — there is no "correct" order
 *  for a colour list, and the admin's own order is the one they recognise. */
export function colourAxisOf(product) {
  return axisOf(product, isColourType)
}

/**
 * Sizes, smallest → largest.
 *
 * The stored array is import order, and about a third of the catalogue has it
 * scrambled (`XXL,S,L,M,XL`). Every consumer of this function is a display or a
 * grid — stock columns, ASIN rows, availability — so the order is normalised
 * here once instead of in each of them. Read-only on purpose: see the header of
 * utils/sizes.js for why the stored array is never rewritten.
 */
export function sizeAxisOf(product) {
  const axis = axisOf(product, isSizeType)
  return { type: axis.type, options: sortSizes(axis.options) }
}

/* ── reading ─────────────────────────────────────────────────────────────── */

/**
 * The raw list, whatever shape the column came back in.
 * A missing / malformed value is an empty list, never an error: an import that
 * predates this column must keep working.
 */
export function soldOutListOf(product) {
  const raw = product?.soldOutVariants
  if (!Array.isArray(raw)) return []
  return raw.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
}

/**
 * Lowercased lookup set. Case-insensitive on purpose — the catalogue and a
 * hand-edited SQL statement disagree about `green` vs `Green` more often than
 * anyone expects, and a silently-missed sold-out mark sells stock that is gone.
 */
export function soldOutKeysOf(product) {
  return new Set(soldOutListOf(product).map((key) => key.toLowerCase()))
}

/**
 * Is a combination "unavailable" — either marked sold out, or lacking an ASIN.
 *
 * `asinLookup` is optional and pure: `(colour, size) => boolean`. When it is
 * omitted the check is sold-out marks only, so the Node suites need no fixture
 * ASIN map. When present, "no ASIN" is folded in so a combination that was
 * never given a listing cannot be picked on the storefront.
 */
function comboUnavailable(keys, combo, asinLookup) {
  if (keys.has(combo.key.toLowerCase())) return true
  if (asinLookup && !asinLookup(combo.colour, combo.size)) return true
  return false
}

/** Is this exact combination sold out? `specs` is a chosen spec object.
 *  `asinLookup` (optional) folds "no ASIN" into the answer — see the header. */
export function isSoldOut(product, specs, asinLookup) {
  const keys = soldOutKeysOf(product)
  const { colour, size } = specPair(specs)
  if (keys.size && keys.has(variantKey(colour, size).toLowerCase())) return true
  if (asinLookup && !asinLookup(colour, size)) return true
  return false
}

/** Is every option of one axis sold out across the whole product? */
export function isAxisFullySoldOut(product, axis, value) {
  const combos = combinationsOf(product).filter((combo) => combo[axis] === value)
  return combos.length > 0 && combos.every((combo) => isSoldOut(product, combo.specs))
}

/**
 * Can the creator still tap this option, given what is already picked?
 *
 * The answer depends on the other axis, which is why this cannot be a static
 * per-option flag. Colour is picked first, so `Green` is disabled only when
 * every Green size is gone. Size is picked second, so `M` is disabled only when
 * *the selected colour's* M is gone — Green/M being out says nothing about
 * Black/M.
 *
 * A third spec axis (Length) collapses, exactly as it does in the ASIN map: the
 * key is colour+size, so an option on another axis is available if any
 * combination is.
 */
export function isOptionAvailable(product, specs, type, value, asinLookup) {
  const combos = combinationsOf(product)
  if (!combos.length) return true

  const colourAxis = colourAxisOf(product)
  const sizeAxis = sizeAxisOf(product)
  const { colour, size } = specPair({ ...(specs || {}), [type]: value })
  const keys = soldOutKeysOf(product)

  const matching = combos.filter((combo) => {
    if (colourAxis.type && colour && combo.colour !== colour) return false
    if (sizeAxis.type && size && combo.size !== size) return false
    return true
  })

  // The option is not on either axis (a Length, say) — nothing to narrow down
  if (!matching.length) return true
  return matching.some((combo) => !comboUnavailable(keys, combo, asinLookup))
}

/* ── the combination grid ────────────────────────────────────────────────── */

/**
 * Every orderable combination of one product, in catalogue order.
 *
 * Colour × size, not the cross product of *all* spec types: the variant key is
 * colour+size, so a product with a third axis (Length) collapses — the same
 * limitation the ASIN map already has. Empty when the product has no specs at
 * all, which is why a one-size, single-variant piece can never be sold out.
 *
 * Sizes come out smallest → largest (`sizeAxisOf`), colours in declared order.
 * The combination *keys* are unaffected — `"Green|L"` is the same key whichever
 * position it is rendered in — so this reorders the stock grid and the ASIN
 * list without touching a single stored mark.
 */
export function combinationsOf(product) {
  const colours = colourAxisOf(product).options
  const sizes = sizeAxisOf(product).options

  if (!colours.length && !sizes.length) return []

  const build = (colour, size) => {
    const specs = {}
    const colourType = colourAxisOf(product).type
    const sizeType = sizeAxisOf(product).type
    if (colourType && colour) specs[colourType] = colour
    if (sizeType && size) specs[sizeType] = size
    return { colour, size, key: variantKey(colour, size), specs }
  }

  if (!sizes.length) return colours.map((colour) => build(colour, ''))
  if (!colours.length) return sizes.map((size) => build('', size))

  const out = []
  for (const colour of colours) for (const size of sizes) out.push(build(colour, size))
  return out
}

/**
 * Counts for the editor badge and the card badge.
 *   all   every combination is gone — the card gets a "Sold out" badge
 *   some  at least one, but not all — no badge, the sheet greys them
 */
export function soldOutSummary(product, asinLookup) {
  const combos = combinationsOf(product)
  const keys = soldOutKeysOf(product)
  if (!combos.length) return { total: 0, soldOut: 0, all: false, some: false }

  const soldOut = combos.filter((combo) => comboUnavailable(keys, combo, asinLookup)).length
  return {
    total: combos.length,
    soldOut,
    all: soldOut === combos.length,
    some: soldOut > 0 && soldOut < combos.length,
  }
}

/* ── writing (editor) ────────────────────────────────────────────────────── */

/**
 * Clean a list coming from the database, localStorage or the editor draft.
 * Trims, drops blanks and dedupes case-insensitively, keeping the first
 * spelling. Never prunes against `specs` — see `pruneSoldOut` for why that is a
 * separate, explicit step.
 */
export function normalizeSoldOut(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []

  for (const entry of input) {
    if (typeof entry !== 'string') continue
    const key = entry.trim()
    if (!key) continue
    const lower = key.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(key)
  }

  return out
}

/**
 * Drop keys that no longer name a real combination — a colour was renamed, a
 * size removed.
 *
 * Deliberately NOT part of `normalizeSoldOut`: that runs on every database read,
 * so pruning there would erase the marks the moment a draft's `specs` were
 * temporarily incomplete. This runs only on an explicit save.
 */
export function pruneSoldOut(list, product) {
  const valid = new Set(combinationsOf(product).map((combo) => combo.key.toLowerCase()))
  return normalizeSoldOut(list).filter((key) => valid.has(key.toLowerCase()))
}

/**
 * Set one combination, returning a new list.
 * Re-marking an already-marked key is a no-op rather than a remove-and-append,
 * so toggling a whole colour does not shuffle the order of the keys it did not
 * need to touch.
 */
export function withKeySoldOut(list, key, sold) {
  const clean = normalizeSoldOut(list)
  const lower = String(key).toLowerCase()
  const present = clean.some((entry) => entry.toLowerCase() === lower)
  if (sold && present) return clean

  const without = clean.filter((entry) => entry.toLowerCase() !== lower)
  return sold ? [...without, key] : without
}

/**
 * Set every combination of one colour (or one size).
 * This is the "Green is out" button — it writes N keys rather than inventing a
 * second, colour-level storage format.
 */
export function setAxisSoldOut(list, product, axis, value, sold) {
  const targets = combinationsOf(product)
    .filter((combo) => combo[axis] === value)
    .map((combo) => combo.key)
  if (!targets.length) return normalizeSoldOut(list)

  let next = normalizeSoldOut(list)
  for (const key of targets) next = withKeySoldOut(next, key, sold)
  return next
}

/**
 * Flip one colour/size between all-available and all-sold-out.
 *
 * "Fully sold out" is judged against `list`, not against `product`. The editor
 * passes a draft list that has not been saved yet, so reading the product's
 * stored marks would answer a question about the wrong state — and the first
 * click on a half-marked colour would silently do nothing.
 */
export function toggleAxisSoldOut(list, product, axis, value) {
  const targets = combinationsOf(product)
    .filter((combo) => combo[axis] === value)
    .map((combo) => combo.key)
  if (!targets.length) return normalizeSoldOut(list)

  const keys = new Set(normalizeSoldOut(list).map((key) => key.toLowerCase()))
  const allOut = targets.every((key) => keys.has(key.toLowerCase()))
  return setAxisSoldOut(list, product, axis, value, !allOut)
}

/* ── the cart ────────────────────────────────────────────────────────────── */

/**
 * Split the selection into what can still be ordered and what cannot.
 *
 * Kept as two lists rather than filtering sold-out lines away: deleting a line
 * the creator picked, without her seeing it, makes the cart disagree with what
 * she thinks she chose. The UI badges them and asks.
 *
 * `productsById` is a Map or a plain object keyed by product id.
 */
export function partitionLines(lines, productsById) {
  const lookup = (id) =>
    productsById instanceof Map ? productsById.get(id) : productsById?.[id]

  const available = []
  const soldOut = []

  for (const line of Array.isArray(lines) ? lines : []) {
    const product = lookup(line?.productId)
    if (product && isSoldOut(product, line.specs)) soldOut.push(line)
    else available.push(line)
  }

  return { available, soldOut }
}

/** One-line summary for the editor header: "3 / 140 sold out". */
export function summaryLabel(product) {
  const { total, soldOut } = soldOutSummary(product)
  if (!total) return 'No variants'
  if (!soldOut) return `All ${total} available`
  if (soldOut === total) return `All ${total} sold out`
  return `${soldOut} / ${total} sold out`
}
