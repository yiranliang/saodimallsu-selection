/**
 * 货号 / SKU helpers
 * ══════════════════
 *
 * Two identifiers, two jobs:
 *
 *   id    Internal, stable, opaque — p001, p002, … Assigned once at import and
 *         never changed. Selection codes store this, so reordering or deleting
 *         products cannot corrupt a code that is already out in the wild.
 *   sku   The original 货号 exactly as it appears in the spreadsheet. This is
 *         what ops recognises, what the ASIN map is keyed by, and what the
 *         order export shows.
 *
 * Keeping them separate means a 货号 with spaces or slashes ("AMZ 1003/Pro")
 * never has to be mangled into an id, and renaming a 货号 never invalidates
 * an existing selection code.
 */

/** The 货号 to show a human. Falls back to the id for legacy products. */
export function skuOf(product) {
  return product?.sku || product?.id || ''
}

/**
 * Does this product match a free-text search?
 * Matches id, 货号, name, category, and every ASIN mapped to its 货号.
 *
 * @param {Object} product
 * @param {string} query
 * @param {Object} asinMap  { [货号]: { 'Colour|Size': 'ASIN' } } — data/asins.js
 */
export function matchesQuery(product, query, asinMap = {}) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true

  const variants = asinMap[skuOf(product)] || {}
  const asins = Array.isArray(variants) ? variants : Object.values(variants)

  const haystack = [
    product?.id,
    product?.sku,
    product?.name,
    product?.category,
    ...asins,
  ]

  return haystack
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q))
}

/**
 * Pull the colour and size out of a spec object, whatever the type names are.
 * The variant map is keyed by these two, so a product with extra spec types
 * still resolves.
 */
export function specPair(specs) {
  let colour = ''
  let size = ''

  for (const [type, value] of Object.entries(specs || {})) {
    const key = String(type).trim().toLowerCase()
    if (!colour && (key === 'colour' || key === 'color' || key === '颜色')) colour = value
    else if (!size && (key === 'size' || key === '尺码' || key === '尺寸')) size = value
  }

  return { colour, size }
}

/**
 * Canonical variant key: `"Green|M"`, `"Green|"` for a one-size piece.
 *
 * ONE definition, three consumers: `asins.variants` (which combination has an
 * ASIN), `product_links` (which combination has a listing), and
 * `sold_out_variants` (which combination has no stock). If these ever drift,
 * a combination can be in stock, linked, and invisible all at once.
 *
 * Lives here rather than in `utils/asinStore.js` because that module imports
 * Supabase and therefore cannot be loaded by the Node test suite.
 */
export function variantKey(colour, size) {
  return `${colour || ''}|${size || ''}`
}
