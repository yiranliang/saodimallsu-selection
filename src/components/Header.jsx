import { memo } from 'react'
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

/* 经典三色：圣诞红、松绿、金。灯泡只改 opacity 闪烁，光晕是静态阴影。 */
const LIGHT_COLORS = ['#c62828', '#2f7d4f', '#c9a227']
const LIGHTS = Array.from({ length: 14 }, (_, index) => LIGHT_COLORS[index % LIGHT_COLORS.length])

/**
 * Header
 * ───────
 * Brand mark, welcome line, and the creator's handle (from ?ref=).
 *
 * Deliberately not sticky: the welcome block is tall, and letting it scroll away
 * leaves the category rail pinned to the top instead — which is what you want
 * once you're actually browsing.
 *
 * 圣诞装饰（雪、灯带、积雪边缘）全在这一层：纯 CSS + 内联样式，零图片、
 * 零网络请求；所有装饰层 `aria-hidden` + `pointer-events-none`，不挡点击、
 * 不进无障碍树。
 */
function Header({ influencerName }) {
  return (
    <header className="relative overflow-hidden bg-cream">
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

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-8 pt-5 sm:px-8 sm:pb-10 sm:pt-7">
        <div className="flex items-start justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-white sm:h-10 sm:w-10">
                {brandConfig.logoText}
              </div>

              {/* 圣诞帽 —— 纯 CSS：红色三角 + 白帽檐 + 帽尖小球，斜扣在 Logo
                  右上角。没有图片、没有额外请求；`aria-hidden` 让读屏软件跳过。 */}
              <span
                aria-hidden="true"
                className="santa-glow pointer-events-none absolute -right-1.5 -top-2 z-10 block h-4 w-4 -rotate-12"
              >
                <span className="absolute bottom-[3px] left-1/2 h-0 w-0 -translate-x-1/2 border-b-[9px] border-l-[6px] border-r-[6px] border-b-red-600 border-l-transparent border-r-transparent" />
                <span className="absolute bottom-0 left-0 h-[3px] w-4 rounded-full bg-white ring-1 ring-charcoal/10" />
                <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white ring-1 ring-charcoal/10" />
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-[0.14em] text-charcoal sm:text-base">
                {brandConfig.name}
              </div>
              <div className="mt-0.5 text-[11px] tracking-wider text-charcoal-light">
                SELECTION
              </div>
            </div>
          </div>

          {/* Creator handle */}
          {influencerName && (
            <div className="flex items-center gap-2 rounded-full border border-charcoal/10 bg-white/70 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="max-w-[120px] truncate text-xs font-medium capitalize text-charcoal">
                {influencerName}
              </span>
            </div>
          )}
        </div>

        {/* 灯带：一根渐隐的电线 + 14 颗小灯泡。灯泡只闪 opacity，光晕静态。 */}
        <div aria-hidden="true" className="pointer-events-none relative mt-7 h-6 sm:mt-8">
          <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-charcoal/20 to-transparent" />
          <div className="flex items-start justify-between px-1">
            {LIGHTS.map((color, index) => (
              <span
                key={index}
                className="header-bulb"
                style={{ '--bulb': color, animationDelay: `${index * 0.28}s` }}
              />
            ))}
          </div>
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

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="h-px bg-charcoal/[0.07]" />
      </div>

      {/* 屋檐积雪：一排半圆遮罩，压在底边上，把那条细分割线盖成"雪檐" */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
      >
        <div className="header-snowdrift" />
      </div>
    </header>
  )
}

/* Memoised: only `influencerName` can change it, and that never changes while
 * she shops. Without this, every cart tap and every keystroke in the search box
 * re-rendered the whole header for nothing. */
export default memo(Header)
