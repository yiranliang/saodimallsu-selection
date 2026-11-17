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

/** 尺码轴的几种写法（导入表里可能是英文或中文）。 */
const SIZE_TYPES = new Set(['size', 'sizes', '尺码', '尺寸'])

/**
 * 规格轴的**展示用**名字。
 *
 * 数据里的键是 `Colour`（ASIN 表也按 `Colour|Size` 匹配，改键会打断匹配），
 * 所以只在渲染时换成美式拼写：`Colour` → `Color`、`尺码` → `Size`。
 * 其它自定义轴（`Length`、`Style`）原样返回。
 *
 * @param {unknown} type
 * @returns {string}
 */
export function specTypeLabel(type) {
  const raw = String(type ?? '').trim()
  if (!raw) return ''
  if (isColourType(raw)) return 'Color'
  if (SIZE_TYPES.has(raw.toLowerCase())) return 'Size'
  return raw
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
 * 卡片上那张主图是哪个颜色？
 *
 * 卡片永远显示 `product.image`（网格不换图，见 ProductCard 的说明）。如果运营
 * 把这张主图设成了某个颜色的实拍图，那么点进详情时就应该**默认选中那个颜色** ——
 * 否则她得在十几个色卡里一个个点，才能找到自己刚看到的那件。
 *
 * 比较时只留路径（去协议、去域名、去查询串、小写）：同一张图在亚马逊的不同
 * 站点上会出现 `m.media-amazon.com` / `images-na.ssl-images-amazon.com` 两种
 * 写法，按整串比会漏。不做更模糊的匹配 —— 颜色对错了比不默认更糟。
 *
 * @param {object} product
 * @returns {{ type: string, value: string } | null}
 */
export function colourForMainImage(product) {
  const map = product?.variantImages
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null

  const key = (value) => {
    const url = cleanUrl(value)
    if (!url) return ''
    return url
      .split('#')[0]
      .split('?')[0]
      .replace(/^[a-z]+:\/\//i, '')
      .replace(/^[^/]+/i, '')
      .toLowerCase()
  }

  const main = key(product?.image)
  if (!main) return null

  /* 颜色轴优先（`variantImageFor` 用的是同一套优先级）。 */
  const types = Object.keys(map)
  types.sort((a, b) => Number(isColourType(b)) - Number(isColourType(a)))

  for (const type of types) {
    const byOption = map[type]
    if (!byOption || typeof byOption !== 'object' || Array.isArray(byOption)) continue

    for (const [option, url] of Object.entries(byOption)) {
      if (key(url) && key(url) === main) {
        return { type, value: String(option) }
      }
    }
  }

  return null
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
