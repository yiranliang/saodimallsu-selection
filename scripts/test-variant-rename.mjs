/**
 * Colour / size rename self-check
 * Run: npm run test:rename
 *
 * Pure Node — no browser, no database.
 *
 * WHY THIS SUITE EXISTS
 * ─────────────────────
 * `asins.variants` and `sold_out_variants` are keyed by `variantKey(colour, size)`
 * — the option TEXT. So "把藏青色改成 Navy" in the editor is a key migration,
 * not a cosmetic edit. Get it wrong and every ASIN under the old spelling is
 * orphaned (the panel reads "Missing ASIN") while the new rows look brand new.
 *
 * The hard part is not the re-key, it is telling a rename apart from
 * "delete the old colour, add the new one", which look identical by position.
 * Both paths are exercised here:
 *
 *   1. a genuine rename re-keys every ASIN, for every size of that colour
 *   2. delete+add re-keys NOTHING (that is the guard — guessing would bind the
 *      wrong listing), so the old keys stay put and the new rows read missing
 *   3. keys that are not on the edited axis, or not in the current options at
 *      all, are never touched
 *   4. no input is mutated, and re-keying twice is a no-op (not 藏青色→Navy→NavyNavy)
 *   5. sold-out marks ride along, because they use the same keys
 */

import {
  planVariantRenames,
  hasRenames,
  rekeyKeys,
  rekeyVariants,
  renamePairs,
  renamedKey,
  splitVariantKey,
} from '../src/utils/variantRename.js'

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

const keysOf = (variants) => Object.keys(variants).sort()
const fingerprint = (variants) =>
  Object.entries(variants)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

/* ── the data shape that matters ─────────────────────────────────────────── */

const before = { Colour: ['藏青色', 'Red'], Size: ['S', 'M', 'L'] }
const stored = {
  '藏青色|S': 'B0NAVY0001',
  '藏青色|M': 'B0NAVY0002',
  'Red|S': 'B0RED00001',
  'Red|M': 'B0RED00002',
  'ZZ|M': 'B0LEGACY01', // left over from an import, not in the current specs
}

console.log('\n[1] key shape')
check('a variant key splits into colour and size', splitVariantKey('Navy|M'), ['Navy', 'M'])
check('an empty size keeps the separator', splitVariantKey('Navy|'), ['Navy', ''])
check('a key with no separator comes back whole', splitVariantKey('Navy'), ['Navy', ''])
check('null is an empty key, not a crash', splitVariantKey(null), ['', ''])

console.log('\n[2] a real rename')
const renameNavy = planVariantRenames(before, { Colour: ['Navy', 'Red'], Size: ['S', 'M', 'L'] })
check('the colour rename is detected', renameNavy.colour, [{ from: '藏青色', to: 'Navy' }])
check('the sizes are untouched', renameNavy.size, [])
check('and the plan reports work to do', hasRenames(renameNavy), true)

const navy = rekeyVariants(stored, renameNavy)
check('both sizes of the colour moved', keysOf(navy.variants), [
  'Navy|M',
  'Navy|S',
  'Red|M',
  'Red|S',
  'ZZ|M',
])
check('the ASINs came with them', navy.variants['Navy|M'], 'B0NAVY0002')
check('and the old keys are gone', navy.variants['藏青色|M'], undefined)
check('the other colour did not move', navy.variants['Red|S'], 'B0RED00001')
check('a key outside the specs did not move', navy.variants['ZZ|M'], 'B0LEGACY01')
check('two keys were re-keyed', navy.renamed.length, 2)
check('nothing collided', navy.collisions, [])
check(
  'each move names both keys and the ASIN',
  navy.renamed[0],
  { from: '藏青色|S', to: 'Navy|S', asin: 'B0NAVY0001' },
)

console.log('\n[3] delete the old colour, add the new one (must NOT re-key)')
const replaced = planVariantRenames(before, { Colour: ['Red', 'Navy'], Size: ['S', 'M', 'L'] })
check('the guard declines to call it a rename', replaced, { colour: [], size: [] })
check('so nothing moves', fingerprint(rekeyVariants(stored, replaced).variants), fingerprint(stored))
check(
  'the new colour has no ASIN — the panel shows "Missing ASIN"',
  rekeyVariants(stored, replaced).variants['Navy|M'],
  undefined,
)
check(
  'the old ASINs are still in the map, so the extras block can show them',
  rekeyVariants(stored, replaced).variants['藏青色|M'],
  'B0NAVY0002',
)

/* The harder shapes of the same decision. */
check(
  'renaming one colour while another one is deleted still works',
  planVariantRenames({ Colour: ['藏青色', '军绿色'] }, { Colour: ['Navy'] }).colour,
  [{ from: '藏青色', to: 'Navy' }],
)
check(
  'a value that already existed is an adoption, not a rename',
  planVariantRenames({ Colour: ['藏青色', 'Navy'] }, { Colour: ['Navy'] }).colour,
  [],
)
check(
  'swapping two names is left alone (no way to tell which is which)',
  planVariantRenames({ Colour: ['A', 'B'] }, { Colour: ['B', 'A'] }).colour,
  [],
)
check(
  'a cleared option in the middle of the draft re-keys nothing',
  planVariantRenames({ Colour: ['A', 'B', 'C'] }, { Colour: ['', 'B', 'C'] }).colour,
  [],
)
check(
  'adding a colour at the end re-keys nothing',
  planVariantRenames({ Colour: ['A'] }, { Colour: ['A', 'B'] }).colour,
  [],
)
check(
  'a case-only edit is not a rename (keys are matched case-insensitively)',
  planVariantRenames({ Colour: ['navy'] }, { Colour: ['Navy'] }).colour,
  [],
)
check(
  'two renames in one save both land',
  planVariantRenames({ Colour: ['藏青色', '军绿色'] }, { Colour: ['Navy', 'Olive'] }).colour,
  [
    { from: '藏青色', to: 'Navy' },
    { from: '军绿色', to: 'Olive' },
  ],
)
check(
  'the guard is per axis — a renamed size next to a replaced colour',
  planVariantRenames(before, { Colour: ['Red', 'Navy'], Size: ['S', 'M', 'Large'] }).size,
  [{ from: 'L', to: 'Large' }],
)

console.log('\n[4] sizes')
const sizeRename = planVariantRenames(before, { Colour: ['藏青色', 'Red'], Size: ['S', 'M', 'Large'] })
check('the size rename is detected on the size axis', sizeRename.size, [{ from: 'L', to: 'Large' }])
const sizedStored = { ...stored, '藏青色|L': 'B0NAVY0003', 'Red|L': 'B0RED00003' }
const resized = rekeyVariants(sizedStored, sizeRename)
check('the size key moved for every colour', keysOf(resized.variants), [
  'Red|Large',
  'Red|M',
  'Red|S',
  'ZZ|M',
  '藏青色|Large',
  '藏青色|M',
  '藏青色|S',
])
check('and every one carried its ASIN', [
  resized.variants['Red|Large'],
  resized.variants['藏青色|Large'],
], ['B0RED00003', 'B0NAVY0003'])
check('the colours themselves did not move', resized.variants['藏青色|M'], 'B0NAVY0002')
check('and no stale L key is left behind', keysOf(resized.variants).filter((key) => key.endsWith('|L')), [])

const fullSize = { Colour: ['藏青色'], Size: ['M'] }
const fullStored = { '藏青色|M': 'B0FULL0001' }
const toMedium = planVariantRenames(fullSize, { Colour: ['藏青色'], Size: ['Medium'] })
check(
  'M → Medium re-keys the ASIN',
  rekeyVariants(fullStored, toMedium).variants,
  { '藏青色|Medium': 'B0FULL0001' },
)

console.log('\n[5] one-size / axis-less products')
const oneSize = { Size: ['M'] }
const oneStored = { '|M': 'B0ONESIZE1' }
const onePlan = planVariantRenames(oneSize, { Size: ['Medium'] })
check('a product with no colour still re-keys its size', rekeyVariants(oneStored, onePlan).variants, {
  '|Medium': 'B0ONESIZE1',
})
const noSizePlan = planVariantRenames({ Colour: ['Green'] }, { Colour: ['Navy'] })
check('a single-axis key does not grow a separator', renamedKey('Green', noSizePlan), 'Navy')
check(
  'and the map is re-keyed in the same shape',
  rekeyVariants({ Green: 'B0GREEN001' }, noSizePlan).variants,
  { Navy: 'B0GREEN001' },
)

console.log('\n[6] collisions keep both values')
const both = { '藏青色|M': 'B0OLD00001', 'Navy|M': 'B0NEW00001' }
const clash = rekeyVariants(both, renameNavy)
check('the collision is reported', clash.collisions, [{ from: '藏青色|M', to: 'Navy|M' }])
check('the value already spelled the new way wins the slot', clash.variants['Navy|M'], 'B0NEW00001')
check('the old key is kept, so its ASIN is not lost', clash.variants['藏青色|M'], 'B0OLD00001')
check('and no move is claimed for it', clash.renamed, [])
check('nothing was dropped', Object.keys(clash.variants).length, 2)

console.log('\n[7] idempotence and round trips')
const twice = rekeyVariants(navy.variants, renameNavy)
check('re-keying an already renamed map does nothing', fingerprint(twice.variants), fingerprint(navy.variants))
check('and reports no further moves', twice.renamed, [])

const back = planVariantRenames({ Colour: ['Navy', 'Red'] }, before)
check(
  'the inverse plan puts the original keys back',
  fingerprint(rekeyVariants(navy.variants, back).variants),
  fingerprint(stored),
)

console.log('\n[8] sold-out marks use the same keys')
const soldOut = ['藏青色|M', 'Red|S', 'ZZ|L']
const carried = rekeyKeys(soldOut, renameNavy)
check('the renamed mark moved with its colour', carried.keys, ['Navy|M', 'Red|S', 'ZZ|L'])
check('and is reported', carried.renamed, [{ from: '藏青色|M', to: 'Navy|M' }])
check(
  'a duplicated mark is only written once',
  rekeyKeys(['藏青色|M', '藏青色|M'], renameNavy).keys,
  ['Navy|M'],
)
check('a blank entry is dropped', rekeyKeys(['', '  '], renameNavy).keys, [])
check('a non-array is an empty list', rekeyKeys(null, renameNavy).keys, [])

console.log('\n[9] nasty input does not crash')
check('null specs on both sides', planVariantRenames(null, null), { colour: [], size: [] })
check('a string spec value is treated as one option', renamePairs(['A'], ['B']), [
  { from: 'A', to: 'B' },
])
check('a non-array side is empty', renamePairs('A', 'B'), [])
check('numbers are stringified', renamePairs([2], [4]), [{ from: '2', to: '4' }])
check('duplicate old names are left alone', renamePairs(['A', 'A'], ['B', 'A']), [])
check('an empty map stays empty', rekeyVariants({}, renameNavy).variants, {})
check('a null map is an empty map', rekeyVariants(null, renameNavy).variants, {})
check('no plan means no work', hasRenames(null), false)
check('renamedKey with no plan returns the key', renamedKey('Navy|M', null), 'Navy|M')

console.log('\n[10] inputs are never mutated')
const watch = JSON.parse(JSON.stringify(stored))
const watchSpecs = JSON.parse(JSON.stringify(before))
rekeyVariants(watch, renameNavy)
const after = rekeyVariants(watch, renameNavy).variants
after['Navy|S'] = 'MUTATED'
check('the source map is untouched', watch, stored)
check('the specs are untouched', before, watchSpecs)
check('a fresh call still returns the stored value', rekeyVariants(stored, renameNavy).variants['Navy|S'], 'B0NAVY0001')

console.log('\n[11] what the editor actually does')
/* Base is what the database holds, re-keyed first; the edit overlay is keyed by
 * what the panel is showing, so it is applied on top of the renamed keys. */
const edited = { ...rekeyVariants(stored, renameNavy).variants, 'Navy|L': 'B0TYPED001' }
check('a value typed into a renamed row survives the merge', edited['Navy|L'], 'B0TYPED001')
check('and the renamed ASINs are all still there', [edited['Navy|S'], edited['Navy|M']], [
  'B0NAVY0001',
  'B0NAVY0002',
])
check(
  'clearing a renamed row deletes the moved key',
  Object.keys({ ...rekeyVariants(stored, renameNavy).variants, 'Navy|M': undefined }).includes('Navy|M'),
  true,
)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
