import { useEffect, useRef, useState } from 'react'
import ProductCard from './ProductCard.jsx'
import { BADGE_ZONE } from '../utils/deal.js'

/**
 * Featured for You
 * ─────────────────
 * 网格上方的一排 24 件随机推荐 —— 为了让第二屏以后的款式也有曝光（见
 * `utils/featured.js`：全库洗牌后取前 24，不按分类保底）。
 *
 * 为什么复用 `ProductCard` 而不是另写一个"推荐卡"：
 * 角标、断货置灰、"no ASIN = Sold out"、加购/步进器、详情弹层全都长在卡片里，
 * 另写一份就会半年后和前台漂移（首当其冲就是断货规则）。这里只决定"放哪些、
 * 排成几列"，卡片的行为完全一致。
 *
 * 为什么用 `CATALOGUE` 面：这是首页的推荐位，不是秒杀专区 —— 显示身份角标
 * （黑五 / NEW / Limited Deal），但不显示价格行、不挂倒计时，和下方网格同一种
 * 信息密度。价格留在点开之后。
 *
 * 空数组直接不渲染：数据还没到（骨架屏阶段）或者目录为空时，不该留一条
 * "Featured for You" 的空标题在那里。
 *
 * 换一批（Shuffle）为什么不刷新页面：
 * 目录早就在内存里（`useCatalogue` 那一份），重算只是一次纯函数调用 —— 换页面
 * 除了要重新拉一次 Supabase，还会让整屏白一下。这里只换种子，卡片淡入，
 * 滚动位置也不动。**按钮本身不发任何请求**，加购/滚动也不会触发重洗（种子由
 * 父组件持有，只有挂载和点击才变）。
 */
export default function FeaturedSection({
  products = [],
  linesFor,
  amazonUrlFor,
  onToggle,
  onIncrement,
  onDecrement,
  onOpenDetail,
  /* 换一批：父组件换一个种子，这里只负责动画与按钮。 */
  onShuffle,
  seed = 0,
  /* 整份选款已满（`MAX_CART_ITEMS`）：卡片步进器的 `+` 置灰。 */
  atCap = false,
}) {
  /* 吸顶按钮的"紧凑态"。
   *
   * 吸附本身是**纯 CSS**：按钮外面那层 `sticky` 的父级是 `<section>`，所以它只会
   * 在这块推荐区内吸附（滚过最后一张卡就跟着页面走），`top` 读分类栏自己量出来的
   * `--site-nav-h`，正好贴在导航下方。不需要任何滚动监听。
   *
   * 这里唯一的 JS 只回答一个问题：**标题行走没走**。走了就把胶囊收成一枚小圆点
   * （只留图标），免得挡住下面的商品。用 IntersectionObserver 而不是滚动监听：
   * 回调只在进出视口那一刻来一次，滚动全程零主线程开销。
   *
   * hooks 必须写在 `if (!products.length)` 之前：数量不能随渲染变化。 */
  const headRef = useRef(null)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const node = headRef.current
    if (!node || typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        /* 只认"标题行在视口上方"：`!isIntersecting` 也包含"还没滚到"，
         * 两种状态的 rect.bottom 一正一负，用 <= 0 区分。 */
        setCompact(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0)
      },
      { threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [products.length])

  if (!products.length) return null

  return (
    <section
      aria-label="Featured for You"
      data-featured
      className="mx-auto mb-10 max-w-7xl px-5 sm:mb-14 sm:px-8"
    >
      {onShuffle && (
        /* 吸附轨道：高度 0、不占位，作为 `<section>` 的直接子元素 —— 这就是
         * "只在推荐区内吸附"的关键（sticky 的边界是它的父级）。
         * `pointer-events-none` 让这条看不见的轨道不吃点击，按钮自己恢复。 */
        <div
          style={{ top: 'var(--site-nav-h, 0px)' }}
          className="pointer-events-none sticky z-30 flex h-0 items-start justify-end pr-0.5 sm:pr-1"
        >
          <button
            type="button"
            onClick={onShuffle}
            data-shuffle
            aria-label="Shuffle featured picks"
            /* `shrink-0` + `items-start`（在外层轨道上）是关键：轨道是 `h-0` 的，
             * 默认 `items-stretch` 会把按钮压成 0 高、看起来像一条扁片。 */
            className={`pointer-events-auto inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full transition-all duration-200 hover:bg-charcoal hover:text-cream active:scale-95 ${
              compact
                ? 'h-10 w-10 bg-white/95 text-charcoal shadow-lg shadow-charcoal/25 ring-1 ring-charcoal/10 backdrop-blur-md'
                : 'px-4 py-2 text-[11.5px] font-semibold text-charcoal bg-charcoal/[0.06] ring-1 ring-charcoal/10'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0"
            >
              <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2" />
              <path d="M17.4 3.6v3.2h-3.2" />
            </svg>
            {/* 吸顶时只留图标：按钮收成一枚 36px 的小圆点，几乎不挡商品。 */}
            {!compact && <span>Shuffle</span>}
          </button>
        </div>
      )}

      <div ref={headRef} className="mb-4 sm:mb-5">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-charcoal sm:text-3xl">
          Featured <span className="text-accent">for You</span>
        </h2>

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 text-[11.5px] leading-snug text-charcoal-light">
            A rotating pick from every category — shuffle for a different mix.
            {/* 数量跟正文同行：右上角现在是吸顶按钮的地盘，再放一个右对齐的数字
                会在按钮落到原位时和它打架。 */}
            <span className="ml-1 hidden tabular-nums text-charcoal-light/60 sm:inline">
              · {products.length} styles
            </span>
          </p>
        </div>
      </div>

      {/* `key={seed}` 让这一整块在换批时重新挂载一次，从而重播 `.fade-up`
          （0.22s 淡入 + 6px 位移）。跟着动画一起出现的还有图片解码的那一两帧，
          所以看到的是"淡入"而不是"闪一下变成另一批"。
          `prefers-reduced-motion` 下 `.fade-up` 本来就被关掉，等于直接替换。 */}
      <div
        key={seed}
        className="fade-up grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 sm:gap-y-10 md:grid-cols-3 xl:grid-cols-4"
      >
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
            zone={BADGE_ZONE.CATALOGUE}
            atCap={atCap}
          />
        ))}
      </div>

      {/* 推荐区与常规目录之间的分界：2px 虚线 + 大留白 + 一行小标题。
          没有它，最后一行推荐和货架第一行长得一模一样，整块"特别推荐"就消失了。 */}
      <div className="mt-10 border-t-2 border-dashed border-charcoal/15 pt-5 sm:mt-12">
        <div className="text-center text-[10px] font-medium uppercase tracking-[0.22em] text-charcoal-light/60">
          All products
        </div>
      </div>
    </section>
  )
}
