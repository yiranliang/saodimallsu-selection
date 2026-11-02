import ProductCard from './ProductCard.jsx'
import { BADGE_ZONE } from '../utils/deal.js'

/**
 * Featured for You
 * ─────────────────
 * 网格上方的一排 24 件随机推荐 —— 为了让第二屏以后的款式也有曝光（见
 * `utils/featured.js` 的抽样规则：每个分类先保 1–2 件，剩余随机补满）。
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
}) {
  if (!products.length) return null

  return (
    <section
      aria-label="Featured for You"
      data-featured
      className="mx-auto mb-8 max-w-6xl px-5 sm:px-8"
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-charcoal sm:text-base">
            Featured for You
          </h2>
          <p className="mt-0.5 text-[11px] leading-snug text-charcoal-light">
            A rotating pick from every category — shuffle for a different mix.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[10.5px] tabular-nums text-charcoal-light/80 sm:inline">
            {products.length} styles
          </span>
          {onShuffle && (
            <button
              type="button"
              onClick={onShuffle}
              aria-label="Shuffle featured picks"
              /* 纯本地重算：换了种子只是重跑一次 `pickFeatured`，用的是已经在
                 内存里的目录 —— 不 fetch、不打 Supabase、不碰 sort_order。 */
              className="rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:bg-cream-dark/60 hover:ring-charcoal/25 active:scale-95"
            >
              Shuffle
            </button>
          )}
        </div>
      </div>

      {/* `key={seed}` 让这一整块在换批时重新挂载一次，从而重播 `.fade-up`
          （0.22s 淡入 + 6px 位移）。跟着动画一起出现的还有图片解码的那一两帧，
          所以看到的是"淡入"而不是"闪一下变成另一批"。
          `prefers-reduced-motion` 下 `.fade-up` 本来就被关掉，等于直接替换。 */}
      <div
        key={seed}
        className="fade-up grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
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
          />
        ))}
      </div>
    </section>
  )
}
