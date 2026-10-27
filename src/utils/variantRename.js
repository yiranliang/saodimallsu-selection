/**
 * Renaming a colour or a size
 * ═══════════════════════════
 * `asins.variants`, `sold_out_variants` and the `product_links` view are keyed
 * by `variantKey(colour, size)` — the TEXT of the option, not its position.
 *
 * So fixing an import that says 藏青色 where ops wants Navy is not a cosmetic
 * edit. If the keys do not move with the name, every ASIN stored under 藏青色
 * is orphaned (the rows read "Missing ASIN"), and the newly spelled rows look
 * like they never had a listing at all. The same happens to a sold-out mark:
 * rename the colour, and the piece silently goes back on sale.
 *
 * HOW A RENAME IS RECOGNISED
 * ──────────────────────────
 * The editor edits options by ARRAY POSITION — that is already how the
 * per-option image URLs work ("keying them by the option name instead would
 * orphan the photo the moment someone fixes a typo in a colour name"). So the
 * same option, spelled differently, is `options[i]` before vs after.
 *
 * THE GUARD THAT MATTERS
 * ──────────────────────
 * "Delete the old colour, then add the new one" — the other way users do this
 * — is nearly indistinguishable from a rename by position:
 *
 *   before [藏青色, Red]   after [Navy, Red]    · 藏青色 gone, Navy unknown → a rename
 *   before [藏青色, Red]   after [Red, Navy]    · 藏青色 gone, but Red slid into
 *                                                 slot 0 → NOT a rename
 *
 * Requiring BOTH "the old value is now absent from the whole list" and "the new
 * value was absent from the whole old list" is what keeps the delete+add path
 * from handing one colour's ASINs to another colour. When in doubt this module
 * declines: the keys stay where they are, the new rows read "Missing ASIN", and
 * the old keys show up in the editor's "kept from earlier imports" block where
 * a human can clear them. Guessing wrong here binds the wrong listing to an
 * order, and nothing fails until somebody is packing a box.
 *
 * Pure functions only — `scripts/test-variant-rename.mjs` imports this from
 * Node, so no Supabase, no React.
 */

import { isColourType } from './variantImage.js'
import { isSizeType } from './sizes.js'
import { variantKey } from './sku.js'

/** `"Green|M"` → `["Green", "M"]`; a keyless legacy entry comes back as-is. */
export function splitVariantKey(key) {
  const text = String(key ?? '')
  const at = text.indexOf('|')
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]
}

/** The option list of the first spec type that matches (colour OR size). */
function optionsOf(specs, matches) {
  for (const [type, value] of Object.entries(specs || {})) {
    if (!matches(type)) continue
    const list = Array.isArray(value) ? value : [value]
    return list.map((option) => String(option ?? '').trim())
  }
  return []
}

const lower = (value) => String(value ?? '').trim().toLowerCase()
const same = (a, b) => lower(a) === lower(b)

/**
 * Pairs of `{ from, to }` for options renamed in place.
 *
 * Only a position where the old spelling has disappeared from the list as a
 * whole AND the new spelling was not already somewhere else counts — see the
 * header. Two equal values at the same position (or differing only in case)
 * are not a rename: the key lookup is case-insensitive already, and rewriting
 * `navy` to `Navy` would be a write with nothing to show for it.
 */
export function renamePairs(beforeOptions, afterOptions) {
  const before = (Array.isArray(beforeOptions) ? beforeOptions : []).map((v) => String(v ?? '').trim())
  const after = (Array.isArray(afterOptions) ? afterOptions : []).map((v) => String(v ?? '').trim())

  const beforeSet = new Set(before.filter(Boolean).map(lower))
  const afterSet = new Set(after.filter(Boolean).map(lower))

  const pairs = []
  const limit = Math.min(before.length, after.length)

  for (let i = 0; i < limit; i += 1) {
    const from = before[i]
    const to = after[i]
    if (!from || !to || same(from, to)) continue
    /* Still present elsewhere → the list moved, it did not rename. */
    if (afterSet.has(lower(from))) continue
    /* Already existed → this position merely adopted an existing option. */
    if (beforeSet.has(lower(to))) continue
    pairs.push({ from, to })
  }

  return pairs
}

/**
 * What would move if the current draft were saved?
 *
 * @param {Object} beforeSpecs `product.specs` — what the database holds
 * @param {Object} afterSpecs  `{ Type: [options] }` built from the draft
 * @returns {{ colour: Array<{from:string,to:string}>, size: Array<{from:string,to:string}> }}
 */
export function planVariantRenames(beforeSpecs, afterSpecs) {
  return {
    colour: renamePairs(optionsOf(beforeSpecs, isColourType), optionsOf(afterSpecs, isColourType)),
    size: renamePairs(optionsOf(beforeSpecs, isSizeType), optionsOf(afterSpecs, isSizeType)),
  }
}

export function hasRenames(plan) {
  return Boolean(plan && (plan.colour?.length || plan.size?.length))
}

/** The replacement for one value on one axis, or null when it did not change. */
function replacementFor(value, pairs) {
  for (const pair of pairs || []) if (same(pair.from, value)) return pair.to
  return null
}

/**
 * The key this one becomes after the renames — or the same key.
 * Works on a single-axis key too (`"Green"` stays `"Green"`-shaped, no stray
 * `"Navy|"` invented for a map that never had a size).
 */
export function renamedKey(key, plan) {
  if (!hasRenames(plan)) return key

  const text = String(key ?? '')
  if (!text.includes('|')) {
    const only = replacementFor(text, plan.colour) ?? replacementFor(text, plan.size)
    return only === null ? text : only
  }

  const [colour, size] = splitVariantKey(text)
  const nextColour = replacementFor(colour, plan.colour)
  const nextSize = replacementFor(size, plan.size)
  if (nextColour === null && nextSize === null) return text
  return variantKey(nextColour ?? colour, nextSize ?? size)
}

/**
 * Re-key a `{ 'Colour|Size': 'ASIN' }` map.
 *
 * @returns {{ variants: Object, renamed: Array<{from:string,to:string,asin:string}>,
 *             collisions: Array<{from:string,to:string}> }}
 *
 * Collision policy: unchanged keys claim their slot first, so a rename can
 * never overwrite a value that is already spelled the new way. If both keys
 * exist, the OLD one is kept untouched and reported — dropping either would be
 * a silent data loss, and the old key surfaces in the panel's extras block
 * where it can be cleared by hand.
 */
export function rekeyVariants(variants, plan) {
  const source =
    variants && typeof variants === 'object' && !Array.isArray(variants) ? variants : {}

  const out = {}
  const renamed = []
  const collisions = []

  if (!hasRenames(plan)) {
    for (const [key, asin] of Object.entries(source)) out[key] = asin
    return { variants: out, renamed, collisions }
  }

  for (const [key, asin] of Object.entries(source)) {
    if (renamedKey(key, plan) === key) out[key] = asin
  }

  for (const [key, asin] of Object.entries(source)) {
    const next = renamedKey(key, plan)
    if (next === key) continue

    if (Object.prototype.hasOwnProperty.call(out, next)) {
      collisions.push({ from: key, to: next })
      out[key] = asin
      continue
    }

    out[next] = asin
    renamed.push({ from: key, to: next, asin: String(asin ?? '') })
  }

  return { variants: out, renamed, collisions }
}

/**
 * Re-key a LIST of variant keys — that is `sold_out_variants`, which stores the
 * same `"Colour|Size"` strings. Dedupe is case-insensitive, first spelling wins.
 */
export function rekeyKeys(keys, plan) {
  const list = Array.isArray(keys) ? keys : []
  const out = []
  const renamed = []
  const seen = new Set()

  for (const key of list) {
    if (typeof key !== 'string' || !key.trim()) continue
    const next = renamedKey(key.trim(), plan)
    if (next !== key.trim()) renamed.push({ from: key.trim(), to: next })
    const canonical = lower(next)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push(next)
  }

  return { keys: out, renamed }
}
