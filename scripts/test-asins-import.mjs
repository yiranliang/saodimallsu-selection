/**
 * Incremental ASIN import self-check
 *   node scripts/test-asins-import.mjs
 *
 * Pure functions only — no network, no spreadsheet. The suites that matter here
 * are the ones that guard a destructive mistake:
 *
 *   [4] mergeSpecs    must append, never reorder. A v4 code stores option
 *                     *indexes*, so a reorder silently re-points codes already
 *                     in a creator's inbox at a different colour.
 *   [5] mergeVariants must never drop a key. "Add ASINs" must not become
 *                     "replace the ASIN map".
 *   [6] planProducts  must not touch name / category / image / hidden /
 *                     sort_order on an existing product — ops filled those in by
 *                     hand, and `--hide-new` must reach a created row only.
 */

import {
  fold,
  slug,
  readTable,
  dedupeExact,
  buildVocabulary,
  alignValue,
  alignRecords,
  resolveConflicts,
  aggregate,
  splitVariantKey,
  specsFromVariants,
  mergeSpecs,
  mergeVariants,
  planProducts,
  nearMisses,
  idNumber,
  formatId,
  editDistance,
} from './asins-import-core.mjs'

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

/* ── 1. text normalisation ─────────────────────────────────────────────── */
console.log('\n[1] Normalisation')
check('trims edges', fold('  Black  '), 'Black')
check('collapses inner runs', fold('Dark   Brown'), 'Dark Brown')
check('nbsp becomes a space', fold('Dark\u00a0Brown'), 'Dark Brown')
check('full-width space becomes a space', fold('Dark\u3000Brown'), 'Dark Brown')
check('zero-width space dropped', fold('Dark\u200bBrown'), 'Dark Brown')
check('byte-order mark stripped', fold('\ufeff货号'), '货号')
check('null → empty', fold(null), '')
check('slug folds punctuation away', slug('Blue&green'), 'bluegreen')
check('slug matches a spaced spelling', slug('Blue Green'), 'bluegreen')
check('slug folds hyphens', slug('Creamy-white'), 'creamywhite')

/* ── 2. readTable ──────────────────────────────────────────────────────── */
console.log('\n[2] readTable')
const grid = [
  ['货号', 'ASIN', '颜色', '尺寸'],
  ['P9B013', 'B0H6XHHZ8N', 'Black', 'S'],
  ['P9B013', 'B0H6XB49WF', 'Black', 'XS'],
  ['', '', '', ''],                                   // blank → dropped
  ['  ', '\u00a0', ' ', ''],                          // whitespace-only → dropped
  ['P9B013', 'b0h6xkrr81', ' Black ', 'XL '],         // case + padding → fixed
  ['P9B013', 'TOO-SHORT', 'Black', 'M'],              // bad ASIN → rejected
  ['P9B013', 'B0H6XKRR81', 'Black', ''],              // missing size → rejected
  ['', 'B0H6XKRR81', 'Black', 'M'],                   // missing sku → rejected
]
const read = readTable(grid)
check('header recognised', read.headerLooksRight, true)
check('blank rows counted', read.blankRows, 2)
check('kept rows', read.records.length, 3)
check('rejected rows', read.rejected.length, 3)
check('first record', read.records[0], {
  row: 2, sku: 'P9B013', asin: 'B0H6XHHZ8N', colour: 'Black', size: 'S', asinCased: false,
})
check('padding trimmed off colour and size', [read.records[2].colour, read.records[2].size], ['Black', 'XL'])
check('lowercase ASIN uppercased', read.records[2].asin, 'B0H6XKRR81')
check('lowercase ASIN flagged', read.records[2].asinCased, true)
check('bad ASIN reason', read.rejected[0].reason.startsWith('ASIN 格式不对'), true)
check('missing size reason', read.rejected[1].reason, '空字段：尺寸')
check('missing sku reason', read.rejected[2].reason, '空字段：货号')

const englishHeader = readTable([['SKU', 'ASIN', 'Color', 'Size'], ['P1', 'B0H6XKRR81', 'Black', 'S']])
check('english header recognised', englishHeader.headerLooksRight, true)

const noHeader = readTable([['x', 'y', 'z', 'w'], ['P1', 'B0H6XKRR81', 'Black', 'S']])
check('unrecognised header flagged', noHeader.headerLooksRight, false)
check('rows still read when header is odd', noHeader.records.length, 1)

/* Missing ASIN is rejected by default… */
const noAsin = readTable([['货号', 'ASIN', '颜色', '尺寸'], ['P9B013', '', 'Navy', 'M']])
check('empty ASIN rejected by default', noAsin.rejected.length, 1)
check('reason names ASIN', noAsin.rejected[0].reason, '空字段：ASIN')

/* …but kept (with an empty ASIN) when the batch importer asks for it. */
const allowAsin = readTable([['货号', 'ASIN', '颜色', '尺寸'], ['P9B013', '', 'Navy', 'M']], { allowMissingAsin: true })
check('empty ASIN kept when allowed', allowAsin.records.length, 1)
check('its ASIN is empty string', allowAsin.records[0].asin, '')
check('its colour and size survive', [allowAsin.records[0].colour, allowAsin.records[0].size], ['Navy', 'M'])
check('nothing rejected when allowed', allowAsin.rejected.length, 0)

/* ── 3. dedupe + vocabulary ────────────────────────────────────────────── */
console.log('\n[3] Dedupe and vocabulary')
const rec = (sku, colour, size, asin) => ({ row: 0, sku, asin, colour, size })

const dupes = dedupeExact([
  rec('P1', 'Black', 'S', 'B0AAAAAAAA'),
  rec('P1', 'Black', 'S', 'B0AAAAAAAA'),
  rec('P1', 'Black', 'M', 'B0AAAAAAAB'),
])
check('exact duplicate dropped', dupes.dropped, 1)
check('first occurrence kept', dupes.records.map((r) => r.size), ['S', 'M'])

const vocab = buildVocabulary(['Black', 'Blue Green', 'Creamy White', 'Black'])
check('vocabulary deduped', vocab.list, ['Black', 'Blue Green', 'Creamy White'])
check('exact match', alignValue('Black', vocab), { value: 'Black', how: 'exact' })
check('case drift resolved', alignValue('black', vocab), { value: 'Black', how: 'case' })
check('punctuation drift resolved', alignValue('Blue&green', vocab), { value: 'Blue Green', how: 'punctuation' })
check('hyphen drift resolved', alignValue('Creamy-white', vocab), { value: 'Creamy White', how: 'punctuation' })
check('unknown kept verbatim', alignValue('Mint', vocab), { value: 'Mint', how: 'new' })
check('blank stays blank', alignValue('   ', vocab), { value: '', how: 'empty' })

const sizeVocab = buildVocabulary(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'])
check('2XL aliased to XXL', alignValue('2XL', sizeVocab), { value: 'XXL', how: 'alias' })
check('4XL stays new', alignValue('4XL', sizeVocab), { value: '4XL', how: 'new' })
check('alias disabled leaves it new', alignValue('2XL', sizeVocab, {}), { value: '2XL', how: 'new' })
check('alias respects catalogue spelling', alignValue('2xl', sizeVocab), { value: 'XXL', how: 'alias' })

const aligned = alignRecords(
  [rec('P1', 'Blue&green', '2XL', 'B0AAAAAAAA'), rec('P1', 'Blue&green', '2XL', 'B0AAAAAAAB')],
  { colours: vocab, sizes: sizeVocab },
)
check('records rewritten', aligned.records.map((r) => `${r.colour}|${r.size}`), ['Blue Green|XXL', 'Blue Green|XXL'])
check('changes collapsed to two lines', aligned.changes.length, 2)
check('colour change counted twice', aligned.changes.find((c) => c.field === '颜色').count, 2)

/* ── 4. mergeSpecs — append only ───────────────────────────────────────── */
console.log('\n[4] mergeSpecs (append only)')
const current = { Colour: ['Black', 'White'], Size: ['S', 'M'] }
const merged = mergeSpecs(current, { Colour: ['White', 'Navy Blue', 'Navy Blue'], Size: ['S', 'XL'] })

check('existing colours keep their order', merged.specs.Colour, ['Black', 'White', 'Navy Blue'])
check('existing sizes keep their order', merged.specs.Size, ['S', 'M', 'XL'])
check('duplicate incoming value ignored', merged.added.Colour, ['Navy Blue'])
check('only genuinely new sizes reported', merged.added.Size, ['XL'])
check('spec key order preserved', Object.keys(merged.specs), ['Colour', 'Size'])
check('input not mutated', current, { Colour: ['Black', 'White'], Size: ['S', 'M'] })

/* The index invariant, stated as a test: index 0 must still be Black, index 1
 * still White. A code that decoded to White yesterday must decode to White
 * today. */
check('index 0 unchanged', merged.specs.Colour[0], 'Black')
check('index 1 unchanged', merged.specs.Colour[1], 'White')
check('new value lands at the end', merged.specs.Colour.indexOf('Navy Blue'), 2)

const caseSkip = mergeSpecs({ Colour: ['Black'] }, { Colour: ['black', 'BLACK'] })
check('case-insensitive duplicate not appended', caseSkip.specs.Colour, ['Black'])
check('nothing reported when nothing is new', caseSkip.added, {})

const noSpecs = mergeSpecs({}, { Colour: ['Black'], Size: ['S'] })
check('empty product gets both types', Object.keys(noSpecs.specs), ['Colour', 'Size'])
check('empty product keeps incoming order', noSpecs.specs.Colour, ['Black'])

const extraType = mergeSpecs({ Colour: ['Black'], Length: ['Long'] }, { Colour: ['White'] })
check('unknown existing spec type kept', Object.keys(extraType.specs), ['Colour', 'Length'])
check('unknown type not dropped', extraType.specs.Length, ['Long'])

/* The shape invariant. A code writes one character per spec type, so gaining a
 * `Size` slot would lengthen every code already issued for a one-size product. */
const oneSize = mergeSpecs({ Colour: ['Black'] }, { Colour: ['White'], Size: ['M'] })
check('one-size product does not gain a Size slot', Object.keys(oneSize.specs), ['Colour'])
check('the dropped axis is reported instead of applied', oneSize.ignored, { Size: ['M'] })

/* ── 5. mergeVariants — never delete ───────────────────────────────────── */
console.log('\n[5] mergeVariants (never delete)')
const existing = { 'Black|S': 'B0AAAAAAAA', 'White|M': 'B0AAAAAAAB' }
const merge = mergeVariants(existing, { 'Black|S': 'B0AAAAAAAA', 'Black|M': 'B0AAAAAAAC' })

check('existing key untouched', merge.merged['White|M'], 'B0AAAAAAAB')
check('same ASIN counted unchanged', merge.unchanged, 1)
check('new key counted added', merge.added, 1)
check('nothing counted updated', merge.updated, 0)
check('untouched keys counted kept', merge.kept, 1)
check('input not mutated', Object.keys(existing), ['Black|S', 'White|M'])

const overwrite = mergeVariants({ 'Black|S': 'B0AAAAAAAA' }, { 'Black|S': 'B0ZZZZZZZZ' })
check('different ASIN overwrites', overwrite.merged['Black|S'], 'B0ZZZZZZZZ')
check('overwrite counted updated', overwrite.updated, 1)
check('overwrite counted not added', overwrite.added, 0)

const empty = mergeVariants({ 'Black|S': 'B0AAAAAAAA' }, {})
check('empty incoming changes nothing', empty.merged, { 'Black|S': 'B0AAAAAAAA' })
check('empty incoming keeps everything', empty.kept, 1)
check('no key can disappear', Object.keys(empty.merged).length, 1)

/* ── 6. conflicts ──────────────────────────────────────────────────────── */
console.log('\n[6] Conflict resolution')
const clashing = [
  { row: 67, sku: 'H8B382', asin: 'B0HGLNSYZT', colour: 'Dark Brown', size: 'S' },
  { row: 2829, sku: 'H8B382', asin: 'B0F8B9VR8F', colour: 'Dark Brown', size: 'S' },
  { row: 70, sku: 'H8B382', asin: 'B0HGLKN3G2', colour: 'Burgundy', size: 'M' },
]
const first = resolveConflicts(clashing, 'first')
check('one group detected', first.conflicts.length, 1)
check('both ASINs reported', first.conflicts[0].asins, ['B0HGLNSYZT', 'B0F8B9VR8F'])
check('both row numbers reported', first.conflicts[0].rows, [67, 2829])
check('first policy keeps row 67', first.records.find((r) => r.colour === 'Dark Brown').asin, 'B0HGLNSYZT')
check('non-conflicting row survives', first.records.length, 2)

const last = resolveConflicts(clashing, 'last')
check('last policy keeps row 2829', last.records.find((r) => r.colour === 'Dark Brown').asin, 'B0F8B9VR8F')

const skip = resolveConflicts(clashing, 'skip')
check('skip drops both sides', skip.records.length, 1)
check('skip still reports the conflict', skip.conflicts.length, 1)

const clean = resolveConflicts([rec('P1', 'Black', 'S', 'B0AAAAAAAA'), rec('P1', 'Black', 'M', 'B0AAAAAAAB')])
check('no false conflict on different sizes', clean.conflicts.length, 0)
check('different colours are not a conflict', resolveConflicts([rec('P1', 'Black', 'S', 'B0AAAAAAAA'), rec('P1', 'White', 'S', 'B0AAAAAAAB')]).conflicts.length, 0)

/* ── 7. aggregation ────────────────────────────────────────────────────── */
console.log('\n[7] Aggregation')
const aggregated = aggregate([
  rec('P1', 'Black', 'S', 'B0AAAAAAAA'),
  rec('P1', 'White', 'M', 'B0AAAAAAAB'),
  rec('P2', 'Red', 'L', 'B0AAAAAAAC'),
])
check('two skus', Object.keys(aggregated), ['P1', 'P2'])
check('variant map shape', aggregated.P1, { 'Black|S': 'B0AAAAAAAA', 'White|M': 'B0AAAAAAAB' })
check('second sku separate', aggregated.P2, { 'Red|L': 'B0AAAAAAAC' })
check('split on last pipe', splitVariantKey('White|Blue|M'), { colour: 'White|Blue', size: 'M' })
check('no pipe → whole thing is the colour', splitVariantKey('Black'), { colour: 'Black', size: '' })
check('specs built in order', specsFromVariants(['Black|S', 'White|M', 'Black|L']), {
  Colour: ['Black', 'White'],
  Size: ['S', 'M', 'L'],
})

/* ── 8. product planning ───────────────────────────────────────────────── */
console.log('\n[8] Product planning')
const db = [
  { id: 'p001', sku: 'P9B013', name: 'Sports Bra', category: 'Tops', image: 'a.jpg', specs: { Colour: ['Black'], Size: ['S'] }, sort_order: 0 },
  { id: 'p139', sku: 'P5B035', name: 'Leggings', category: 'Bottoms', image: 'b.jpg', specs: { Colour: ['Navy Blue'], Size: ['M'] }, sort_order: 138 },
]
const planned = planProducts(db, {
  P9B013: { 'Black|S': 'B0AAAAAAAA', 'White|L': 'B0AAAAAAAB' },
  NEW123: { 'Red|XL': 'B0AAAAAAAC' },
})

check('one new product', planned.create.length, 1)
check('id continues the series', planned.create[0].id, 'p140')
check('name starts as the sku', planned.create[0].name, 'NEW123')
check('category is Uncategorised', planned.create[0].category, 'Uncategorised')
check('sort_order goes last', planned.create[0].sort_order, 139)
check('specs built from the variants', planned.create[0].specs, { Colour: ['Red'], Size: ['XL'] })
check('next id handed out', planned.nextId, 141)

check('one existing product updated', planned.update.length, 1)
const updated = planned.update[0]
check('matched on sku, not name', updated.product.id, 'p001')
check('new colour appended', updated.specs.Colour, ['Black', 'White'])
check('new size appended', updated.specs.Size, ['S', 'L'])
check('existing name never enters the payload', 'name' in updated, false)
check('existing image never enters the payload', 'image' in updated, false)

const untouched = planProducts(db, { P9B013: { 'Black|S': 'B0AAAAAAAA' } })
check('no new product when every sku exists', untouched.create.length, 0)
check('no spec change when nothing is new', Object.keys(untouched.update[0].added).length, 0)

/* --hide-new: the flag must reach a created row and nothing else.
 * The dangerous failure is not "new row is visible", it is "old row got hidden",
 * so both directions are asserted. */
const hidable = planProducts(
  db,
  { P9B013: { 'Black|S': 'B0AAAAAAAA', 'White|L': 'B0AAAAAAAB' }, NEW123: { 'Red|XL': 'B0AAAAAAAC' } },
  { hideNew: true },
)
check('a new product is visible unless asked otherwise', planned.create[0].hidden, false)
check('--hide-new hides the new row', hidable.create[0].hidden, true)
check('--hide-new leaves id and position alone', [hidable.create[0].id, hidable.create[0].sort_order], ['p140', 139])
check('--hide-new does not hide a 货号 that already exists', hidable.update.length, 1)
/* The update branch carries specs and nothing else — visibility has no way in. */
const hiddenExisting = planProducts(
  [{ ...db[0], hidden: true }],
  { P9B013: { 'Black|S': 'B0AAAAAAAA' } },
  { hideNew: false },
)
check('an existing hidden product stays hidden in the plan', hiddenExisting.update[0].product.hidden, true)
check('visibility is not part of an existing product update', 'hidden' in hiddenExisting.update[0], false)
check('--hide-new still merges specs normally', hidable.update[0].specs.Colour, ['Black', 'White'])

check('idNumber parses', idNumber('p007'), 7)
check('idNumber rejects junk', idNumber('x1'), 0)
check('formatId pads', formatId(7), 'p007')
check('formatId leaves big numbers alone', formatId(1234), 'p1234')

/* ── 9. near misses ────────────────────────────────────────────────────── */
console.log('\n[9] Near-miss suggestions')
check('editDistance exact', editDistance('dustpink', 'dustypink'), 1)
check('editDistance unrelated', editDistance('mint', 'pink', 1), 2)

const colourVocab = buildVocabulary(['Dusty Pink', 'Grey', 'Light Grey', 'Black', 'Pink'])
const misses = nearMisses(['Dust Pink'], colourVocab)
check('typo suggested', misses.map((m) => m.candidate), ['Dusty Pink'])
check('suggestion is advisory only', misses[0].distance, 1)
check('short words are not guessed at', nearMisses(['Mint'], colourVocab), [])
check('two edits away is not suggested', nearMisses(['Light Green'], colourVocab), [])
check('exact value is not a miss', nearMisses(['Grey'], colourVocab), [])

/* ── summary ───────────────────────────────────────────────────────────── */
console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed) {
  console.log(`Failed ${failed}`)
  process.exit(1)
}
