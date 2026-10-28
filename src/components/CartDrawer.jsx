import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import QuantityStepper from './QuantityStepper.jsx'
import ProductImage from './ProductImage.jsx'
import { Close, Trash, Sparkle, Bag, AlertCircle } from './icons.jsx'
import { resolveProductImage } from '../utils/variantImage.js'
import { isSoldOut } from '../utils/soldOut.js'
import { listingKnownFor } from '../store/linkStore.js'
import { sizedImage } from '../utils/image.js'
import { isTeaser } from '../utils/teaser.js'

/**
 * Selection cart
 * ───────────────
 * A preview of everything picked so far: thumbnail, name, the chosen colour and
 * size, quantity controls and a remove action. Tapping a line reopens the detail
 * sheet so variants can be changed without hunting for the card again.
 *
 * One line per variant combination, not per product — the same piece in Black/M
 * and White/L is two lines with their own quantities. The header counts all
 * three numbers because they answer different questions: how many pieces she
 * picked (styles), how many combinations (variants), how many units ship.
 *
 * A LINE CAN SELL OUT AFTER SHE PICKED IT
 * It is flagged in place and the code button is blocked, rather than deleted on
 * the quiet: silently dropping a line makes the cart disagree with what she
 * thinks she chose, and she only finds out when the order arrives short. The
 * fix is one tap — "Remove sold-out items".
 */
export default function CartDrawer({
  open,
  items,
  styles,
  variants,
  units,
  onIncrement,
  onDecrement,
  onRemove,
  onClearAll,
  onRemoveSoldOut,
  onRemoveTeaser,
  onEdit,
  onGenerate,
  onClose,
}) {
  /* "Clear all" asks first, inline. A second Modal would be the obvious way to
   * do it, but both instances listen for Escape at the same z-index — one press
   * would dismiss the confirmation AND the drawer behind it. */
  const [confirming, setConfirming] = useState(false)

  /* Never reopen with a stale "are you sure?" already showing */
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  const soldOutKeys = useMemo(
    () =>
      new Set(
        items
          .filter((item) => isSoldOut(item.product, item.specs, (c, s) => listingKnownFor(item.product.id, c, s)))
          .map((item) => item.key),
      ),
    [items],
  )

  /* Lines whose product has been marked Coming Soon SINCE it was added. They
   * are not removed silently — the banner below names them and the code button
   * stays disabled until they are gone. */
  const teaserKeys = useMemo(
    () => new Set(items.filter((item) => isTeaser(item.product)).map((item) => item.key)),
    [items],
  )

  return (
    <Modal open={open} onClose={onClose} title="Your selection" maxWidth="max-w-lg">
      <div className="flex max-h-[88vh] flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-charcoal/[0.07] px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-charcoal">
              Your selection
            </h2>
            <p className="mt-0.5 text-[12px] text-charcoal-light">
              {styles} {styles === 1 ? 'style' : 'styles'}
              {variants > styles && ` · ${variants} variants`}
              {' · '}
              {units} {units === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>

        {/* Lines */}
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {items.length === 0 ? (
            <div className="py-14 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cream-dark text-charcoal-light">
                <Bag className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-[14px] font-medium text-charcoal">
                Your selection is empty
              </h3>
              <p className="mt-1 text-[12px] text-charcoal-light">
                Pick a few pieces and they'll show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map(({ key, product, qty, specs }) => {
                const specEntries = Object.entries(specs || {}).filter(([, v]) => v)
                const specTypes = Object.keys(product.specs || {})
                const complete = specTypes.every((type) => specs?.[type])
                const gone = soldOutKeys.has(key)
                const teaser = isTeaser(product)

                return (
                  <div
                    key={key}
                    className={`flex gap-3 rounded-2xl bg-white p-2.5 ${
                      gone ? 'ring-1 ring-red-200' : teaser ? 'ring-1 ring-charcoal/25' : ''
                    }`}
                  >
                    {/* `contain` on white to match the card — a thumbnail that
                        crops differently from the tile it came from makes the
                        line look like the wrong product. The hairline stays:
                        this thumbnail sits on a white drawer, where nothing else
                        would mark its edge. */}
                    <button
                      type="button"
                      onClick={() => onEdit(product)}
                      className="h-16 w-14 shrink-0 overflow-hidden rounded-xl border border-charcoal/[0.07] bg-white"
                      aria-label={`Edit ${product.name}`}
                    >
                      <ProductImage
                        src={sizedImage(resolveProductImage(product, specs), 160)}
                        fallback={product.image}
                        alt={product.name}
                        className="h-full w-full object-contain"
                      />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(product)}
                          className="min-w-0 text-left"
                        >
                          <h3 className="line-clamp-1 text-[12.5px] font-medium text-charcoal">
                            {product.name}
                          </h3>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(key)}
                          aria-label={`Remove ${product.name}`}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Chosen colour / size */}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {specEntries.length > 0 ? (
                          specEntries.map(([type, value]) => (
                            <span
                              key={type}
                              className="rounded bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium leading-4 text-charcoal/75"
                            >
                              {value}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-charcoal-light">One size</span>
                        )}
                        {!complete && specTypes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onEdit(product)}
                            className="text-[10px] font-medium text-accent underline decoration-accent/30 underline-offset-2"
                          >
                            Choose {specTypes.filter((t) => !specs?.[t]).join(' & ').toLowerCase()}
                          </button>
                        )}
                        {gone && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-red-500">
                            Sold out
                          </span>
                        )}
                        {teaser && (
                          <span className="rounded bg-charcoal px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-cream">
                            Coming Soon
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <QuantityStepper
                          qty={qty}
                          onIncrement={() => onIncrement(key)}
                          onDecrement={() => onDecrement(key)}
                        />
                        {gone ? (
                          <button
                            type="button"
                            onClick={() => onRemove(key)}
                            className="text-[11px] font-medium text-red-500 transition hover:text-red-600"
                          >
                            Remove
                          </button>
                        ) : teaser ? (
                          <button
                            type="button"
                            onClick={() => onRemove(key)}
                            className="text-[11px] font-medium text-charcoal transition hover:text-charcoal/70"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onEdit(product)}
                            className="text-[11px] text-charcoal-light transition hover:text-charcoal"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-charcoal/[0.07] bg-cream px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-5">
          {items.length > 0 && (
            <div className="mb-2">
              {confirming ? (
                <div className="rounded-2xl bg-white px-3.5 py-3 ring-1 ring-charcoal/10">
                  <p className="text-[12px] leading-snug text-charcoal">
                    Are you sure you want to clear your selection?
                  </p>
                  <p className="mt-0.5 text-[11px] text-charcoal-light">
                    {variants} {variants === 1 ? 'variant' : 'variants'} · {units}{' '}
                    {units === 1 ? 'item' : 'items'} will be removed.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(false)
                        onClearAll()
                      }}
                      className="flex-1 rounded-full bg-red-500 py-2 text-[12px] font-medium text-white transition hover:bg-red-600 active:scale-[0.97]"
                    >
                      Yes, clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="flex-1 rounded-full bg-cream-dark py-2 text-[12px] font-medium text-charcoal transition hover:bg-charcoal/10 active:scale-[0.97]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="w-full py-1 text-[11.5px] text-charcoal-light transition hover:text-red-500"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          {soldOutKeys.size > 0 && (
            <div className="mb-2 rounded-2xl bg-red-50 px-3.5 py-3 ring-1 ring-red-200">
              <p className="flex items-start gap-1.5 text-[12px] leading-snug text-red-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {soldOutKeys.size === 1 ? '1 item is' : `${soldOutKeys.size} items are`} sold
                  out since you picked {soldOutKeys.size === 1 ? 'it' : 'them'}.
                </span>
              </p>
              <button
                type="button"
                onClick={onRemoveSoldOut}
                className="mt-2 w-full rounded-full bg-red-500 py-2 text-[12px] font-medium text-white transition hover:bg-red-600 active:scale-[0.97]"
              >
                Remove sold-out items
              </button>
            </div>
          )}

          {/* Coming Soon picked before the style was marked. Explicit, not
              silent: the banner says what happened and the button is disabled. */}
          {teaserKeys.size > 0 && (
            <div className="mb-2 rounded-2xl bg-charcoal px-3.5 py-3">
              <p className="flex items-start gap-1.5 text-[12px] leading-snug text-cream">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {teaserKeys.size === 1
                    ? 'You picked a Coming Soon style.'
                    : `You picked ${teaserKeys.size} Coming Soon styles.`}{' '}
                  Remove {teaserKeys.size === 1 ? 'it' : 'them'} before generating.
                </span>
              </p>
              <button
                type="button"
                onClick={onRemoveTeaser}
                className="mt-2 w-full rounded-full bg-white py-2 text-[12px] font-medium text-charcoal transition hover:bg-cream active:scale-[0.97]"
              >
                Remove Coming Soon {teaserKeys.size === 1 ? 'item' : 'items'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onGenerate}
            disabled={variants === 0 || soldOutKeys.size > 0 || teaserKeys.size > 0}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-medium transition-all duration-200 ${
              variants === 0 || soldOutKeys.size > 0 || teaserKeys.size > 0
                ? 'cursor-not-allowed bg-charcoal/10 text-charcoal/35'
                : 'bg-accent text-white shadow-lg shadow-accent/20 hover:bg-accent-dark active:scale-[0.97]'
            }`}
          >
            <Sparkle className="h-4 w-4" />
            Generate my code
          </button>
        </div>
      </div>
    </Modal>
  )
}
