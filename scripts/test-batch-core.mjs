/**
 * Batch script self-check
 *   node scripts/test-batch-core.mjs
 *
 * `batch:delete` runs against a live catalogue, so what it decides has to be
 * provable without one. The suites that matter:
 *
 *   [2] parseSkuList   a list is 货号 only — never "the first column, whatever
 *                      that is", and duplicates collapse instead of deleting
 *                      twice
 *   [3] planDeletion   nothing is matched by guesswork; a typo lands in
 *                      `missing`; an ASIN row without a product is still
 *                      cleaned up
 *   [4] verifyDeletion the red line: survivors keep their ids. A renumber is
 *                      the one failure that would wreck every stored code
 */

import { skuKey, parseSkuList, planDeletion, verifyDeletion } from './batch-core.mjs'

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

/* ── 1. skuKey ─────────────────────────────────────────────────────────── */
console.log('\n[1] skuKey')
check('trims and lowercases', skuKey('  P9B013 '), 'p9b013')
check('collapses inner runs', skuKey('P9B  013'), 'p9b 013')
check('nbsp becomes a space', skuKey('P9B\u00a0013'), 'p9b 013')
check('full-width space becomes a space', skuKey('P9B\u3000013'), 'p9b 013')
check('byte-order mark stripped', skuKey('\ufeffP9B013'), 'p9b013')
check('null is empty', skuKey(null), '')
check('number survives', skuKey(900123), '900123')

/* ── 2. parseSkuList ───────────────────────────────────────────────────── */
console.log('\n[2] parseSkuList')
const withHeader = parseSkuList([
  ['货号', 'ASIN'],
  ['P9B013', 'B0H6XHHZ8N'],
  ['', ''],
  ['p9b013', ''], // same 货号, different case → duplicate
  ['P9B014', 'B0H6XB49WF'],
  ['  ', '   '],
])
check('header row skipped', withHeader.skus, ['P9B013', 'P9B014'])
check('header detected', withHeader.headerSkipped, true)
check('duplicates collapsed', withHeader.duplicates, 1)
check('blank rows counted', withHeader.blanks, 2)

const noHeader = parseSkuList([['P9B001'], ['P9B002']])
check('headerless list keeps the first row', noHeader.skus, ['P9B001', 'P9B002'])
check('headerless list reports no header', noHeader.headerSkipped, false)

const textFile = parseSkuList([['P9B001'], [], ['P9B002'], ['P9B003']])
check('txt grid works the same', textFile.skus, ['P9B001', 'P9B002', 'P9B003'])
check('empty txt line counted as blank', textFile.blanks, 1)

check('empty grid', parseSkuList([]), { skus: [], duplicates: 0, blanks: 0, headerSkipped: false })
check('non-array input is safe', parseSkuList(null).skus, [])

/* ── 3. planDeletion ───────────────────────────────────────────────────── */
console.log('\n[3] planDeletion')
const products = [
  { id: 'p001', sku: 'P9B001', name: 'Linen shirt' },
  { id: 'p002', sku: 'P9B002', name: 'Wide trousers' },
  { id: 'p003', sku: 'P9B003', name: 'Knit vest' },
]
const asinRows = [
  { sku: 'P9B001', variants: { 'Black|S': 'B0AAAAAAAA', 'Black|M': 'B0BBBBBBBB' } },
  { sku: 'P9B002', variants: { 'Oat|S': 'B0CCCCCCCC' } },
  { sku: 'P9B099', variants: { 'Red|S': 'B0DDDDDDDD' } }, // orphan: no product
]

const plan = planDeletion({ products, asinRows, skus: ['p9b001', 'P9B002', 'P9B003', 'P9B404'] })
check('matched ids in list order', plan.ids, ['p001', 'p002', 'p003'])
check('matched keeps the stored spelling', plan.matched.map((r) => r.sku), ['P9B001', 'P9B002', 'P9B003'])
check('case-insensitive input matches', plan.matched[0].id, 'p001')
check('unknown 货号 reported, not guessed', plan.missing, ['P9B404'])
check('delete list uses the stored spelling', plan.asinsToDelete, ['P9B001', 'P9B002'])
check('variant keys counted', plan.variantKeys, 3)

const orphan = planDeletion({ products, asinRows, skus: ['P9B099'] })
check('orphan ASIN row is still cleaned up', orphan.asinsToDelete, ['P9B099'])
check('orphan is not a product delete', orphan.ids, [])
check('orphan is reported separately', orphan.asinsOnly, ['P9B099'])
check('orphan is not "missing"', orphan.missing, [])

const typo = planDeletion({ products, asinRows, skus: ['P9B01'] })
check('a typo matches nothing', typo.ids, [])
check('a typo is reported', typo.missing, ['P9B01'])

const empty = planDeletion({ products, asinRows, skus: [] })
check('empty list plans nothing', empty.ids, [])
check('empty list deletes no ASINs', empty.asinsToDelete, [])

const byName = planDeletion({ products, asinRows, skus: ['Linen shirt'] })
check('names are never matched', byName.ids, [])

const noProduct = planDeletion({ products: [], asinRows: [], skus: ['P9B001'] })
check('unknown catalogue is safe', noProduct.missing, ['P9B001'])

/* ── 4. verifyDeletion ─────────────────────────────────────────────────── */
console.log('\n[4] verifyDeletion')
const before = products.map((p) => ({ id: p.id, sku: p.sku }))
const afterOk = [
  { id: 'p001', sku: 'P9B001' },
  { id: 'p003', sku: 'P9B003' },
]
const okVerdict = verifyDeletion({ before, after: afterOk, deletedSkus: ['P9B002'] })
check('clean delete passes', okVerdict.ok, true)
check('survivors counted', okVerdict.survivors, 2)
check('nothing renumbered', okVerdict.renumbered, [])

const stillThere = verifyDeletion({ before, after: products, deletedSkus: ['P9B002'] })
check('survivor that should be gone is caught', stillThere.stillThere, ['P9B002'])
check('that verdict fails', stillThere.ok, false)

const vanished = verifyDeletion({
  before,
  after: [{ id: 'p001', sku: 'P9B001' }],
  deletedSkus: ['P9B003'],
})
check('an unrequested disappearance is caught', vanished.vanished, ['P9B002'])
check('that verdict fails too', vanished.ok, false)

/* The failure this whole script exists to prevent: ids shifted by a renumber */
const renumbered = verifyDeletion({
  before,
  after: [
    { id: 'p001', sku: 'P9B001' },
    { id: 'p002', sku: 'P9B003' },
  ],
  deletedSkus: ['P9B002'],
})
check('renumbering is caught', renumbered.renumbered, ['P9B003: p003 → p002'])
check('renumbering fails the verdict', renumbered.ok, false)

const emptyVerdict = verifyDeletion({ before: [], after: [], deletedSkus: [] })
check('empty catalogue passes', emptyVerdict.ok, true)
check('empty catalogue has no survivors', emptyVerdict.survivors, 0)

/* ── summary ───────────────────────────────────────────────────────────── */
console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed) {
  console.log(`Failed ${failed}`)
  process.exit(1)
}
