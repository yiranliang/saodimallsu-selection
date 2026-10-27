import { memo } from 'react'
import SearchBox from './SearchBox.jsx'
import { DEALS_TAB, DEAL_BUCKETS } from '../utils/deal.js'
import { useDragScroll } from '../hooks/useDragScroll.js'
import { useSettings } from '../hooks/useSettings.js'

/**
 * Filter bar
 * ───────────
 * Search box + a horizontal chip rail, pinned under the header. Everything that
 * narrows the grid lives here, so the creator has one place to look when a
 * style seems to be missing.
 *
 * The search row is inside the sticky container on purpose: once she has
 * scrolled past the welcome block, this bar is the only chrome left, and
 * refining a search should not require scrolling back to the top.
 */
function CategoryNav({
  categories,
  active,
  counts,
  onChange,
  total,
  query,
  onQueryChange,
  /* The deals view is not a real category (see DEALS_TAB) — it is a view over
   * the same catalogue, so it cannot come from `categories`. `dealsCount` of 0
   * hides the chip entirely: a permanent empty tab is worse than no tab.
   *
   * Its NAME is a setting: during Black Friday ops renames it to
   * "Black Friday Deals" (from the admin list page) and every open storefront
   * follows on the next render — see utils/settingsStore.js. */
  dealsCount = 0,
  bucket = 'all',
  /* `{all, '10-20', …}` for the band chips, computed from the searched deals.
   * `null` before the tab is opened. */
  bucketCounts = null,
  onBucketChange,
}) {
  /* Two rails, same mouse behaviour: wheel-over-scrolls-sideways, press-and-drag
   * pans. Touch is untouched — the hook ignores every non-mouse pointer.
   * `watchKey` re-measures whether the rail overflows, so the grab cursor only
   * appears when there is actually something to grab. */
  const { dealsTabLabel } = useSettings()

  const categoryRail = useDragScroll(`${categories.length}:${dealsCount}`)
  const bucketRail = useDragScroll(bucketCounts?.all ?? 0)

  /** One chip. `accent` is the deals tab: red when idle, charcoal when active,
   *  so it reads as a campaign entry rather than another category. */
  const Chip = ({ value, label, count, accent = false }) => {
    const isActive = active === value
    const palette = isActive
      ? accent
        ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
        : 'bg-charcoal text-cream'
      : accent
        ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:ring-red-300'
        : 'bg-white text-charcoal/70 ring-1 ring-charcoal/8 hover:ring-charcoal/20'
    return (
      <button
        type="button"
        onClick={() => onChange(value)}
        aria-pressed={isActive}
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-medium transition-all duration-200 ${palette}`}
      >
        {label}
        <span
          className={`text-[10px] tabular-nums ${
            isActive ? (accent ? 'text-white/70' : 'text-cream/60') : 'text-charcoal-light/70'
          }`}
        >
          {count}
        </span>
      </button>
    )
  }

  return (
    <nav className="sticky top-0 z-30 bg-cream/95 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-5 pb-1 pt-2.5 sm:px-8">
        <SearchBox value={query} onChange={onQueryChange} />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <div
          ref={categoryRail.ref}
          data-rail="categories"
          onPointerDown={categoryRail.onPointerDown}
          onClickCapture={categoryRail.onClickCapture}
          /* `select-none`: a drag must not select the chip labels. Touch gets
           * its native momentum — no touch-action override here. */
          className={`no-scrollbar flex select-none gap-2 overflow-x-auto px-5 py-3 sm:px-8 ${
            categoryRail.dragging
              ? 'cursor-grabbing'
              : categoryRail.scrollable
                ? 'cursor-grab'
                : ''
          }`}
        >
          {dealsCount > 0 && (
            <Chip value={DEALS_TAB} label={dealsTabLabel} count={dealsCount} accent />
          )}
          <Chip value="All" label="All" count={total} />
          {categories.map((category) => (
            <Chip
              key={category}
              value={category}
              label={category}
              count={counts[category] || 0}
            />
          ))}
        </div>

        {/* Right-edge fade hints that the rail scrolls */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-cream to-transparent" />
      </div>
      {/* Discount buckets — only inside the deals tab. Left-closed, right-open,
          and a product can only be in one: `bucketOf` reads the SAME number the
          badge prints, so the chip never disagrees with the card. */}
      {active === DEALS_TAB && (
        <div className="mx-auto max-w-6xl px-5 pb-2 sm:px-8">
          <div
            ref={bucketRail.ref}
            data-rail="deals"
            onPointerDown={bucketRail.onPointerDown}
            onClickCapture={bucketRail.onClickCapture}
            className={`no-scrollbar flex select-none gap-1.5 overflow-x-auto ${
              bucketRail.dragging
                ? 'cursor-grabbing'
                : bucketRail.scrollable
                  ? 'cursor-grab'
                  : ''
            }`}
          >
            {[{ id: 'all', label: 'All deals' }, ...DEAL_BUCKETS].map((option) => {
              const isOn = bucket === option.id
              const count = bucketCounts?.[option.id]
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onBucketChange?.(option.id)}
                  aria-pressed={isOn}
                  /* The count is decoration; the name stays the band, so the
                   * rail reads the same to a screen reader with or without it. */
                  aria-label={option.label}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                    isOn
                      ? 'bg-red-600 text-white'
                      : 'bg-red-50/70 text-red-700/80 ring-1 ring-red-100 hover:ring-red-200'
                  }`}
                >
                  {option.label}
                  {Number.isFinite(count) && (
                    <span
                      className={`text-[10px] tabular-nums ${
                        isOn ? 'text-white/70' : 'text-red-700/50'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="h-px bg-charcoal/[0.06]" />
      </div>
    </nav>
  )
}

/* Memoised: the rail only depends on the category list, the counts and the
 * query. Adding a card to the cart no longer re-renders it. */
export default memo(CategoryNav)
