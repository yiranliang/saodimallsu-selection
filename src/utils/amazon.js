/**
 * Amazon listing links
 * ════════════════════
 * Filling in photos means looking at the listing, and the listing lives on
 * Amazon. Before this, the round trip was: open the storefront, hover the card
 * to read the URL, copy the ASIN, paste it into amazon.com/dp/…, come back.
 * The editor already knows every ASIN for the product — so it can hand over a
 * link and skip three of those steps.
 *
 * WHY "THE FIRST VALID ASIN" NEEDS A DEFINITION
 * ─────────────────────────────────────────────
 * `asins.variants` is a **jsonb** column, and jsonb does not preserve insertion
 * order: Postgres stores object keys sorted by length first, then bytewise.
 * `Object.keys()` on what the API returns is therefore an accident of the
 * storage format — the "first" key can change after any rewrite of the row, and
 * it is not the first anything a human recognises.
 *
 * The caller passes rows in the order the panel SHOWS them (colours in declared
 * order, sizes smallest → largest), and this picks the first usable one. So the
 * link points at the listing beside the top of the list — the one the operator
 * was about to look up anyway. Same reason `utils/sizes.js` sorts at render
 * only: never infer meaning from stored ordering.
 *
 * Pure, dependency-free — imported by `scripts/test-amazon-link.mjs`.
 */

/** Every ASIN resolves to the same path; only the suffix changes. */
export const AMAZON_DP_BASE = 'https://www.amazon.com/dp/'

/**
 * 10 alphanumerics, uppercase — the shape Amazon uses and the importer
 * enforces. The single definition: `asinStore.isValidAsin` tests against this
 * same pattern, so "the panel accepts it" and "the link will open it" cannot
 * drift apart.
 */
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/

/**
 * Trim + uppercase one ASIN, `''` when it is not usable.
 *
 * A lowercase paste is normalised rather than rejected: the save path
 * uppercases too (`normaliseAsin`), so the link would otherwise disagree with
 * the value the panel is about to store.
 */
export function asinOf(value) {
  const asin = String(value ?? '').trim().toUpperCase()
  return ASIN_PATTERN.test(asin) ? asin : ''
}

/**
 * The listing URL for one ASIN, or `null` when there is nothing to open.
 *
 * `null` rather than a URL to `dp/` with an empty tail: a broken link that
 * lands on Amazon's home page looks like a working feature until someone
 * clicks it. The caller hides the link instead.
 *
 * The pattern is what makes this safe to put in an `href`: a value carrying
 * quotes, spaces or `<` cannot pass it, so no amount of pasted junk can escape
 * the attribute.
 */
export function amazonUrl(asin) {
  const clean = asinOf(asin)
  return clean ? `${AMAZON_DP_BASE}${clean}` : null
}

/**
 * First row that has a usable ASIN, in the order given.
 *
 * `rows` are `{ key, label, asin }` — the editor's own ASIN-row shape, so the
 * label ("Black / M") travels with the link and the operator can see which
 * variant they are about to look at. Blank and truncated ASINs are skipped, not
 * returned: a row that would open the wrong listing is worse than no link.
 */
export function firstListing(rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const asin = asinOf(row?.asin)
    if (!asin) continue
    return {
      asin,
      url: `${AMAZON_DP_BASE}${asin}`,
      label: String(row?.label || ''),
      key: String(row?.key || ''),
    }
  }
  return null
}
