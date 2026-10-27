/**
 * Selection lines
 * ═══════════════
 * One line = one orderable variant combination. The creator can take the same
 * piece twice in different colours or sizes, so a product is no longer the unit
 * of the selection — `productId + the chosen option values` is.
 *
 *   { key: 'p003::Black|M', productId: 'p003', qty: 2, specs: { Colour: 'Black', Size: 'M' } }
 *
 * WHY A STRING KEY
 * The selection is persisted to localStorage and rebuilt from it on load, so
 * every line needs a stable identity that survives a JSON round trip. Deriving
 * it from the product's own spec-type order (not from Object.keys of the chosen
 * specs) means the key is identical whether it was built at add time or rebuilt
 * from storage — and it stays readable in DevTools, which matters when someone
 * reports "I added two but only one shows".
 *
 * WHY SANITISE ON EVERY PATH
 * The catalogue is editable while a creator is mid-selection. Delete a colour
 * in the admin console and every open browser still holds a line referring to
 * it. Without cleaning, that line keeps showing up in the cart and travels into
 * the selection code, so ops orders a colour that no longer exists. `sanitize`
 * is applied when adding, when restoring from storage, when opening the detail
 * sheet, and once more before encoding.
 *
 * Pure functions only — imported by the Node test suite and by utils/code.js.
 */

import { isTeaser } from './teaser.js'

/** Max units per line — one base36 digit in the code */
export const MAX_QTY = 35

const SEP = '::'
const JOIN = '|'

function optionsOf(product, type) {
  const raw = product?.specs?.[type]
  if (raw === undefined || raw === null) return []
  return Array.isArray(raw) ? raw : [raw]
}

/** Canonical option value for `value`, tolerating case drift; '' when unknown */
function canonicalOption(product, type, value) {
  if (value === undefined || value === null || value === '') return ''
  const wanted = String(value)
  const options = optionsOf(product, type)
  const exact = options.find((option) => String(option) === wanted)
  if (exact !== undefined) return String(exact)
  const lower = wanted.toLowerCase()
  const loose = options.find((option) => String(option).toLowerCase() === lower)
  return loose === undefined ? '' : String(loose)
}

/** Spec type names for a product, in declaration order (key order matters) */
export function specTypesOf(product) {
  return Object.keys(product?.specs || {})
}

/**
 * Stable identity for one variant of one product.
 * Values are escaped so an option containing "|" cannot collide with the join.
 */
export function lineKey(product, specs) {
  const id = String(product?.id ?? '')
  const declared = specTypesOf(product)
  const types = declared.length ? declared : Object.keys(specs || {})
  const values = types.map((type) => encodeURIComponent(specs?.[type] ?? '')).join(JOIN)
  return `${id}${SEP}${values}`
}

/**
 * Drop every type and value the product no longer offers.
 * A line for a deleted colour comes back as `{}`, which `isComplete` then
 * rejects — that is the point: the creator is asked to pick again instead of
 * silently ordering something that is gone.
 */
export function sanitizeSpecs(product, specs) {
  const clean = {}
  if (!specs || typeof specs !== 'object') return clean

  for (const type of specTypesOf(product)) {
    const value = canonicalOption(product, type, specs[type])
    if (value) clean[type] = value
  }
  return clean
}

/** True when every declared spec type has a valid value */
export function isComplete(product, specs) {
  const types = specTypesOf(product)
  if (!types.length) return true
  return types.every((type) => Boolean(specs?.[type]))
}

export function clampQty(value) {
  const n = Math.floor(Number(value) || 0)
  if (n <= 0) return 0
  return Math.min(MAX_QTY, n)
}

/**
 * Build a line. Returns null when the combination is incomplete — callers treat
 * that as "ask the creator to finish choosing", never as an error.
 */
export function makeLine(product, specs, qty = 1) {
  if (!product?.id) return null

  /* Coming Soon is not orderable by ANY path. This is the narrowest chokepoint
   * every add goes through — the card heart, the sheet's add button, a restore
   * from storage that tries to re-add — so one check here means no new line can
   * be created for a teaser. Existing lines are handled at generation time so
   * the creator is told, rather than the item vanishing. */
  if (isTeaser(product)) return null

  const clean = sanitizeSpecs(product, specs)
  if (!isComplete(product, clean)) return null

  const amount = clampQty(qty)
  if (!amount) return null

  return {
    key: lineKey(product, clean),
    productId: String(product.id),
    qty: amount,
    specs: clean,
  }
}

/**
 * Add a variant to the selection.
 * Same combination → quantity goes up on the existing line. Different
 * combination → a new line, appended so the cart reads in pick order.
 */
export function addLine(lines, product, specs, qty = 1) {
  const incoming = makeLine(product, specs, qty)
  if (!incoming) return lines

  const index = lines.findIndex((line) => line.key === incoming.key)
  if (index === -1) return [...lines, incoming]

  const merged = {
    ...lines[index],
    qty: clampQty(lines[index].qty + incoming.qty),
  }
  return lines.map((line, i) => (i === index ? merged : line))
}

/** Set an exact quantity on one line; 0 or less removes it */
export function setLineQty(lines, key, qty) {
  const amount = clampQty(qty)
  if (!amount) return lines.filter((line) => line.key !== key)
  return lines.map((line) => (line.key === key ? { ...line, qty: amount } : line))
}

export function incrementLine(lines, key, by = 1) {
  const line = lines.find((l) => l.key === key)
  if (!line) return lines
  return setLineQty(lines, key, line.qty + by)
}

export function decrementLine(lines, key, by = 1) {
  const line = lines.find((l) => l.key === key)
  if (!line) return lines
  return setLineQty(lines, key, line.qty - by)
}

export function removeLine(lines, key) {
  return lines.filter((line) => line.key !== key)
}

/** Remove every variant of one product — what the heart button does */
export function removeProduct(lines, productId) {
  const id = String(productId)
  return lines.filter((line) => line.productId !== id)
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function linesFor(lines, productId) {
  const id = String(productId)
  return lines.filter((line) => line.productId === id)
}

/** Total units of one product across all its variants */
export function sumQty(lines, productId) {
  const id = String(productId)
  return lines.reduce((sum, line) => (line.productId === id ? sum + line.qty : sum), 0)
}

/**
 * Three numbers, deliberately distinct:
 *   styles   distinct products   — "how many pieces did she pick"
 *   variants lines               — "how many combinations"
 *   units    sum of quantities   — "how many pieces in the box"
 */
export function countsOf(lines) {
  const styles = new Set(lines.map((line) => line.productId)).size
  const units = lines.reduce((sum, line) => sum + line.qty, 0)
  return { styles, variants: lines.length, units }
}

/**
 * Rebuild the selection against the current catalogue.
 *
 * Drops lines whose product is gone and lines whose colour/size no longer
 * exists. Returns the original array when nothing changed so React can skip the
 * re-render, and reports what was dropped so the UI can explain itself.
 */
export function reconcileLines(lines, productsById) {
  const kept = []
  const dropped = []

  for (const line of lines) {
    const product = productsById instanceof Map
      ? productsById.get(line.productId)
      : productsById?.[line.productId]

    if (!product) {
      dropped.push({ ...line, reason: 'product' })
      continue
    }

    const specs = sanitizeSpecs(product, line.specs)
    if (!isComplete(product, specs)) {
      dropped.push({ ...line, reason: 'variant' })
      continue
    }

    const key = lineKey(product, specs)
    if (key === line.key) {
      kept.push(line)
      continue
    }

    /* Same product and same values, but the spec-type order changed (someone
     * renamed or reordered the types in the editor). Re-key rather than drop. */
    const existing = kept.findIndex((entry) => entry.key === key)
    if (existing === -1) kept.push({ ...line, key, specs })
    else kept[existing] = { ...kept[existing], qty: clampQty(kept[existing].qty + line.qty) }
  }

  if (!dropped.length && kept.length === lines.length) {
    const unchanged = kept.every((line, i) => line === lines[i])
    if (unchanged) return { lines, dropped }
  }

  return { lines: kept, dropped }
}

/** Loose shape check for anything coming out of localStorage */
export function isLine(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.key === 'string' &&
      value.key &&
      typeof value.productId === 'string' &&
      value.productId &&
      Number.isFinite(Number(value.qty)) &&
      Number(value.qty) > 0,
  )
}
