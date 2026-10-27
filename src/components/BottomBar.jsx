import { memo } from 'react'
import { Sparkle, ChevronUp } from './icons.jsx'

/**
 * Sticky bottom bar
 * ──────────────────
 * Left: tap the count to open the selection preview.
 * Right: generate the code.
 *
 * THREE NUMBERS, NOT ONE
 * A creator can take the same piece in two colours, so "how many did she pick"
 * has three honest answers:
 *   styles    distinct products   — what ops thinks of as the order
 *   variants  combinations        — what actually has to be pulled
 *   units     sum of quantities   — what goes in the box
 * The big badge is styles; variants and units appear next to it only when they
 * differ, so a simple one-of-each selection still reads "1 style · 1 item".
 */
function BottomBar({ styles, variants, units, onOpenCart, onGenerate }) {
  const empty = variants === 0

  const detail = empty
    ? 'Nothing selected yet'
    : [
        `${styles} ${styles === 1 ? 'style' : 'styles'}`,
        variants > styles ? `${variants} variants` : null,
        `${units} ${units === 1 ? 'item' : 'items'}`,
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      <div className="pointer-events-none h-10 bg-gradient-to-t from-cream to-transparent" />

      <div className="border-t border-charcoal/[0.06] bg-cream">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
          {/* Count → opens the cart */}
          <button
            type="button"
            onClick={onOpenCart}
            className="group flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-2 text-left transition hover:bg-cream-dark/60 active:scale-[0.98]"
            aria-label="View your selection"
          >
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-dark text-charcoal">
              <span className="text-[13px] font-semibold tabular-nums">{styles}</span>
              {units > styles && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                  {units}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[12.5px] font-medium text-charcoal">
                  {empty ? 'Empty' : 'Your selection'}
                </span>
                {!empty && <ChevronUp className="h-3 w-3 text-charcoal-light" />}
              </div>
              <div className="mt-0.5 hidden truncate text-[11px] text-charcoal-light sm:block">
                {detail}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onGenerate}
            disabled={empty}
            className={`flex shrink-0 items-center gap-2 rounded-full px-5 py-3 text-[13px] font-medium transition-all duration-200 sm:px-6 sm:text-sm ${
              empty
                ? 'cursor-not-allowed bg-charcoal/10 text-charcoal/35'
                : 'bg-accent text-white shadow-lg shadow-accent/25 hover:bg-accent-dark active:scale-95'
            }`}
          >
            <Sparkle className="h-4 w-4" />
            Generate my code
          </button>
        </div>
      </div>
    </div>
  )
}

/* Memoised: it reads three numbers and three callbacks, all stable. */
export default memo(BottomBar)
