import { memo, useState } from 'react'
import { Heart, ChevronDown } from './icons.jsx'
import QuantityStepper from './QuantityStepper.jsx'
import ProductImage from './ProductImage.jsx'
import { sizedImage, imageSrcSet, CARD_IMAGE_SIZES } from '../utils/image.js'
import { PLACEHOLDER_IMAGE } from '../utils/variantImage.js'
import { soldOutSummary } from '../utils/soldOut.js'
import { listingKnownFor } from '../store/linkStore.js'
import { badgeStyle } from '../utils/badge.js'
import { isTeaser } from '../utils/teaser.js'
import {
  BADGE_ZONE,
  cardCountdown,
  dealPhase,
  dealPriceInfo,
  dealWindow,
  trustBadgesFor,
} from '../utils/deal.js'

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
  /* 这张卡在哪个面上：`catalogue` / `regular` / `campaign`。价格行和角标栈
   * 都跟着它走 —— 三个值比"两个布尔"更难对错（见 badgeStackFor 的注释）。 */
  zone = BADGE_ZONE.CATALOGUE,
  /* 常规秒杀那屏的"现在"。父组件一个 timer 服务整屏，只有那一屏才传；
   * 常规货架不传，卡片就不会因为倒计时一秒一刷。 */
  now,
  /* 整份选款已满（`MAX_CART_ITEMS`）：卡上的步进器 `+` 置灰。 */
  atCap = false,
}) {
  const [beat, setBeat] = useState(false)
  const selected = lines.length > 0
  const single = lines.length === 1
  const units = lines.reduce((sum, line) => sum + line.qty, 0)

  const specTypes = Object.keys(product.specs || {})

  const handleToggle = (e) => {
    e.stopPropagation()
    if (!orderable) return
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
   * The detail sheet greys the individual combinations.
   *
   * "No ASIN = sold out" is folded in via `asinLookup`: a piece whose every
   * combination lacks a listing is unorderable, so it reads as sold out here
   * and the heart/button below is disabled. */
  const asinLookup = (colour, size) => listingKnownFor(product.id, colour, size)
  const { all: allSoldOut } = soldOutSummary(product, asinLookup)
  const orderable = specTypes.length === 0 || !allSoldOut

  /* 运营徽章 —— 图片上**不再有任何角标**（0 遮挡），徽章挪进信息区，用极细
   * 线框渲染。
   *
   * 只认运营手填的属性标（Bestseller / New）。大促/秒杀身份（Black Friday /
   * Limited Deal）一律不显示：想看大促的人会去顶部专区，货架上不该被活动标
   * 刷屏。`campaign` 仍要传进去 —— 自定义活动名（`Spring Refresh`）没有词表
   * 可认，只能靠和当前 Tab 比对来识别并隐藏。 */
  const teaser = isTeaser(product)
  const nowValue = now ?? Date.now()
  const trustBadges = trustBadgesFor(product, { campaign })
  /* 价格行只在两个秒杀专区出现：货架上每件都在被比较，价格要到专区里才有意义。 */
  const showPrice = zone !== BADGE_ZONE.CATALOGUE

  /* Flash sale. `Date.now()` is read at render, not on a timer: in the catalogue
   * 24 interval timers for 24 cards is not worth it, so a deal that expires while
   * the grid sits untouched updates on the next render. The regular deals tab is
   * the one place that DOES tick — see the `now` prop and SelectionPage. */
  const phase = dealPhase(product, nowValue)
  const priceInfo = !teaser && (phase === 'live' || phase === 'scheduled') ? dealPriceInfo(product) : null

  /* 倒计时只挂在常规秒杀那屏：大促的时间是固定的，红人关心的是折扣。 */
  const saleWindow = zone === BADGE_ZONE.REGULAR ? dealWindow(product, nowValue) : null
  const countdown = saleWindow
    ? cardCountdown(phase, phase === 'scheduled' ? saleWindow.msUntilStart : saleWindow.msLeft)
    : null

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
          Amazon's layout: white frame, `object-contain`, no chrome.

          画框是 **4:5 的竖长方形**（比 1:1 更接近 Lookbook，模特能露更多），
          但**照片一律 `contain`、绝不裁切**：原图从 1:2.3 的裤子到接近方形
          的胸衣都有，用 `cover` 会把两侧或上下切掉，衣服直接变形。
          多出来的空白由画框的 `bg-white` 兜底 —— 商品图本来就是白底拍的，
          所以留白和背景融为一体，看不出"画框"的边界。这正是它显干净的原因。

          居中（`object-center`）+ 绝对定位填满：图片的固有比例永远影响不到
          画框尺寸，网格因此不会因为某张长图而错位。

          The hover zoom is safe with `contain` — it grows into its own padding
          first, so nothing is cut off. */}
      <div
        style={{ aspectRatio: '4 / 5' }}
        className="relative aspect-[4/5] w-full shrink-0 overflow-hidden bg-white p-0"
      >
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
          className="absolute inset-0 h-full w-full object-contain object-center transition-transform duration-500 ease-out group-hover:scale-105"
        />

        <button
          type="button"
          onClick={handleToggle}
          disabled={!orderable && !selected}
          aria-pressed={selected}
          aria-disabled={!orderable && !selected}
          aria-label={selected ? `Remove ${product.name}` : `Select ${product.name}`}
          className={`absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors duration-200 ${
            !orderable && !selected
              ? 'cursor-not-allowed bg-white/60 text-charcoal/35'
              : selected
                ? 'bg-accent text-white'
                : 'bg-white/85 text-charcoal hover:bg-white'
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
          <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium tabular-nums text-charcoal shadow-sm">
            × {units}
          </span>
        )}
      </div>

      {/* ── info ── */}
      <div className="flex flex-1 flex-col pb-0.5 pt-2">
        {/* 标题：字号 14/15px、行距收紧，跟图片上那枚 11px 的标拉开两级 ——
            读起来是"标题 + 小标"，而不是两块同重的文字。 */}
        <h3
          title={product.name}
          className="line-clamp-2 text-[14px] font-medium leading-[1.3] tracking-[-0.01em] text-charcoal sm:text-[15px]"
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

        {/* 常规秒杀的紧迫感：`Ends in 05:12:33` / `Starts in 2d 4h`。
            大促那屏没有这一行 —— 大促的时间是固定的，数字只会占地方。 */}
        {countdown && (
          <p
            data-deal-countdown={countdown.mode}
            className="mt-0.5 text-[10.5px] leading-tight tabular-nums text-charcoal-light"
          >
            {countdown.lead}{' '}
            <span className="font-medium text-red-600">{countdown.value}</span>
          </p>
        )}

        {/* Amazon — stops propagation so tapping it does not open the sheet */}
        {amazonUrl ? (
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-charcoal-light/80 underline decoration-charcoal/20 underline-offset-2 transition hover:text-charcoal hover:decoration-charcoal/50"
          >
            View on Amazon
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="mt-0.5 text-[11px] text-charcoal-light/45">Listing not linked yet</span>
        )}

        {/* Variants */}
        <div className="mt-1 min-h-[18px]">
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

        {/* 运营徽章：图片上已清空，改到这里用**极细线框**显示 —— 无底色、
            10px、深灰字、2px 小圆角。`flex-wrap` + `gap-1`：一个 tag 里写
            `Bestseller, New` 会并排成两枚，写不下的自然换行。 */}
        {trustBadges.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {trustBadges.map((badge) => {
              const custom = badgeStyle(badge.value)
              return (
                <span
                  key={badge.text}
                  style={
                    custom
                      ? { borderColor: custom.backgroundColor, color: custom.backgroundColor }
                      : undefined
                  }
                  className="max-w-full truncate rounded-[2px] border border-charcoal/50 px-1.5 py-px text-[10px] font-semibold leading-4"
                >
                  {badge.text}
                </span>
              )
            })}
          </div>
        )}

        {/* 转化按钮：**没有按钮**。
            参考独立站的做法 —— 一行带细下划线的深灰文字，悬停时下划线变深。
            实心黑胶囊会把视线从照片上抢走，而照片才是这张卡的主角。
            触摸面积靠 `min-h-[44px]` + 左右各 4px 的不可见内边距撑住，
            手机上点起来和原来的胶囊一样大，只是看起来轻。 */}
        <div className="mt-auto flex items-center">
          {single ? (
            <QuantityStepper
              qty={lines[0].qty}
              onIncrement={() => onIncrement(lines[0].key)}
              onDecrement={() => onDecrement(lines[0].key)}
              incrementDisabled={atCap}
            />
          ) : selected ? (
            <button
              type="button"
              onClick={openDetail}
              className="-ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-[11.5px] font-medium text-charcoal underline decoration-charcoal/25 underline-offset-4 transition hover:decoration-charcoal/60 active:opacity-60 sm:text-xs"
            >
              Manage
              <span className="tabular-nums text-charcoal/45">{lines.length}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          ) : !orderable ? (
            <span className="inline-flex min-h-[44px] items-center text-[11.5px] font-medium text-charcoal/35 sm:text-xs">
              Sold out
            </span>
          ) : (
            <button
              type="button"
              onClick={handleToggle}
              className="-ml-1 inline-flex min-h-[44px] items-center px-1 text-[11.5px] font-medium text-charcoal underline decoration-charcoal/25 underline-offset-4 transition hover:decoration-charcoal/60 active:opacity-60 sm:text-xs"
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
  if (prev.zone !== next.zone) return false
  if (prev.now !== next.now) return false
  if (prev.atCap !== next.atCap) return false
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
