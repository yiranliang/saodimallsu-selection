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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-white sm:h-10 sm:w-10">
              {brandConfig.logoText}
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
