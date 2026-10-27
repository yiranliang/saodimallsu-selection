/**
 * Variant images
 * ══════════════
 * A product can carry one image per option value, so switching colour on the
 * storefront swaps the photo instead of showing a generic shot:
 *
 *   variantImages: {
 *     Colour: { Black: 'https://…/black.jpg', White: 'https://…/white.jpg' },
 *   }
 *
 * The shape is keyed by spec TYPE first, then by option VALUE, which keeps it
 * open to other axes later (Size, Length, …) without a schema change.
 *
 * TWO RULES, BOTH IMPORTANT
 *   1. A missing entry is not an error — it falls back to the product's default
 *      `image`, and from there to the placeholder. The storefront must never
 *      render a broken image just because a colour has no photo yet.
 *   2. Only URLs are stored. Uploads were removed deliberately: base64 payloads
 *      blow through the ~5MB localStorage budget after a handful of photos.
 *
 * Pure functions only — this module is imported by the Node CLI decoder too.
 */

export const PLACEHOLDER_IMAGE = './placeholders/placeholder.svg'

/** Spec type names that mean "colour" in the sheets we import */
const COLOUR_TYPES = new Set(['colour', 'color', '颜色', '色', '颜色分类'])

export function isColourType(type) {
  return COLOUR_TYPES.has(String(type || '').trim().toLowerCase())
}

function cleanUrl(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The variant image for a specific combination, or '' when none is configured.
 *
 * Colour wins over every other axis: if a product has both a Colour and a Size
 * photo, the colour one is the one the creator expects to see change.
 */
export function variantImageFor(product, specs) {
  const map = product?.variantImages
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ''

  const chosen = Object.entries(specs || {}).filter(([, value]) => value)
  if (!chosen.length) return ''

  // Colour first, then everything else in declaration order
  chosen.sort((a, b) => Number(isColourType(b[0])) - Number(isColourType(a[0])))

  for (const [type, value] of chosen) {
    const byOption = map[type]
    if (!byOption || typeof byOption !== 'object' || Array.isArray(byOption)) continue

    const direct = cleanUrl(byOption[value])
    if (direct) return direct

    // Tolerate case drift between the option list and a hand-typed key
    const lower = String(value).toLowerCase()
    for (const [option, url] of Object.entries(byOption)) {
      if (String(option).toLowerCase() === lower) {
        const match = cleanUrl(url)
        if (match) return match
      }
    }
  }

  return ''
}

/**
 * The image to actually render: variant → product default → placeholder.
 * Never returns an empty string, so an <img> always has something to load.
 */
export function resolveProductImage(product, specs) {
  return variantImageFor(product, specs) || cleanUrl(product?.image) || PLACEHOLDER_IMAGE
}

/** Every configured variant URL for one product — used by the admin search */
export function variantImageUrls(product) {
  const map = product?.variantImages
  if (!map || typeof map !== 'object') return []
  return Object.values(map).flatMap((byOption) =>
    byOption && typeof byOption === 'object' ? Object.values(byOption) : [],
  )
}

/**
 * Sanitise a variantImages object coming from localStorage or an editor draft.
 * Drops empty URLs and empty option names; returns null when nothing is left so
 * the field can be omitted from the stored product entirely.
 */
export function normalizeVariantImages(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const clean = {}
  for (const [type, byOption] of Object.entries(input)) {
    const key = String(type || '').trim()
    if (!key || !byOption || typeof byOption !== 'object' || Array.isArray(byOption)) continue

    const entry = {}
    for (const [option, url] of Object.entries(byOption)) {
      const optionKey = String(option || '').trim()
      const value = cleanUrl(url)
      if (optionKey && value) entry[optionKey] = value
    }
    if (Object.keys(entry).length) clean[key] = entry
  }

  return Object.keys(clean).length ? clean : null
}
