/**
 * Sold-out variants self-check
 *   node scripts/test-sold-out.mjs
 *
 * Pure functions only. The suites that matter:
 *
 *   [3] isOptionAvailable — the rule is contextual, not a per-option flag.
 *       Colour is picked before size, so `Green` may only be disabled once every
 *       Green size is gone; `M` may only be disabled for the colour already
 *       chosen. Getting this wrong either hides stock that exists or offers
 *       stock that does not.
 *   [6] the field whitelist — `sold_out_variants` has to survive the row ⇄
 *       product round trip. Three other fields were each silently dropped here
 *       once; a fourth would look exactly the same (marks vanish, nothing errors).
 */

import {
  soldOutListOf,
  soldOutKeysOf,
  normalizeSoldOut,
  pruneSoldOut,
  combinationsOf,
  colourAxisOf,
  sizeAxisOf,
  isSoldOut,
  isAxisFullySoldOut,
  isOptionAvailable,
  soldOutSummary,
  summaryLabel,
  withKeySoldOut,
  setAxisSoldOut,
  toggleAxisSoldOut,
  partitionLines,
} from '../src/utils/soldOut.js'
import { variantKey } from '../src/utils/sku.js'
import { rowToProduct, productToRow } from '../src/store/mapping.js'

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

/* A three-colour, three-size product. Green/M and Green/S are out. */
const tee = {
  id: 'p003',
  specs: { Colour: ['Black', 'White', 'Green'], Size: ['S', 'M', 'L'] },
  soldOutVariants: ['Green|S', 'Green|M'],
}

/* ── 1. reading the column ─────────────────────────────────────────────── */
console.log('\n[1] Reading the column')
check('array read back', soldOutListOf(tee), ['Green|S', 'Green|M'])
check('missing field is empty', soldOutListOf({ specs: {} }), [])
check('null is empty', soldOutListOf({ soldOutVariants: null }), [])
check('a bare string is not an array', soldOutListOf({ soldOutVariants: 'Green|S' }), [])
check('non-strings dropped', soldOutListOf({ soldOutVariants: ['Green|S', 3, null, '  '] }), ['Green|S'])
check('entries trimmed', soldOutListOf({ soldOutVariants: [' Green|S '] }), ['Green|S'])
check('keys lowercased for lookup', [...soldOutKeysOf(tee)], ['green|s', 'green|m'])

check('normalize dedupes case-insensitively', normalizeSoldOut(['Green|S', 'green|s', 'WHITE|L']), ['Green|S', 'WHITE|L'])
check('normalize keeps the first spelling', normalizeSoldOut(['green|s', 'Green|S']), ['green|s'])
check('normalize rejects non-array', normalizeSoldOut('Green|S'), [])
check('normalize drops blanks', normalizeSoldOut(['', '   ', 'Green|S']), ['Green|S'])

/* ── 2. combinations ───────────────────────────────────────────────────── */
console.log('\n[2] Combinations')
const combos = combinationsOf(tee)
check('colour × size', combos.length, 9)
check('first combination', combos[0], {
  colour: 'Black',
  size: 'S',
  key: 'Black|S',
  specs: { Colour: 'Black', Size: 'S' },
})
check('last combination', combos[8].key, 'Green|L')
check('key matches variantKey', combos[4].key, variantKey('White', 'M'))
check('colour axis', colourAxisOf(tee).options, ['Black', 'White', 'Green'])
check('size axis', sizeAxisOf(tee).options, ['S', 'M', 'L'])

const oneSize = { specs: { Colour: ['Green', 'Black'] } }
check('one-size → colour keys only', combinationsOf(oneSize).map((c) => c.key), ['Green|', 'Black|'])
check('one-size specs carry no Size', combinationsOf(oneSize)[0].specs, { Colour: 'Green' })

const sizeOnly = { specs: { Size: ['S', 'M'] } }
check('size-only → leading pipe', combinationsOf(sizeOnly).map((c) => c.key), ['|S', '|M'])

check('no specs → nothing to mark', combinationsOf({ specs: {} }), [])
check('no product → nothing to mark', combinationsOf(null), [])
check('chinese type names resolve', colourAxisOf({ specs: { 颜色: ['Black'] } }).options, ['Black'])
check('chinese size names resolve', sizeAxisOf({ specs: { 尺寸: ['M'] } }).options, ['M'])

/* ── 3. isSoldOut / isOptionAvailable ──────────────────────────────────── */
console.log('\n[3] Sold out checks')
check('exact combination is out', isSoldOut(tee, { Colour: 'Green', Size: 'M' }), true)
check('other size of the same colour is fine', isSoldOut(tee, { Colour: 'Green', Size: 'L' }), false)
check('other colour is fine', isSoldOut(tee, { Colour: 'Black', Size: 'M' }), false)
check('case drift still matches', isSoldOut({ soldOutVariants: ['green|m'] }, { Colour: 'Green', Size: 'M' }), true)
check('no marks → never sold out', isSoldOut({ specs: tee.specs }, { Colour: 'Green', Size: 'M' }), false)

check('Green is not fully out (L remains)', isAxisFullySoldOut(tee, 'colour', 'Green'), false)
check('Black is not out', isAxisFullySoldOut(tee, 'colour', 'Black'), false)
const greenGone = { specs: tee.specs, soldOutVariants: ['Green|S', 'Green|M', 'Green|L'] }
check('Green fully out once every size is', isAxisFullySoldOut(greenGone, 'colour', 'Green'), true)

/* Colour is chosen first — with nothing picked, Green is still selectable
 * because Green/L is in stock. */
check('Green selectable with nothing picked', isOptionAvailable(tee, {}, 'Colour', 'Green'), true)
/* Once Green is picked, only M and S are dead — L must stay live. */
check('Green/M blocked once Green is picked', isOptionAvailable(tee, { Colour: 'Green' }, 'Size', 'M'), false)
check('Green/S blocked once Green is picked', isOptionAvailable(tee, { Colour: 'Green' }, 'Size', 'S'), false)
check('Green/L stays selectable', isOptionAvailable(tee, { Colour: 'Green' }, 'Size', 'L'), true)
/* Black is untouched by Green's stock. */
check('Black/M unaffected', isOptionAvailable(tee, { Colour: 'Black' }, 'Size', 'M'), true)
/* Fully gone colour is blocked before a size is even picked. */
check('fully-gone colour blocked', isOptionAvailable(greenGone, {}, 'Colour', 'Green'), false)
check('in-stock colour still open', isOptionAvailable(greenGone, {}, 'Colour', 'Black'), true)
check('one-size colour respects the key', isOptionAvailable({ specs: oneSize.specs, soldOutVariants: ['Green|'] }, {}, 'Colour', 'Green'), false)
check('unknown product is always available', isOptionAvailable(null, {}, 'Colour', 'Green'), true)

/* ── 4. summary ────────────────────────────────────────────────────────── */
console.log('\n[4] Summary')
check('partial', soldOutSummary(tee), { total: 9, soldOut: 2, all: false, some: true })
check('partial label', summaryLabel(tee), '2 / 9 sold out')
check('none', soldOutSummary({ specs: tee.specs }), { total: 9, soldOut: 0, all: false, some: false })
check('none label', summaryLabel({ specs: tee.specs }), 'All 9 available')
check('all', soldOutSummary({ specs: tee.specs, soldOutVariants: combos.map((c) => c.key) }).all, true)
check('all label', summaryLabel({ specs: tee.specs, soldOutVariants: combos.map((c) => c.key) }), 'All 9 sold out')
check('no variants label', summaryLabel({ specs: {} }), 'No variants')
check('stale keys do not inflate the count', soldOutSummary({ specs: tee.specs, soldOutVariants: ['Purple|XL'] }).soldOut, 0)

/* ── 5. editing ────────────────────────────────────────────────────────── */
console.log('\n[5] Editing')
check('add one', withKeySoldOut([], 'Green|M', true), ['Green|M'])
check('remove one', withKeySoldOut(['Green|M', 'Green|S'], 'Green|M', false), ['Green|S'])
check('re-marking the same key is a no-op', withKeySoldOut(['green|m'], 'Green|M', true), ['green|m'])
check('removing is case-insensitive', withKeySoldOut(['green|m'], 'Green|M', false), [])
check('set a whole colour', setAxisSoldOut([], tee, 'colour', 'Green', true), ['Green|S', 'Green|M', 'Green|L'])
check('clear a whole colour', setAxisSoldOut(['Green|S', 'Green|M', 'Black|S'], tee, 'colour', 'Green', false), ['Black|S'])
check('set a whole size', setAxisSoldOut([], tee, 'size', 'M', true), ['Black|M', 'White|M', 'Green|M'])
check('unknown axis value is a no-op', setAxisSoldOut(['Black|S'], tee, 'colour', 'Purple', true), ['Black|S'])
check('toggle adds when partial', toggleAxisSoldOut(['Green|M'], tee, 'colour', 'Green'), ['Green|M', 'Green|S', 'Green|L'])
check('toggle clears when complete', toggleAxisSoldOut(['Green|M', 'Green|S', 'Green|L'], tee, 'colour', 'Green'), [])

check('prune drops renamed colours', pruneSoldOut(['Green|M', 'Purple|S'], tee), ['Green|M'])
check('prune drops removed sizes', pruneSoldOut(['Green|XL'], tee), [])
check('prune keeps the rest', pruneSoldOut(['Green|S', 'Black|L'], tee), ['Green|S', 'Black|L'])
check('prune on an unspecced product clears', pruneSoldOut(['Green|M'], { specs: {} }), [])

/* ── 6. the field whitelist ────────────────────────────────────────────── */
console.log('\n[6] Field whitelist')
const row = {
  id: 'p003',
  sku: 'P9B013',
  name: 'Sports Bra',
  category: 'Tops',
  image: 'a.jpg',
  specs: { Colour: ['Black', 'Green'], Size: ['S', 'M'] },
  variant_images: {},
  sold_out_variants: ['Green|S'],
  hidden: false,
  tag: '',
}

const product = rowToProduct(row)
check('row → product keeps the marks', product.soldOutVariants, ['Green|S'])
check('product → row writes snake_case', productToRow(product).sold_out_variants, ['Green|S'])
check('round trip survives', rowToProduct(productToRow(product)).soldOutVariants, ['Green|S'])
check('empty list is still an array', productToRow({ specs: {} }).sold_out_variants, [])
check('empty list is omitted from the product', 'soldOutVariants' in rowToProduct({ ...row, sold_out_variants: [] }), false)
check('missing column is tolerated', rowToProduct({ ...row, sold_out_variants: undefined }).soldOutVariants, undefined)
check('specs order untouched by the new field', Object.keys(product.specs), ['Colour', 'Size'])

/* ── 7. the cart ───────────────────────────────────────────────────────── */
console.log('\n[7] Cart partition')
const byId = new Map([['p003', tee]])
const lines = [
  { key: 'p003::Black|M', productId: 'p003', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
  { key: 'p003::Green|M', productId: 'p003', qty: 2, specs: { Colour: 'Green', Size: 'M' } },
  { key: 'p999::Black|M', productId: 'p999', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
]
const split = partitionLines(lines, byId)
check('available keeps the in-stock line', split.available.map((l) => l.key), ['p003::Black|M', 'p999::Black|M'])
check('sold out keeps the gone line', split.soldOut.map((l) => l.key), ['p003::Green|M'])
check('quantity survives the split', split.soldOut[0].qty, 2)
check('unknown product is not called sold out', partitionLines([lines[2]], byId).available.length, 1)
check('plain object lookup works too', partitionLines(lines, { p003: tee }).soldOut.length, 1)
check('empty selection', partitionLines([], byId), { available: [], soldOut: [] })
check('nothing is deleted by partitioning', split.available.length + split.soldOut.length, 3)

/* ── summary ───────────────────────────────────────────────────────────── */
console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed) {
  console.log(`Failed ${failed}`)
  process.exit(1)
}
