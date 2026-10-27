import { Search, Close } from './icons.jsx'

/**
 * Storefront search
 * ─────────────────
 * Matches the 货号 and the style name. It is not an ASIN search on purpose:
 * the storefront never receives the ASIN map (that table is admin-only), so
 * there is nothing to match against.
 *
 * No debounce — the catalogue is already in memory and the grid renders one
 * batch, so filtering 139 rows per keystroke is free. A debounce here would
 * only add a lag the creator can feel.
 *
 * The match count deliberately does NOT live in here: this sits inside the
 * sticky filter bar, and a line that appears on the first keystroke would push
 * the whole page down while she types. It goes under the grid instead.
 */
export default function SearchBox({ value, onChange }) {
  const active = Boolean(value)

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal-light/50">
        <Search className="h-4 w-4" />
      </span>

      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search style no. or name"
        aria-label="Search by style number or name"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-9 w-full rounded-full bg-white pl-10 pr-10 text-[12.5px] text-charcoal ring-1 ring-charcoal/8 transition placeholder:text-charcoal-light/60 focus:outline-none focus:ring-charcoal/25 [&::-webkit-search-cancel-button]:appearance-none"
      />

      {active && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
        >
          <Close className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
