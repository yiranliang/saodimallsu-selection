import ProductCard from './ProductCard.jsx'
import { Bag } from './icons.jsx'
import { brandConfig } from '../data/products.js'
import { PAGE_SIZE } from '../utils/catalogue.js'

/** 骨架屏画多少块：和一次加载的页数一致（25）。宽屏 5 列正好 5 行整，
 *  手机 2 列是 12 行半 —— 骨架比真实内容多一点也不会有"跳一下"的错觉，
 *  少才会。 */
const SKELETON_CARDS = PAGE_SIZE

/**
 * Product grid
 * ──────────────
 * 2 columns on phones → 3 on tablets → 4 on desktop.
 *
 * Three states, and the order matters:
 *   loading → skeleton (never a white screen)
 *   error   → what happened + a retry, not an empty catalogue that reads as
 *             "we have no products"
 *   ready   → the cards, faded in
 */
export default function ProductGrid({
  products,
  loading,
  error = '',
  onRetry,
  query = '',
  onClearSearch,
  linesFor,
  amazonUrlFor,
  onToggle,
  onIncrement,
  onDecrement,
  onOpenDetail,
  /* 这张网格在哪个面上：`catalogue` / `regular`（常规秒杀）/ `campaign`（大促）。
   * 卡片的价格行、角标栈和倒计时都跟着它走。 */
  zone,
  /* 常规秒杀那屏的"现在"（父组件一个 timer 服务整屏）；其他面不传。 */
  now,
  /* 整份选款已满（`MAX_CART_ITEMS`）：卡片步进器的 `+` 置灰。 */
  atCap = false,
  /* 这个专区的活动名（后台改的 Tab 名）。专区内部不重复挂同名角标，
   * 见 `badgeStackFor`。普通目录传空串。 */
  campaign = '',
}) {
  if (loading) return <GridSkeleton />

  if (!products.length) {
    if (error) {
      return (
        <div className="mx-auto max-w-7xl px-5 py-20 text-center sm:px-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cream-dark text-charcoal-light">
            <Bag className="h-7 w-7" />
          </div>
          <h3 className="mt-5 text-base font-medium text-charcoal">Could not load the edit</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-charcoal-light">
            {error}. Check the connection and try again — nothing you picked is lost.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-full bg-accent px-5 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-accent-dark active:scale-[0.97]"
            >
              Try again
            </button>
          )}
        </div>
      )
    }

    const searching = Boolean(query)

    return (
      <div className="mx-auto max-w-7xl px-5 py-20 text-center sm:px-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cream-dark text-charcoal-light">
          <Bag className="h-7 w-7" />
        </div>
        <h3 className="mt-5 text-base font-medium text-charcoal">
          {searching ? 'No styles match' : 'Nothing here yet'}
        </h3>
        <p className="mt-1.5 text-sm text-charcoal-light">
          {searching
            ? `Nothing matches “${query}”. Try a style number, or part of the name.`
            : 'Try another category — this one is still being put together.'}
        </p>
        {searching && onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="mt-4 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25"
          >
            Clear search
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      {/* `fade-up` fires once, when this element replaces the skeleton. CSS only —
          no library, no image, no extra request. */}
      <div className="fade-up grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            lines={linesFor(product.id)}
            amazonUrl={amazonUrlFor(product.id)}
            onToggle={onToggle}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            onOpenDetail={onOpenDetail}
            zone={zone}
            now={now}
            atCap={atCap}
            campaign={campaign}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Loading placeholder
 * ───────────────────
 * Pure CSS: grey blocks, one spinning ring, no image, no video, no data URI.
 * The shapes match ProductCard's real geometry (square photo, name line,
 * category line, button) so the grid does not jump when the data lands.
 *
 * The ring is a sibling of the brand square, not its parent: a transform on the
 * parent would rotate the letter too, and the logo is not supposed to spin.
 */
function GridSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="flex flex-col items-center gap-3 pb-7 pt-1">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span className="brand-spinner absolute inset-0" aria-hidden="true" />
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-white">
            {brandConfig.logoText}
          </div>
        </div>
        <p className="text-[11.5px] tracking-[0.08em] text-charcoal-light">
          Curating the best picks for you…
        </p>
        <span className="sr-only" role="status">
          Loading products
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-hidden="true">
        {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
          /* 骨架和真实卡片同一个版式：没有白底卡片、白框只在图片里、文字区
             没有左右内边距 —— 否则加载完成的一瞬间会跳一下。 */
          <div key={i}>
            <div className="aspect-square animate-pulse bg-cream-dark" />
            <div className="space-y-2 pb-1 pt-2.5">
              <div className="h-3 w-4/5 animate-pulse rounded bg-cream-dark" />
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-cream-dark" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
