import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { readSelection, saveLines, clearLegacySelection } from '../utils/storage.js'
import {
  addLine,
  setLineQty,
  incrementLine,
  decrementLine,
  removeLine,
  removeProduct,
  linesFor as linesForId,
  sumQty,
  countsOf,
  reconcileLines,
} from '../utils/lines.js'

/**
 * Selection state
 * ────────────────
 * An ordered array of lines, where a line is one variant combination:
 *
 *   { key: 'p003::Black|M', productId: 'p003', qty: 2, specs: { Colour, Size } }
 *
 * The creator can take the same piece in Black/M and White/L; both are separate
 * lines and both count. Everything the UI needs — per-product quantity, the
 * lines of one product, the three headline counts — is derived here so no
 * component has to re-implement the arithmetic.
 *
 * PERSISTENCE AND THE STAMP
 * ─────────────────────────
 * Written to localStorage on every change, wrapped with `updatedAt` so an
 * abandoned draft expires (utils/selectionExpiry.js). The stamp is bumped by
 * the MUTATORS below and by nothing else: `stampRef` starts at whatever was
 * stored, so mounting the page — or the reconcile pass that runs when the
 * catalogue arrives — writes the envelope back with the old stamp. Otherwise a
 * creator who opens her link twice a month would keep the same cart forever.
 *
 * The legacy one-variant keys are cleared on mount (see utils/storage.js for
 * why they are not migrated).
 */
export function useSelection() {
  /* Read localStorage once, during the first render. `readSelection` also
   * decides expiry, so an aged-out draft arrives here already empty — and the
   * first write below persists that emptiness. */
  const [boot] = useState(() => readSelection())
  const [lines, setLines] = useState(boot.lines)
  const stampRef = useRef(boot.updatedAt)

  useEffect(() => {
    clearLegacySelection()
  }, [])

  useEffect(() => {
    saveLines(lines, stampRef.current)
  }, [lines])

  /** Mark the selection as changed *now*. Only user actions call this. */
  const touch = useCallback(() => {
    stampRef.current = Date.now()
  }, [])

  /**
   * Align the restored selection with the current catalogue.
   * Runs once products arrive, and again whenever the catalogue changes shape —
   * that is what removes a colour the admin deleted while the tab was open.
   * Deliberately does NOT touch the stamp: this is bookkeeping, not a choice.
   */
  const reconcile = useCallback((products) => {
    if (!Array.isArray(products) || !products.length) return
    setLines((prev) => {
      if (!prev.length) return prev
      const byId = new Map(products.map((product) => [String(product.id), product]))
      const { lines: next } = reconcileLines(prev, byId)
      const same =
        next.length === prev.length && next.every((line, i) => line === prev[i])
      return same ? prev : next
    })
  }, [])

  /* Re-reconcile whenever the catalogue itself changes (realtime edits, a
   * colour removed in the admin console). The caller owns that effect because
   * only it knows when the product list has actually arrived. */

  /** Total units of one product across all its variants */
  const getQty = useCallback((productId) => sumQty(lines, productId), [lines])

  const isSelected = useCallback((productId) => sumQty(lines, productId) > 0, [lines])

  const linesFor = useCallback((productId) => linesForId(lines, productId), [lines])

  /** The line matching a specific combination, or undefined */
  const findLine = useCallback(
    (key) => lines.find((line) => line.key === key),
    [lines],
  )

  const add = useCallback(
    (product, specs, qty = 1) => {
      touch()
      setLines((prev) => addLine(prev, product, specs, qty))
    },
    [touch],
  )

  const increment = useCallback(
    (key) => {
      touch()
      setLines((prev) => incrementLine(prev, key))
    },
    [touch],
  )

  const decrement = useCallback(
    (key) => {
      touch()
      setLines((prev) => decrementLine(prev, key))
    },
    [touch],
  )

  const setQty = useCallback(
    (key, qty) => {
      touch()
      setLines((prev) => setLineQty(prev, key, qty))
    },
    [touch],
  )

  const remove = useCallback(
    (key) => {
      touch()
      setLines((prev) => removeLine(prev, key))
    },
    [touch],
  )

  /** Drop every variant of one product — the heart button */
  const removeAll = useCallback(
    (productId) => {
      touch()
      setLines((prev) => removeProduct(prev, productId))
    },
    [touch],
  )

  const clearAll = useCallback(() => {
    touch()
    setLines([])
  }, [touch])

  /**
   * Keep every line, restart the 7-day clock.
   *
   * Called after a code is generated: creators routinely send one code, then
   * spot another piece. Clearing forced a second, separate code and ops had to
   * merge them — so the cart stays and only the stamp moves. The next generate
   * therefore includes everything picked so far.
   */
  const renew = useCallback(() => {
    stampRef.current = Date.now()
    saveLines(lines, stampRef.current)
  }, [lines])

  const counts = useMemo(() => countsOf(lines), [lines])

  return {
    lines,
    getQty,
    isSelected,
    linesFor,
    findLine,
    add,
    increment,
    decrement,
    setQty,
    remove,
    removeAll,
    clearAll,
    renew,
    reconcile,
    counts,
    /** True only when a non-empty draft was discarded because it had aged out */
    expiredOnLoad: boot.expired,
    totalStyles: counts.styles,
    totalVariants: counts.variants,
    totalUnits: counts.units,
  }
}
