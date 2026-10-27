import { Minus, Plus } from './icons.jsx'

/**
 * Quantity stepper
 * ─────────────────
 * Shared by the product card (compact) and the detail sheet (comfortable).
 * All clicks stop propagation so they don't trigger the card's detail handler.
 */
export default function QuantityStepper({
  qty,
  onIncrement,
  onDecrement,
  size = 'sm',
  max = 35,
}) {
  const compact = size === 'sm'

  const btn = compact ? 'h-6 w-6' : 'h-9 w-9'
  const icon = compact ? 'h-3 w-3' : 'h-4 w-4'
  const label = compact ? 'w-5 text-[11px]' : 'w-8 text-sm'
  const shell = compact ? 'h-7' : 'h-10'

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      className={`flex ${shell} items-center rounded-full bg-accent/10 ring-1 ring-accent/25`}
    >
      <button
        type="button"
        onClick={stop(onDecrement)}
        aria-label="Decrease quantity"
        className={`flex ${btn} items-center justify-center rounded-full text-accent transition active:scale-90 hover:bg-accent/15`}
      >
        <Minus className={icon} />
      </button>

      <span
        className={`${label} text-center font-semibold tabular-nums text-accent`}
        aria-live="polite"
      >
        {qty}
      </span>

      <button
        type="button"
        onClick={stop(onIncrement)}
        disabled={qty >= max}
        aria-label="Increase quantity"
        className={`flex ${btn} items-center justify-center rounded-full text-accent transition active:scale-90 hover:bg-accent/15 disabled:opacity-30`}
      >
        <Plus className={icon} />
      </button>
    </div>
  )
}
