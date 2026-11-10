import { memo } from 'react'
import { brandConfig } from '../data/products.js'

/**
 * Header
 * ───────
 * Brand mark, welcome line, and the creator's handle (from ?ref=).
 *
 * Deliberately not sticky: the welcome block is tall, and letting it scroll away
 * leaves the category rail pinned to the top instead — which is what you want
 * once you're actually browsing.
 */
function Header({ influencerName }) {
  return (
    <header className="relative bg-cream">
      <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8 sm:py-7">
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
                className="pointer-events-none absolute -right-1.5 -top-2 z-10 block h-4 w-4 -rotate-12"
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

        {/* Welcome */}
        <h1 className="mt-7 text-[26px] font-semibold leading-snug tracking-tight text-charcoal sm:mt-9 sm:text-4xl">
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
    </header>
  )
}

/* Memoised: only `influencerName` can change it, and that never changes while
 * she shops. Without this, every cart tap and every keystroke in the search box
 * re-rendered the whole header for nothing. */
export default memo(Header)
