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
  if (!products.length) return null

  return (
    <section
      aria-label="Featured for You"
      data-featured
      className="mx-auto mb-10 max-w-6xl px-5 sm:mb-14 sm:px-8"
    >
      <div className="mb-4 sm:mb-5">
        {/* 标题独占一行；副标题和右侧的操作区共用一行，并且 `items-center` ——
            按钮的垂直中线跟着副标题走，而不是贴着整块的底边（原来 `items-end`
            在标题变高之后会让按钮看起来"掉下去"）。 */}
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-charcoal sm:text-3xl">
          Featured <span className="text-accent">for You</span>
        </h2>

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 text-[11.5px] leading-snug text-charcoal-light">
            A rotating pick from every category — shuffle for a different mix.
          </p>

          {/* `ml-auto`：手机上副标题换行后按钮落到第二行，仍然贴右边而不是回到
              行首 —— 否则它看起来像另一个段落的一部分。 */}
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <span className="hidden text-[10.5px] tabular-nums text-charcoal-light/70 sm:inline">
              {products.length} styles
            </span>
            {/* 换一批：纯本地重算（换种子重跑 `pickFeatured`），不 fetch、不打
                Supabase、不碰 sort_order。样式上从"文字链接"改成实心胶囊 ——
                淡底 + 描边是常态，hover 翻成深色，箭头转 180°。 */}
            {onShuffle && (
              <button
                type="button"
                onClick={onShuffle}
                aria-label="Shuffle featured picks"
                className="group inline-flex items-center gap-1.5 rounded-full bg-charcoal/[0.06] px-3.5 py-2 text-[11.5px] font-semibold text-charcoal ring-1 ring-charcoal/10 transition-all duration-200 hover:bg-charcoal hover:text-cream hover:ring-charcoal active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform duration-500 ease-out group-hover:rotate-180"
                >
                  <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2" />
                  <path d="M17.4 3.6v3.2h-3.2" />
                </svg>
                Shuffle
              </button>
            )}
          </div>
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
            atCap={atCap}
          />
        ))}
      </div>

      {/* 和下方常规目录之间的那条极淡的分割线 + 大留白：没有它，推荐位的最后
          一行和货架的第一行会长得一模一样，整块"特别推荐"就消失了。 */}
      <div className="mt-9 h-px bg-charcoal/[0.07]" />
    </section>
  )
}
