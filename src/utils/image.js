/**
 * Image sizing
 * ═════════════
 *
 * The catalogue points at Amazon's image CDN, and every URL arrives with the
 * size the listing page asked for baked into the filename:
 *
 *   https://m.media-amazon.com/images/I/51C4z9rC3vL._AC_SY741_.jpg
 *                                             └──┬──┘ └─┬─┘
 *                                            variant  height
 *
 * `SY741` means "741 px tall". A phone tile is 169 CSS px wide — 338 device
 * pixels at 2× — so the storefront was downloading roughly three times the
 * pixels it could display, for every card, 24 cards at a time. Measured on one
 * real product: 741 → 17.6 kB, 640 → 10.3 kB, 320 → 5.8 kB.
 *
 * Amazon's imaging service resizes on the fly, so the fix is to ask for the
 * size we are about to draw. `sizedImage` only rewrites the `_AC_SY###_` /
 * `_AC_SX###_` token; anything else (placeholders, data URIs, a future CDN)
 * comes back untouched, which is what keeps this safe to apply everywhere.
 *
 * Never build a `srcset` from a URL that did not match — see `imageSrcSet`.
 */

/** `._AC_SY741_.jpg` → captured as prefix / digits / suffix */
const AMAZON_SIZE = /(\._AC_S[XY])(\d+)(_\.(?:jpe?g|png|webp|avif))/i

/**
 * @param {string} url
 * @param {number} px   target height (Amazon's SY…), ignored when the URL has
 *                      no size token
 * @returns {string} the original string when it cannot be resized
 */
export function sizedImage(url, px) {
  const raw = String(url ?? '')
  const size = Math.round(Number(px) || 0)
  if (!raw || size <= 0) return raw
  return raw.replace(AMAZON_SIZE, (_, head, _current, tail) => `${head}${size}${tail}`)
}

/**
 * `srcset` for a resizable URL, or `undefined` when it is not resizable.
 *
 * Returning undefined matters: a srcset whose entries all point at the same
 * URL would tell the browser "this file is 320 px wide" and make it pick by a
 * lie. No token, no srcset, plain `src`.
 */
export function imageSrcSet(url, widths = [320, 640]) {
  const list = widths.map((w) => Math.round(Number(w) || 0)).filter((w) => w > 0)
  if (list.length < 2) return undefined
  const first = sizedImage(url, list[0])
  if (first === String(url ?? '')) return undefined
  return list.map((w) => `${sizedImage(url, w)} ${w}w`).join(', ')
}

/**
 * `sizes` for the storefront grid.
 *
 * Matches ProductGrid exactly: 2 columns under 768, 3 under 1024, 4 above, with
 * the page capped at max-w-6xl. Being honest here is the difference between the
 * browser picking the 320 or the 640 file — an over-stated `sizes` silently
 * doubles the bytes.
 */
export const CARD_IMAGE_SIZES = '(min-width: 1024px) 22vw, (min-width: 768px) 30vw, 46vw'

/** The detail sheet is a square filling the sheet, capped at max-w-lg */
export const DETAIL_IMAGE_SIZES = '(min-width: 512px) 512px, 92vw'
