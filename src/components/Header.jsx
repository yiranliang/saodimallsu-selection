import { memo, useEffect, useRef } from 'react'
import { brandConfig } from '../data/products.js'

/* ── 圣诞装饰的数据 ──
 *
 * 全部**确定性生成**（不用 `Math.random`）：React 重渲染时同一批点、同一个
 * 位置，不会"重新下一场雪"；构建产物也稳定。
 *
 * 26 个雪点是有意控制的：再多也只是同一屏里更密的噪点，而每个都在跑一条
 * transform 动画 —— 手机上一个都看不见的细节不值得付这个钱。 */
const SNOWFLAKES = Array.from({ length: 26 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: -((index * 7) % 18),
  duration: 9 + (index % 5) * 2.5,
  size: 2 + (index % 3),
  opacity: 0.3 + (index % 4) * 0.15,
}))

/* ── 彩灯串 ──
 *
 * 一条下垂两次的深色灯线（SVG 虚线画成"小珠子"），灯泡挂在线上垂下来的
 * 细丝末端 —— 和参考图同一个思路，但不是同一条：参考图是黑线 + 红绿小球，
 * 这里是**红/绿/金**三色、长度错落、线更细更淡。
 *
 * 全部确定性生成（`Array.from` + 固定数组，不用 `Math.random`）：重渲染不会
 * 换一种挂法，构建产物也稳定。`wireY()` 和 SVG 里那条 `Q` 曲线是同一条抛物线，
 * 所以灯泡永远挂在线上，不会飘。
 */
const BULB_COLORS = ['#c62828', '#2f7d4f', '#c9a227']
const STRANDS = [16, 26, 20, 30, 14, 24, 28, 18, 30, 16, 26, 20]
/* 灯线是一条二次贝塞尔：`M0 2 Q25 56 50 4 Q75 56 100 2`（两段，各占一半宽）。
 * x 在 t 上是线性的，所以灯泡的垂挂点可以直接用同一个公式算出来 —— 不靠眼睛
 * 估、也不会因为视口宽度变化而漂。 */
function wireYAt(pct) {
  const t = (pct % 50) / 50
  const y0 = 2
  const y1 = pct < 50 ? 4 : 2
  const ctrl = 56
  return (1 - t) ** 2 * y0 + 2 * (1 - t) * t * ctrl + t ** 2 * y1
}

const GARLAND = Array.from({ length: 12 }, (_, index) => {
  const pct = 4 + index * 8
  return {
    pct,
    wireY: wireYAt(pct),
    strand: STRANDS[index % STRANDS.length],
    color: BULB_COLORS[index % BULB_COLORS.length],
  }
})

/**
 * Header
 * ───────
 * 两层，职责不同：
 *
 *   1. **顶栏（sticky）**：Logo + 导航菜单 + 搜索 + 红人标识。滚下去之后它是
 *      唯一留在屏幕上的那一层 —— 所以菜单和搜索都放在这里，不用再滚回顶部。
 *   2. **Hero（普通流）**：灯带、雪花、欢迎语。滚动时它正常被推走，把屏幕让给
 *      商品 —— 这正是"中间蓝色那块折叠掉"的效果。
 *
 * 顶栏把自己量出来的高度写进 `--site-nav-h`，`Featured for You` 里的吸顶
 * Shuffle 用这个值当 `top`，所以永远不会被顶栏盖住。
 *
 * 圣诞装饰（雪、灯带、积雪边缘）全在这里：纯 CSS + 内联样式，零图片、零请求；
 * 所有装饰层 `aria-hidden` + `pointer-events-none`，不挡点击、不进无障碍树。
 */
function Header({ influencerName, children }) {
  const barRef = useRef(null)

  useEffect(() => {
    const node = barRef.current
    if (!node || typeof ResizeObserver !== 'function') return undefined
    const publish = () => {
      document.documentElement.style.setProperty(
        '--site-nav-h',
        `${Math.round(node.getBoundingClientRect().height)}px`,
      )
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* ── 顶栏：吸顶 ── */}
      <header
        ref={barRef}
        className="sticky top-0 z-40 border-b border-charcoal/[0.07] bg-cream/95 backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-5 sm:h-16 sm:px-8">
          {/* Brand */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="relative">
              {/* 字母 S：就是一句**普通文本**，衬线体 + 半粗，靠 flex 居中。
                  没有 SVG 路径、没有 transform、没有旋转 —— 任何"手画"的曲线在
                  36px 的小方块里都会被缩放成歪的，直接用系统字体最稳。 */}
              <div className="flex h-9 w-9 select-none items-center justify-center rounded-xl bg-accent leading-none text-white sm:h-10 sm:w-10">
                <span className="font-serif text-[17px] font-semibold leading-none tracking-normal sm:text-[19px]">
                  {brandConfig.logoText}
                </span>
              </div>

              {/* 圣诞帽 —— 纯 CSS，挂在方块外侧右上角，不压 S 的任何笔画。
                  尺寸 16px（比原来大 4px）、`rotate-[7deg]`：仍然朝右，但比原来的
                  12° 往左收了 5°，看起来像随便扣上去的，而不是插在角上。 */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-1 -top-2 z-10 block h-4 w-4 rotate-[7deg]"
              >
                <span className="absolute bottom-[3px] left-1/2 h-0 w-0 -translate-x-1/2 border-b-[9px] border-l-[6px] border-r-[6px] border-b-red-600 border-l-transparent border-r-transparent" />
                <span className="absolute bottom-0 left-0 h-[3px] w-full rounded-full bg-white ring-1 ring-charcoal/10" />
                <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white ring-1 ring-charcoal/10" />
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-[0.04em] text-charcoal sm:text-base">
                {brandConfig.name}
              </div>
              <div className="mt-0.5 hidden text-[11px] tracking-wider text-charcoal-light sm:block">
                SELECTION
              </div>
            </div>
          </div>

          {/* 导航菜单 + 搜索（由 SelectionPage 传进来） */}
          {children}

          {/* Creator handle */}
          {influencerName && (
            <div className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-charcoal/10 bg-white/70 px-3 py-1.5 sm:ml-0">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="max-w-[120px] truncate text-xs font-medium capitalize text-charcoal">
                {influencerName}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Hero：普通流，滚走 ── */}
      <section aria-label="Welcome" className="relative overflow-hidden bg-cream">
        {/* 飘雪：只动 transform（合成器线程），层级压在文字下面 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          {SNOWFLAKES.map((flake, index) => (
            <span
              key={index}
              className="header-snow-dot"
              style={{
                left: `${flake.left}%`,
                width: flake.size,
                height: flake.size,
                opacity: flake.opacity,
                animationDelay: `${flake.delay}s`,
                animationDuration: `${flake.duration}s`,
              }}
            />
          ))}
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-8 pt-0 sm:px-8 sm:pb-10">
          {/* 彩灯串：一条两次下垂的灯线 + 12 颗错落的灯泡（纯 CSS/SVG） */}
          <div aria-hidden="true" className="relative mt-0 h-[88px] w-full select-none">
            <svg
              viewBox="0 0 100 88"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              <path
                d="M0 2 Q25 56 50 4 Q75 56 100 2"
                fill="none"
                stroke="#2B2B2B"
                strokeOpacity="0.5"
                strokeWidth="1"
                strokeLinecap="round"
                strokeDasharray="0.4 2.6"
                pathLength="100"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {GARLAND.map((bulb) => (
              <span
                key={bulb.pct}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${bulb.pct}%`, top: `${bulb.wireY}px` }}
              >
                <span
                  className="block w-px"
                  style={{ height: `${bulb.strand}px`, background: "rgba(43,43,43,0.22)" }}
                />
                <span
                  className="block h-3 w-3 rounded-full"
                  style={{ background: bulb.color, boxShadow: `0 0 6px ${bulb.color}55` }}
                />
              </span>
            ))}
          </div>

          {/* Welcome */}
          <h1 className="mt-5 text-[26px] font-semibold leading-snug tracking-tight text-charcoal sm:mt-6 sm:text-4xl">
            <span aria-hidden="true" className="mr-1.5 align-baseline text-[0.62em] text-red-600">
              ❄
            </span>
            {brandConfig.welcome}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-charcoal-light sm:text-[15px]">
            {brandConfig.tagline}
          </p>
        </div>

        {/* 屋檐积雪：一排半圆遮罩，压在 Hero 的底边上。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
        >
          <div className="header-snowdrift" />
        </div>
      </section>
    </>
  )
}

/* Memoised: only `influencerName` can change it, and that never changes while
 * she shops. Without this, every cart tap and every keystroke in the search box
 * re-rendered the whole header for nothing. */
export default memo(Header)
