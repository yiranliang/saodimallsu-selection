import { memo, useState } from 'react'
import { Heart, ChevronDown } from './icons.jsx'
import QuantityStepper from './QuantityStepper.jsx'
import ProductImage from './ProductImage.jsx'
import { sizedImage, imageSrcSet, CARD_IMAGE_SIZES } from '../utils/image.js'
import { PLACEHOLDER_IMAGE } from '../utils/variantImage.js'
import { soldOutSummary } from '../utils/soldOut.js'
import { badgeStyle } from '../utils/badge.js'
import { isTeaser } from '../utils/teaser.js'
import { BADGE_ZONE, badgeStackFor, dealPhase, dealPriceInfo } from '../utils/deal.js'

/**
 * Product card
 * ──────────────
 * Image (badge + heart) → name → Amazon link → variant chips → action row.
 *
 * THE IMAGE IS STATIC
 * The grid always shows the product's own `image`. It used to swap to the
 * chosen colour's photo, which made the grid shuffle visually as the creator
 * browsed and — worse — meant two cards of the same piece looked unrelated.
 * The variant photo belongs in the detail sheet, where the creator is looking
 * at one combination deliberately.
 *
 * ONE PRODUCT, SEVERAL LINES
 * A piece can be in the selection twice (Black/M and White/L). With one line the
 * card behaves exactly as before: chips + a stepper for that line. With two or
 * more there is no single quantity to step, so the action becomes "Manage" and
 * opens the sheet — which is also where individual lines can be removed.
 */
function ProductCard({
  product,
  lines = [],
  amazonUrl = '',
  campaign = '',
  onToggle,
  onIncrement,
  onDecrement,
  onOpenDetail,
  showPrice = false,
}) {
  const [beat, setBeat] = useState(false)
  const selected = lines.length > 0
  const single = lines.length === 1
  const units = lines.reduce((sum, line) => sum + line.qty, 0)

  const specTypes = Object.keys(product.specs || {})

  const handleToggle = (e) => {
    e.stopPropagation()
    if (!selected) {
      setBeat(true)
      setTimeout(() => setBeat(false), 420)
    }
    onToggle(product)
  }

  const openDetail = (e) => {
    e.stopPropagation()
    onOpenDetail(product)
  }

  /* Cap the chip row — a product with 11 colours would otherwise push the
   * action button off the card. */
  const shown = lines.slice(0, 3)
  const overflow = lines.length - shown.length

  /* Badge only when the whole piece is gone. A partial sell-out is left off the
   * card on purpose — badging it would read as "this style is unavailable" and
   * the creator would scroll past a piece she can still order in two colours.
   * The detail sheet greys the individual combinations. */
  const { all: allSoldOut } = soldOutSummary(product)

  /* 左上角的角标栈 —— 最多两行（规则全部在 `badgeStackFor`，卡片和详情
   * 弹层共用，避免两边各写一遍然后漂移）。
   *
   * **面不同，内容不同**（这是本版的重点）：
   *   - 常规货架（这里）：身份 + 强推标，**不出折扣**。货架上每一件都在被
   *     比较，一行 `50% OFF` 会把视线从"这是什么"拉到"多少钱"。
   *   - ⚡ 专区（`showPrice` 为真）：第一行不写 `Limited Deal`（整区都在秒杀，
   *     写它等于零信息），第二行才是折扣。
   *   - ACC 在卡片上不再出现 —— 佣金是点进去才判断的事，详情页有一整块。
   *
   * `showPrice` 就是"这张卡在不在秒杀专区"，所以直接拿它当 zone，不另加
   * 一个 prop（两个布尔值迟早会有一个忘记同步）。
   *
   * `campaign` 是这个专区的活动名（后台可改的那个 Tab 名）。专区内部不重复
   * 挂同一场活动的角标 —— 那正是"点进 Black Friday 目录，卡片上还顶着一枚
   * Black Friday"的来源。判定在 `badgeStackFor` 里，卡片只负责把名字带过去。 */
  const teaser = isTeaser(product)
  const badges = badgeStackFor(product, undefined, {
    zone: showPrice ? BADGE_ZONE.DEALS : BADGE_ZONE.CATALOGUE,
    campaign,
  })

  /* Flash sale. The price row only exists in the deals tab (`showPrice`) —
   * in the normal catalogue a card is ~169px wide, so the number waits for the
   * tab where prices are the point.
   *
   * `Date.now()` is read at render, not on a timer: 24 interval timers for 24
   * cards is not worth it, so a deal that expires while the grid sits untouched
   * updates on the next render. The sheet does tick — see ProductDetail. */
  const phase = dealPhase(product)
  const priceInfo = !teaser && (phase === 'live' || phase === 'scheduled') ? dealPriceInfo(product) : null

  return (
    <article
      className="product-card group relative flex flex-col"
      onClick={() => onOpenDetail(product)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail(product)
        }
      }}
      aria-label={`View ${product.name}`}
    >
      {/* ── image ──
          Amazon's layout: square frame, white, `object-contain`, no chrome.

          The square is the part that matters. It is the only ratio that tiles
          cleanly when the source photos run from 1:2.3 trousers to near-square
          bras — any other frame leaves one category looking shrunken or sliced.

          `contain` inside a square is what makes the size *differences* stop
          reading as a mistake: every photo is fully visible, and whatever gap
          is left over is filled with the same white the photos were shot on, so
          the frame has no visible edge at all. That is the whole trick — the
          white is doing the work, not the fit.

          Which is also why there is no border here and none on the card: a grey
          hairline next to a letterboxed photo turns invisible padding into a
          visible box, and the product starts to look small inside a panel. On
          `bg-cream` the white card still has an edge of its own.

          The hover zoom is safe with `contain` — it grows into its own padding
          first, so nothing is cut off. */}
      <div className="relative aspect-square overflow-hidden bg-white">
        {/* 320/640 instead of whatever the listing page asked for: a tile is
            ~169 CSS px on a phone, so the 741 px file was 3× the pixels and 3×
            the bytes. `sizes` matches ProductGrid's columns exactly — overstate
            it and the browser quietly downloads the bigger file. */}
        <ProductImage
          src={sizedImage(product.image, 320)}
          srcSet={imageSrcSet(product.image)}
          sizes={CARD_IMAGE_SIZES}
          fallback={PLACEHOLDER_IMAGE}
          alt={product.name}
          className="h-full w-full object-contain transition-transform duration-500 ease-out group-hover:scale-105"
        />

        {(badges.length > 0 || allSoldOut) && (
          /* 纵向 Flex，6px 间距（gap-1.5）：两行之间留白足够，又不会把照片
             压掉太多。`max-w` 按卡片宽度算，长文案一律截断 —— 一枚角标撑到
             照片中间比没有角标更难看。 */
          <div
            data-badge-stack
            className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-1.25rem)] flex-col items-start gap-1.5"
          >
            {badges.map((entry, index) => {
              const style = badgeStyle(entry.value)
              return (
                <span
                  key={`${entry.kind}-${index}`}
                  style={style || undefined}
                  className={`max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
                    style ? '' : 'bg-charcoal/80 text-cream backdrop-blur-sm'
                  }`}
                >
                  {entry.text}
                </span>
              )
            })}
            {allSoldOut && (
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-charcoal/70 shadow-sm backdrop-blur-sm">
                Sold out
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleToggle}
          aria-pressed={selected}
          aria-label={selected ? `Remove ${product.name}` : `Select ${product.name}`}
          className={`absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors duration-200 ${
            selected ? 'bg-accent text-white' : 'bg-white/85 text-charcoal hover:bg-white'
          } ${beat ? 'animate-heartbeat' : ''}`}
        >
          <Heart className="h-4 w-4" filled={selected} />
        </button>

        {selected && (
          <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent" />
        )}

        {/* Units badge — the only place the card shows a count when there are
            several variants, since the stepper is replaced by Manage */}
        {!single && units > 0 && (
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-charcoal/85 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-cream backdrop-blur-sm">
            × {units}
          </span>
        )}
      </div>

      {/* ── info ── */}
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {/* Three lines on a phone, two from sm up. A card is only ~169px wide
            there, so two lines held about 20 characters — long names read as a
            single chopped-off line. The min-height matches the clamp so cards
            with a short name still occupy the same box and the grid rows stay
            aligned. `title` gives desktop users the full name on hover. */}
        <h3
          title={product.name}
          className="line-clamp-3 min-h-[54px] text-[13px] font-medium leading-snug text-charcoal sm:line-clamp-2 sm:min-h-[42px] sm:text-[15px]"
        >
          {product.name}
        </h3>

        {/* Price — the card has never shown one, so this row only exists while a
            deal is running. Red for the live price (the shop's own deal colour,
            not the Chinese-market red/green convention: this is a US storefront
            and the strike-through already carries the direction). */}
        {showPrice && priceInfo && (
          <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
            {/* No strikethrough: with ranges (`$15 – $25`) a second crossed-out
                range is unreadable at 11px, and the badge already says how much
                is off. */}
            <span className="text-[14.5px] font-semibold leading-none tabular-nums text-red-600">
              {priceInfo.price}
            </span>
          </div>
        )}

        {/* Amazon — stops propagation so tapping it does not open the sheet */}
        {amazonUrl ? (
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-charcoal-light/80 underline decoration-charcoal/20 underline-offset-2 transition hover:text-charcoal hover:decoration-charcoal/50"
          >
            View on Amazon
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="mt-1 text-[11px] text-charcoal-light/45">Listing not linked yet</span>
        )}

        {/* Variants */}
        <div className="mt-1.5 min-h-[20px]">
          {specTypes.length === 0 ? (
            <span className="text-[11px] text-charcoal-light/70">One size</span>
          ) : lines.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {shown.map((line) => (
                <span
                  key={line.key}
                  className="rounded bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium leading-4 text-charcoal/75"
                >
                  {Object.values(line.specs).filter(Boolean).join(' / ')}
                  {line.qty > 1 && (
                    <span className="ml-1 tabular-nums text-charcoal/50">×{line.qty}</span>
                  )}
                </span>
              ))}
              {overflow > 0 && (
                <span className="rounded bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium leading-4 text-charcoal/50">
                  +{overflow}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] leading-4 text-charcoal-light">
              {specTypes
                .map((type) => {
                  const n = product.specs[type].length
                  return `${n} ${type.toLowerCase()}${n > 1 ? 's' : ''}`
                })
                .join(' · ')}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-end pt-2.5">
          {single ? (
            <QuantityStepper
              qty={lines[0].qty}
              onIncrement={() => onIncrement(lines[0].key)}
              onDecrement={() => onDecrement(lines[0].key)}
            />
          ) : selected ? (
            <button
              type="button"
              onClick={openDetail}
              className="flex w-full items-center justify-center gap-1 rounded-full bg-cream-dark px-3 py-1.5 text-[11px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95 sm:text-xs"
            >
              Manage
              <span className="tabular-nums text-charcoal/50">{lines.length}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleToggle}
              className="w-full rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition-all duration-200 hover:bg-charcoal/85 active:scale-90 sm:text-xs"
            >
              {specTypes.length > 0 ? 'Choose options' : 'Select'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Why a custom comparator instead of `memo(ProductCard)`
 * ────────────────────────────────────────────────────
 * The parent rebuilds `lines` on every render (`linesFor(id)` filters the cart),
 * so a shallow compare would report "changed" for all 24 cards every time, and
 * the memo would cost more than it saved.
 *
 * Comparing the line contents is exact and cheap: a product has a handful of
 * variants at most, and a line only matters here through its key and quantity —
 * which is precisely what the card draws.
 */
function sameCard(prev, next) {
  if (prev.product !== next.product) return false
  if (prev.showPrice !== next.showPrice) return false
  if (prev.campaign !== next.campaign) return false
  if (prev.amazonUrl !== next.amazonUrl) return false
  if (prev.onToggle !== next.onToggle) return false
  if (prev.onOpenDetail !== next.onOpenDetail) return false
  if (prev.onIncrement !== next.onIncrement) return false
  if (prev.onDecrement !== next.onDecrement) return false

  const a = prev.lines || []
  const b = next.lines || []
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].qty !== b[i].qty) return false
  }
  return true
}

export default memo(ProductCard, sameCard)
