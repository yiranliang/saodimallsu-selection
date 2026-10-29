/**
 * Row ⇄ product mapping
 * ─────────────────────
 * Pure functions, no Supabase import — `node scripts/test-mapping.mjs` runs
 * them without a database.
 *
 * TWO THINGS HERE ARE LOAD-BEARING
 *
 * 1. `specs` key order must survive a round trip.
 *    The v4 selection code encodes option VALUES positionally, aligned to
 *    `Object.keys(product.specs)`. That is why the columns are `json` and not
 *    `jsonb` (jsonb sorts keys by length, which would turn Colour,Size into
 *    Size,Colour and silently swap every colour with its size on decode).
 *    This module preserves insertion order and never sorts.
 *
 * 2. The field whitelist.
 *    Anything not named in `normalizeProduct` / `rowToProduct` is dropped.
 *    `sku`, `variantImages`, `hidden`, `soldOutVariants` and `badgeColor` were
 *    each lost once to this; keep the list in sync when a field is added.
 *    Every one of them needs three lines: `shared()`, `rowToProduct()` (the
 *    snake_case rename) and `productToRow()`. Miss the middle one and the field
 *    reads back empty forever while saves appear to work.
 */

import { PLACEHOLDER_IMAGE, normalizeVariantImages } from '../utils/variantImage.js'
import { normalizeSoldOut } from '../utils/soldOut.js'
import { normaliseBadgeColor } from '../utils/badge.js'

export const UNCATEGORISED = 'Uncategorised'

/** Flash-sale fields, product shape. Order = the column order in 09-deal.sql. */
const DEAL_TEXT_KEYS = ['saleStart', 'saleEnd', 'salePrice', 'originalPrice', 'discountLabel']

/** Empty / whitespace / null → `null`, so the column has one "not set" value. */
function textOrNull(value) {
  const text = String(value ?? '').trim()
  return text || null
}

/** Drop blanks, keep the order the options were given in. */
function normalizeSpecs(specs) {
  const out = {}

  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return out

  for (const [type, value] of Object.entries(specs)) {
    const options = Array.isArray(value) ? value : [value]
    const clean = options.filter((option) => option !== undefined && option !== null && option !== '')
    if (clean.length) out[type] = clean.map(String)
  }

  return out
}

function shared(product) {
  const out = {
    name: product?.name || 'Untitled product',
    category: product?.category || UNCATEGORISED,
    image: product?.image || PLACEHOLDER_IMAGE,
    tag: product?.tag || '',
    specs: normalizeSpecs(product?.specs),
  }

  /* Empty string = "no colour", which is what every consumer tests for. An
   * invalid value (a stray 'red', an import typo) normalises to '' rather than
   * reaching an inline style — see utils/badge.js. */
  const badgeColor = normaliseBadgeColor(product?.badgeColor)
  if (badgeColor) out.badgeColor = badgeColor

  const sku = product?.sku === undefined || product?.sku === null ? '' : String(product.sku).trim()
  if (sku) out.sku = sku

  const variantImages = normalizeVariantImages(product?.variantImages)
  if (variantImages) out.variantImages = variantImages

  /* Per-combination stock. Omitted when empty so exports stay clean — the
   * database column defaults to '[]' either way. */
  const soldOut = normalizeSoldOut(product?.soldOutVariants)
  if (soldOut.length) out.soldOutVariants = soldOut

  // Off the storefront but still in the catalogue — codes that already
  // reference it must keep resolving to a name and an image.
  if (product?.hidden === true) out.hidden = true

  // Coming Soon: visible on the storefront, but sizes are locked and it cannot
  // be ordered. Only emitted when true, so exports stay clean.
  if (product?.isTeaser === true) out.isTeaser = true

  /* 大促归属（13-campaign.sql）：true = 归 🔥 大促专区，false / 缺省 = 常规
   * 秒杀。只在 true 时出现，和 isTeaser 同一个约定 —— 导出里不会多出 273 个
   * `isCampaign: false`。 */
  if (product?.isCampaign === true) out.isCampaign = true

  /* Flash sale — five plain-text columns, carried verbatim. No `new Date()`,
   * no timezone, no rounding: the string the admin typed is the string the
   * storefront parses (see utils/deal.js for why that is deliberate).
   *
   * Only emitted when non-empty, so a product with no deal does not grow five
   * empty keys — `shared()` output is what the shipped `data/products.js` and
   * the JSON exports are built from, and 273 × 5 empty strings is noise. */
  for (const key of DEAL_TEXT_KEYS) {
    const text = String(product?.[key] ?? '').trim()
    if (text) out[key] = text
  }

  /* ACC（Amazon Creator Connections）—— 开关和数据分开走：开关只在 true 时
   * 出现（和 isTeaser 一样），ID 只在非空时出现。ID 不跟开关清空，理由见
   * utils/acc.js：那是拿不到第二次的运营资产。 */
  if (product?.hasAcc === true) out.hasAcc = true
  const accId = String(product?.accId ?? '').trim()
  if (accId) out.accId = accId

  /* 副角标 —— 右上角那枚。和 `tag` 完全独立：黑五期间一件商品同时需要
   * 「⚡ 25% OFF」（由 sale_* 算出）和「Black Friday」（运营手填），
   * 挤在一个字段里就只能二选一。只有副文字存在时颜色才有意义，理由与
   * 主角标相同（见 utils/batchBadge.js）。 */
  const subTag = String(product?.subTag ?? '').trim()
  if (subTag) {
    out.subTag = subTag
    const subBadgeColor = normaliseBadgeColor(product?.subBadgeColor)
    if (subBadgeColor) out.subBadgeColor = subBadgeColor
  }

  /* 秒杀专区置顶权重。0 / 负数 = 不置顶，不写进产品形状（导出和
   * data/products.js 会干净很多）。 */
  const dealPriority = Number(product?.dealPriority)
  if (Number.isFinite(dealPriority) && dealPriority > 0) out.dealPriority = Math.trunc(dealPriority)

  return out
}

/**
 * Local / shipped shape → product.
 * Used for `data/products.js` (the Node fallback and the seed source).
 */
export function normalizeProduct(product, index = 0) {
  const id = String(product?.id || `p${String(index + 1).padStart(3, '0')}`)
  return { id, ...shared(product) }
}

/** Database row → product. `sort_order` is tracked separately, not here. */
export function rowToProduct(row) {
  // `shared()` speaks the product shape, so the snake_case columns are renamed
  // on the way in — this is the line that was silently dropping every
  // per-colour photo before.
  return {
    id: String(row.id),
    ...shared({
      ...row,
      variantImages: row.variant_images,
      soldOutVariants: row.sold_out_variants,
      badgeColor: row.badge_color,
      isTeaser: row.is_teaser,
      /* 13-*.sql。没跑过迁移的库读回来是 `undefined` → `false`（常规秒杀），
       * 正好等于拆分之前的行为：所有秒杀都在同一个 Tab 里。 */
      isCampaign: row.is_campaign === true,
      /* The five sale columns are `text` on purpose — nothing parses them on
       * the way in. A `null` column simply does not reach the product shape,
       * so `product.saleStart` is `undefined` and every consumer's falsy check
       * (isDealActive, the editor's empty input) works unchanged. */
      saleStart: row.sale_start,
      saleEnd: row.sale_end,
      salePrice: row.sale_price,
      originalPrice: row.original_price,
      discountLabel: row.discount_label,
      /* ACC. `has_acc` is `not null default false`, so a missing column (the
       * migration has not been run) reads back as `undefined` and `isAcc`
       * correctly says "off" rather than showing a badge nobody can turn off. */
      hasAcc: row.has_acc === true,
      accId: row.acc_id,
      /* 11-*.sql. A database without the migration reads these back as
       * `undefined`, which the shape drops — "no sub badge / not pinned", the
       * same state as before the columns existed. */
      subTag: row.sub_tag,
      subBadgeColor: row.sub_badge_color,
      dealPriority: row.deal_priority,
    }),
  }
}

/**
 * Product → database row.
 * `id` is only included when the caller already has one — new products let the
 * database sequence assign it, which is what makes concurrent inserts safe.
 */
export function productToRow(product, { id, sortOrder } = {}) {
  const row = {
    sku: product?.sku ? String(product.sku).trim() : null,
    name: product?.name || '',
    category: product?.category || UNCATEGORISED,
    image: product?.image || PLACEHOLDER_IMAGE,
    specs: normalizeSpecs(product?.specs),
    variant_images: normalizeVariantImages(product?.variantImages) || {},
    sold_out_variants: normalizeSoldOut(product?.soldOutVariants),
    hidden: product?.hidden === true,
    tag: product?.tag || '',
    /* `null`, not '': the column is nullable and "no colour" is the absence of a
     * value. Writing '' would also work, but then two representations of the same
     * state end up in the table. */
    badge_color: normaliseBadgeColor(product?.badgeColor) || null,
    is_teaser: product?.isTeaser === true,
    /* 大促归属（13-*.sql）。永远是布尔，`not null default false`：写 `false`
     * 才让"在编辑器里把它改回常规"真的落到行上，而不是靠默认值。 */
    is_campaign: product?.isCampaign === true,
    /* `null`, not '': same reasoning as badge_color. An empty string and a
     * missing value would mean the same thing to the storefront but would look
     * like two different states in the table. */
    sale_start: textOrNull(product?.saleStart),
    sale_end: textOrNull(product?.saleEnd),
    sale_price: textOrNull(product?.salePrice),
    original_price: textOrNull(product?.originalPrice),
    discount_label: textOrNull(product?.discountLabel),
    /* `false`, not omitted: the column is `not null default false`, and writing
     * the flag explicitly is what makes "turned it off in the editor" land in
     * the row instead of relying on the default. `acc_id` keeps its value while
     * the switch is off — see utils/acc.js. */
    has_acc: product?.hasAcc === true,
    acc_id: textOrNull(product?.accId),
    /* 副角标 / 置顶（11-*.sql）。和 tag 一样：文字是 `''`、颜色是 `null`，
     * 两个字段只用一种「没设置」的表示。`deal_priority` 是 `not null`，
     * 所以永远写一个整数，不写 null。 */
    sub_tag: String(product?.subTag ?? '').trim(),
    sub_badge_color: normaliseBadgeColor(product?.subBadgeColor) || null,
    deal_priority: Math.max(0, Math.trunc(Number(product?.dealPriority) || 0)),
  }

  const resolvedId = id ?? product?.id
  if (resolvedId) row.id = resolvedId
  /* `sort_order` is deliberately NOT read off the product — only off `options`,
   * and only the creation path passes it. Position is owned by the reorder
   * writers (`reorder_products` / the move helpers); deriving it from a product
   * object means deriving it from a snapshot, and a save built on a snapshot is
   * exactly how a drag would get rolled back. `scripts/test-mapping.mjs` pins
   * this: a product carrying `sortOrder` or `sort_order` still produces no
   * `sort_order` column. */
  if (sortOrder !== undefined) row.sort_order = sortOrder

  return row
}
