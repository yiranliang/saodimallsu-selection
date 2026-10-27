/**
 * Size order self-check
 * Run: npm run test:sizes
 *
 * Pure Node — no browser, no database.
 *
 * WHY THIS SUITE EXISTS
 * ─────────────────────
 * Two bugs, one shape: the stored `specs.Size` array is import order, and 70-odd
 * live products have it scrambled (`XXL,S,L,M,XL`), while one surface sorted it
 * alphabetically (`L,M,S,XL,XXL`) and the rest rendered it as-is. So there are
 * four things to prove, in this order:
 *
 *   1. the ladder itself — letter sizes, the `2XL`/`XXXL` spellings, numeric
 *      sizes as numbers (`10` must not come before `2`)
 *   2. everything unknown keeps its place at the end instead of being ranked by
 *      guesswork, and nothing is ever mutated
 *   3. reordering is display-only: the combination KEYS are identical before and
 *      after, so no sold-out mark or ASIN mapping can be orphaned by it
 *   4. selection codes are unaffected — v4/v5 carry literal values, and a
 *      scrambled size list and a sorted one encode to the same code
 *
 * Point 4 is the one that would be catastrophic to get wrong: rewriting the
 * stored array instead of sorting on read would re-point every legacy v1/v2
 * code, which resolves options by *position*. `specs` is never written here.
 */

import {
  SIZE_ORDER,
  compareSizes,
  isSizeType,
  isSortedSizes,
  sizeOrder,
  sortSizes,
} from '../src/utils/sizes.js'
import { colourAxisOf, combinationsOf, isOptionAvailable, sizeAxisOf, soldOutSummary } from '../src/utils/soldOut.js'
import { generateCodeFromLines, decodeCode } from '../src/utils/code.js'
import { __setCatalogueForTests as setCatalogue } from '../src/store/productStore.js'
import { __setAsinsForTests as setAsins } from '../src/utils/asinStore.js'

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

/* ── 1. the ladder ── */
console.log('\n[1] Letter sizes, smallest → largest')

check('the ladder starts at XXXS and ends at 6XL', [SIZE_ORDER[0], SIZE_ORDER.at(-1)], ['XXXS', '6XL'])
check('the canonical six', sortSizes(['XL', 'S', 'M', 'L', 'XXL']), ['S', 'M', 'L', 'XL', 'XXL'])

/* The exact shapes found in the live catalogue — one third of it is scrambled
 * like this, which is what the bug report was looking at. */
check(
  'the live scramble XXL,S,L,M,XL',
  sortSizes(['XXL', 'S', 'L', 'M', 'XL']),
  ['S', 'M', 'L', 'XL', 'XXL'],
)
check(
  'the live scramble XL,M,XXL,L,S',
  sortSizes(['XL', 'M', 'XXL', 'L', 'S']),
  ['S', 'M', 'L', 'XL', 'XXL'],
)
check(
  'XS joins at the front',
  sortSizes(['L', 'XS', 'M', 'S']),
  ['XS', 'S', 'M', 'L'],
)
check(
  '3XL goes last',
  sortSizes(['3XL', 'S', 'XXL', 'M', 'XS', 'L', 'XL']),
  ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
)
check('4XL after 3XL', sortSizes(['4XL', '3XL']), ['3XL', '4XL'])
check(
  'any run of X keeps working',
  sortSizes(['XXXXL', 'XXXXS', 'M']),
  ['XXXXS', 'M', 'XXXXL'],
)

/* ── 2. numeric sizes sort as numbers ── */
console.log('\n[2] Numeric sizes')

check(
  'the live scramble 2,12,14,6,4,8,10',
  sortSizes(['2', '12', '14', '6', '4', '8', '10']),
  ['2', '4', '6', '8', '10', '12', '14'],
)
check(
  'kids heights 120 → 160',
  sortSizes(['160', '120', '150', '130', '140']),
  ['120', '130', '140', '150', '160'],
)
check('text order would have put 10 before 2', ['2', '10'].sort(), ['10', '2'])
check('half sizes', sortSizes(['2.5', '2', '3']), ['2', '2.5', '3'])
check('a unit suffix is ignored', sortSizes(['18M', '6M', '12M']), ['6M', '12M', '18M'])
check('numeric before unknown', sortSizes(['One Size', '8', '10']), ['8', '10', 'One Size'])

/* ── 3. spellings that mean the same size ── */
console.log('\n[3] Equivalences')

check('2XL is XXL', compareSizes('2XL', 'XXL'), 0)
check('XXXL is 3XL', compareSizes('XXXL', '3XL'), 0)
check('2XS is XXS', compareSizes('2XS', 'XXS'), 0)
check('Small is S', compareSizes('Small', 'S'), 0)
check('Large is L', compareSizes('Large', 'L'), 0)
check('case and spaces do not matter', compareSizes(' xl ', 'XL'), 0)
check(
  'long spellings interleave instead of piling up at the end',
  sortSizes(['Large', 'Small', 'Medium']),
  ['Small', 'Medium', 'Large'],
)
check('XL is bigger than L', compareSizes('XL', 'L') > 0, true)
check('S is smaller than M', compareSizes('S', 'M') < 0, true)
check('XXS is smaller than XS', compareSizes('XXS', 'XS') < 0, true)

/* ── 4. unknowns, and the no-mutation contract ── */
console.log('\n[4] Unknowns and purity')

check('unknown values go last', sortSizes(['One Size', 'M', 'S']), ['S', 'M', 'One Size'])
check('two unknowns keep their relative order', sortSizes(['Petite', 'S', 'Tall']), ['S', 'Petite', 'Tall'])
check('an empty row (being typed) stays last', sortSizes(['XL', '', 'S']), ['S', 'XL', ''])

const input = ['XXL', 'S', 'M']
const copy = [...input]
sortSizes(input)
check('the input array is not mutated', input, copy)

const alreadySorted = ['S', 'M', 'L']
check('an ordered list comes back as the same reference', sortSizes(alreadySorted) === alreadySorted, true)
const scrambled = ['L', 'S', 'M']
check('an unordered list comes back as a new array', sortSizes(scrambled) !== scrambled, true)
check('sorting twice is sorting once', sortSizes(sortSizes(scrambled)), ['S', 'M', 'L'])
check('values are preserved, not rewritten', sortSizes(['large', 'SMALL']), ['SMALL', 'large'])
check('non-array input is an empty list', sortSizes(undefined), [])
check('one value needs no work', sortSizes(['M']), ['M'])

check('isSortedSizes on a sorted list', isSortedSizes(['S', 'M', 'L']), true)
check('isSortedSizes on the live scramble', isSortedSizes(['XXL', 'S', 'L', 'M', 'XL']), false)

check('sizeOrder is a permutation', [...sizeOrder(['XXL', 'S', 'M'])].sort(), [0, 1, 2])
check('sizeOrder drives the same result', sizeOrder(['XXL', 'S', 'M']), [1, 2, 0])

/* ── 5. which spec groups are "sizes" ── */
console.log('\n[5] Type names')

check('Size', isSizeType('Size'), true)
check('size', isSizeType('size'), true)
check('SIZE', isSizeType('SIZE'), true)
check('尺码', isSizeType('尺码'), true)
check('尺寸', isSizeType('尺寸'), true)
check('Shoe Size', isSizeType('Shoe Size'), true)
check('Colour is not a size', isSizeType('Colour'), false)
check('颜色 is not a size', isSizeType('颜色'), false)
check('Oversize is not "size"', isSizeType('Oversize'), false)
check('Length is not a size', isSizeType('Length'), false)
check('empty is not a size', isSizeType(''), false)

/* ── 6. the axes the UI renders ── */
console.log('\n[6] Axes used by the sheet, the stock grid and the ASIN list')

const scrambledProduct = {
  id: 'p900',
  sku: 'TEST900',
  name: 'Scrambled',
  specs: { Colour: ['Green', 'Black', 'White'], Size: ['XXL', 'S', 'L', 'M', 'XL'] },
  soldOutVariants: ['Green|M', 'Black|XXL'],
}

check('sizes come out ordered', sizeAxisOf(scrambledProduct).options, ['S', 'M', 'L', 'XL', 'XXL'])
check('the size type name is untouched', sizeAxisOf(scrambledProduct).type, 'Size')
check(
  'colours keep the order the product declares',
  colourAxisOf(scrambledProduct).options,
  ['Green', 'Black', 'White'],
)

const combos = combinationsOf(scrambledProduct)
check('the first combination is the smallest size', combos[0].key, 'Green|S')
check('the last is the largest, last colour', combos.at(-1).key, 'White|XXL')
check(
  'a colour block reads S → XXL',
  combos.filter((combo) => combo.colour === 'Black').map((combo) => combo.size),
  ['S', 'M', 'L', 'XL', 'XXL'],
)

/* The load-bearing one: sorting changes the ORDER of the keys, never the SET.
 * If it did, every stored sold-out mark and every ASIN key would point at a
 * combination that no longer exists. */
const sortedProduct = {
  ...scrambledProduct,
  specs: { Colour: ['Green', 'Black', 'White'], Size: ['S', 'M', 'L', 'XL', 'XXL'] },
}
const keySet = (product) => combinationsOf(product).map((combo) => combo.key).sort()
check('the combination keys are identical before and after sorting', keySet(scrambledProduct), keySet(sortedProduct))
check('the counts are identical', soldOutSummary(scrambledProduct), soldOutSummary(sortedProduct))
check('stored marks still resolve', soldOutSummary(scrambledProduct).soldOut, 2)
check(
  'a sold-out size is still unavailable whatever its array position',
  isOptionAvailable(scrambledProduct, { Colour: 'Green' }, 'Size', 'M'),
  false,
)
check(
  'a stocked size of the same colour stays available',
  isOptionAvailable(scrambledProduct, { Colour: 'Green' }, 'Size', 'L'),
  true,
)

/* ── 7. selection codes ── */
console.log('\n[7] Selection codes · round-trip and the reorder fingerprint')

setCatalogue([scrambledProduct])
setAsins({})

const line = { productId: 'p900', qty: 2, specs: { Colour: 'Green', Size: 'M' } }
const scrambledCode = generateCodeFromLines('luna', [line])
const decoded = decodeCode(scrambledCode.code)

check('the code still decodes', decoded.ok, true)
check('the size is the value that was picked, not a position', decoded.items[0].specs, {
  Colour: 'Green',
  Size: 'M',
})
check('the quantity survives', decoded.items[0].qty, 2)

/* Same catalogue, one differing thing: the stored size array is in canonical
 * order now. v7 stores option *positions*, so the two codes necessarily differ
 * — that is the trade that makes 50 styles fit in 150 characters. What must not
 * happen is a silent misread: decoding the scrambled code against the reordered
 * catalogue has to raise the "check the variant" flag, so ops never ships the
 * wrong size. (v4 stored the literal "Green|M" and survived reordering; v7 buys
 * the length with a fingerprint instead. See README.) */
setCatalogue([sortedProduct])
const sortedCode = generateCodeFromLines('luna', [line])
/* Both decodes happen against the catalogue the codes were issued for:
 * `sortedCode` matches it, `scrambledCode` does not. */
const sortedDecoded = decodeCode(sortedCode.code)
const crossed = decodeCode(scrambledCode.code)
setCatalogue([scrambledProduct])

check('the reordered catalogue produces a different code', sortedCode.code !== scrambledCode.code, true)
check('decoding across the reorder is flagged for review', crossed.optionsChanged, true)
check('and the flag comes with a warning', crossed.warnings.some((w) => /changed/.test(w)), true)
check('the same catalogue still round-trips without a flag', sortedDecoded.optionsChanged, false)

const xlLine = { productId: 'p900', qty: 1, specs: { Colour: 'Black', Size: 'XXL' } }
const xlDecoded = decodeCode(generateCodeFromLines('luna', [xlLine]).code)
check('the largest size decodes too', xlDecoded.items[0].specs, { Colour: 'Black', Size: 'XXL' })

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
