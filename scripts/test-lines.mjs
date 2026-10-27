/**
 * Selection-line self-check
 *   node scripts/test-lines.mjs
 *
 * Pure functions only — no Supabase, no DOM. Everything here is about the one
 * invariant the multi-variant selection rests on: a line is identified by
 * product + the values of the product's own spec types, and a line that no
 * longer matches the catalogue must disappear rather than survive as a ghost.
 */

import {
  MAX_QTY,
  lineKey,
  sanitizeSpecs,
  isComplete,
  makeLine,
  addLine,
  setLineQty,
  incrementLine,
  decrementLine,
  removeLine,
  removeProduct,
  linesFor,
  sumQty,
  countsOf,
  reconcileLines,
  isLine,
  specTypesOf,
} from '../src/utils/lines.js'

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

/** Minimal catalogue — two spec types, plus a one-size product */
const shirt = {
  id: 'p001',
  name: 'Shirt',
  specs: { Colour: ['Black', 'White'], Size: ['S', 'M', 'L'] },
}
const oneSize = { id: 'p002', name: 'Scarf', specs: {} }

/* ── 1. keys ── */
console.log('\n[1] Line keys')
check(
  'key is product + declared values',
  lineKey(shirt, { Colour: 'Black', Size: 'M' }),
  'p001::Black|M',
)
check(
  'key ignores input order — product order wins',
  lineKey(shirt, { Size: 'M', Colour: 'Black' }),
  lineKey(shirt, { Colour: 'Black', Size: 'M' }),
)
check(
  'different colours give different keys',
  lineKey(shirt, { Colour: 'Black', Size: 'M' }) === lineKey(shirt, { Colour: 'White', Size: 'M' }),
  false,
)
check('one-size key has no values', lineKey(oneSize, {}), 'p002::')
check(
  'a value containing the join char cannot collide',
  lineKey(shirt, { Colour: 'A|B', Size: 'M' }) === lineKey(shirt, { Colour: 'A', Size: 'B|M' }),
  false,
)
check('specTypesOf follows declaration order', specTypesOf(shirt), ['Colour', 'Size'])

/* ── 2. sanitising ── */
console.log('\n[2] Sanitising against the live catalogue')
check(
  'keeps valid values',
  sanitizeSpecs(shirt, { Colour: 'Black', Size: 'M' }),
  { Colour: 'Black', Size: 'M' },
)
check(
  'drops a deleted colour',
  sanitizeSpecs(shirt, { Colour: 'Charcoal', Size: 'M' }),
  { Size: 'M' },
)
check(
  'drops a deleted spec type',
  sanitizeSpecs(shirt, { Colour: 'Black', Length: 'Long' }),
  { Colour: 'Black' },
)
check(
  'canonicalises case drift',
  sanitizeSpecs(shirt, { Colour: 'black', Size: 'm' }),
  { Colour: 'Black', Size: 'M' },
)
check('ignores non-object input', sanitizeSpecs(shirt, null), {})
check('one-size product yields no specs', sanitizeSpecs(oneSize, { Colour: 'Black' }), {})

console.log('\n[3] Completeness')
check('both types chosen', isComplete(shirt, { Colour: 'Black', Size: 'M' }), true)
check('one type missing', isComplete(shirt, { Colour: 'Black' }), false)
check('one-size is always complete', isComplete(oneSize, {}), true)

/* ── 4. building lines ── */
console.log('\n[4] makeLine')
check('builds a line', makeLine(shirt, { Colour: 'Black', Size: 'M' }, 2), {
  key: 'p001::Black|M',
  productId: 'p001',
  qty: 2,
  specs: { Colour: 'Black', Size: 'M' },
})
check('incomplete → null', makeLine(shirt, { Colour: 'Black' }, 1), null)
check('deleted colour → null', makeLine(shirt, { Colour: 'Charcoal', Size: 'M' }, 1), null)
check('zero qty → null', makeLine(shirt, { Colour: 'Black', Size: 'M' }, 0), null)
check(
  'qty is clamped to MAX_QTY',
  makeLine(shirt, { Colour: 'Black', Size: 'M' }, 999).qty,
  MAX_QTY,
)

/* ── 5. adding ── */
console.log('\n[5] Adding variants')
let lines = []
lines = addLine(lines, shirt, { Colour: 'Black', Size: 'M' })
check('first add creates one line', lines.length, 1)
lines = addLine(lines, shirt, { Colour: 'Black', Size: 'M' })
check('same combination increments', lines[0].qty, 2)
check('same combination does not add a line', lines.length, 1)
lines = addLine(lines, shirt, { Colour: 'White', Size: 'L' })
check('different combination adds a line', lines.length, 2)
check('lines keep pick order', lines.map((l) => l.key), ['p001::Black|M', 'p001::White|L'])
check('total units of the product', sumQty(lines, 'p001'), 3)
check('linesFor returns both', linesFor(lines, 'p001').length, 2)
check('another product has none', linesFor(lines, 'p009').length, 0)

console.log('\n[6] Counts')
check('counts: styles / variants / units', countsOf(lines), {
  styles: 1,
  variants: 2,
  units: 3,
})
const mixed = addLine(lines, oneSize, {})
check('a second product bumps styles', countsOf(mixed).styles, 2)
check('variants follow lines', countsOf(mixed).variants, 3)
check('units add up', countsOf(mixed).units, 4)

/* ── 7. editing ── */
console.log('\n[7] Editing and removing')
const key = 'p001::Black|M'
check('setQty changes one line', setLineQty(lines, key, 5)[0].qty, 5)
check('setQty 0 removes the line', setLineQty(lines, key, 0).length, 1)
check('increment', incrementLine(lines, key).find((l) => l.key === key).qty, 3)
check('decrement', decrementLine(lines, key).find((l) => l.key === key).qty, 1)
check(
  'decrement to zero removes the line',
  decrementLine(setLineQty(lines, key, 1), key).length,
  1,
)
check('removeLine drops only that variant', removeLine(lines, key).length, 1)
check('removeProduct drops every variant', removeProduct(lines, 'p001').length, 0)
check('increment on an unknown key is a no-op', incrementLine(lines, 'nope').length, 2)

/* ── 8. reconciling with the catalogue ── */
console.log('\n[8] Reconcile against the catalogue')

const byId = new Map([
  ['p001', shirt],
  ['p002', oneSize],
])

const clean = reconcileLines(lines, byId)
check('valid lines survive', clean.lines.length, 2)
check('nothing dropped', clean.dropped.length, 0)
check('same array reference when untouched', clean.lines === lines, true)

/* colour removed from the product while the tab was open */
const shrunk = { ...shirt, specs: { Colour: ['White'], Size: ['S', 'M', 'L'] } }
const afterDelete = reconcileLines(lines, new Map([['p001', shrunk], ['p002', oneSize]]))
check('the deleted colour is dropped', afterDelete.lines.length, 1)
check('the surviving line is White/L', afterDelete.lines[0].key, 'p001::White|L')
check('the drop is reported', afterDelete.dropped[0].reason, 'variant')

/* product deleted entirely */
const afterProductDelete = reconcileLines(lines, new Map([['p002', oneSize]]))
check('a deleted product drops its lines', afterProductDelete.lines.length, 0)
check('reason is product', afterProductDelete.dropped[0].reason, 'product')

/* spec types reordered in the editor — re-key, do not drop */
const reordered = { ...shirt, specs: { Size: ['S', 'M', 'L'], Colour: ['Black', 'White'] } }
const afterReorder = reconcileLines(lines, new Map([['p001', reordered], ['p002', oneSize]]))
check('re-keyed lines are kept', afterReorder.lines.length, 2)
check('the key follows the new order', afterReorder.lines[0].key, 'p001::M|Black')
check('quantity survives the re-key', afterReorder.lines[0].qty, 2)

/* duplicate keys after a re-key must merge, not duplicate */
const dup = [
  { key: 'a', productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
  { key: 'b', productId: 'p001', qty: 2, specs: { Colour: 'Black', Size: 'M' } },
]
const merged = reconcileLines(dup, byId)
check('same combination merges on reconcile', merged.lines.length, 1)
check('merged quantity is summed', merged.lines[0].qty, 3)

/* ── 9. storage shape guard ── */
console.log('\n[9] Storage shape')
check('a real line passes', isLine({ key: 'p001::Black|M', productId: 'p001', qty: 1, specs: {} }), true)
check('missing key fails', isLine({ productId: 'p001', qty: 1 }), false)
check('zero qty fails', isLine({ key: 'x', productId: 'p001', qty: 0 }), false)
check('null fails', isLine(null), false)
check('a string fails', isLine('p001::Black|M'), false)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
