/**
 * Web batch import self-check
 *   node scripts/test-bulk-import.mjs
 *
 * Pure Node — no browser, no network, no Supabase. `executeImport` takes its
 * writers as arguments, so the whole flow runs against fakes and the payloads
 * themselves are what gets asserted.
 *
 * The suites that matter are the ones guarding a destructive mistake:
 *   [5] planImport    must append to specs, never reorder or drop, and must
 *                     never put name / image / category / hidden into a payload
 *   [6] executeImport must write the specs column ONLY, must hand the ASIN
 *                     writer the merged map (so an existing key survives), and
 *                     must refuse to run at all without an admin
 */

import {
  parseSheetGrid,
  alignSkus,
  preferFilledAsin,
  pickCsvText,
  planImport,
  planIsEmpty,
  executeImport,
} from '../src/utils/bulkImport.js'

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

/* ══════════════════════════════════════════════════════════════════════════
 * fixtures
 * ══════════════════════════════════════════════════════════════════════════ */

/** A catalogue as the admin page sees it. */
const DB_PRODUCTS = [
  {
    id: 'p001',
    sku: 'G7F906',
    name: 'Oatmeal Knit Set',
    category: 'Sets',
    image: 'https://cdn.example.com/oatmeal.jpg',
    specs: { Colour: ['Black', 'White'], Size: ['M', 'L'] },
    variantImages: { Black: 'https://cdn.example.com/oatmeal-black.jpg' },
    hidden: false,
    tag: 'NEW',
  },
  {
    id: 'p002',
    sku: 'AMZ-1003',
    name: 'Linen Shirt',
    category: 'Tops',
    image: '',
    specs: { Colour: ['Sand'], Size: ['S'] },
    hidden: true,
  },
]

/** The ASIN map as `asins.variants` holds it. */
const DB_ASINS = {
  G7F906: { 'Black|M': 'B000000001', 'White|L': 'B000000002' },
  'AMZ-1003': { 'Sand|S': 'B00000000A' },
}

const HEADER = ['货号', 'ASIN', '颜色', '尺寸']
const grid = (...rows) => [HEADER, ...rows]

/* ══════════════════════════════════════════════════════════════════════════
 * 1. parseSheetGrid — a missing ASIN is information, not a reason to drop
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n1. parseSheetGrid')

{
  const parsed = parseSheetGrid(
    grid(
      ['G7F906', 'B00000000X', 'Black', 'M'], // fine
      ['G7F906', '', 'Blue', 'L'], // no ASIN — must survive
      ['', 'B00000000Y', 'Black', 'M'], // no 货号 — fatal
      ['G7F906', 'B00000000Z', '', 'M'], // no 颜色 — fatal
      ['G7F906', 'B00000000W', 'Black', ''], // no 尺寸 — fatal
      ['', '', '', ''], // blank — counted, not an error
    ),
  )

  check('keeps the row that only lacks an ASIN', parsed.records.length, 2)
  check('rejects exactly the rows that cannot become a variant', parsed.rejected.length, 3)
  check('rejected rows carry their row number', parsed.rejected.map((r) => r.row), [4, 5, 6])
  check(
    'rejection says which field was missing',
    parsed.rejected.map((r) => r.reason),
    ['空字段：货号', '空字段：颜色', '空字段：尺寸'],
  )
  check('blank rows are counted separately', parsed.blankRows, 1)
  check('the ASIN-less row keeps its colour and size', parsed.records[1].colour + parsed.records[1].size, 'BlueL')
  check('its asin is empty', parsed.records[1].asin, '')
  check('a Chinese header is recognised', parsed.headerLooksRight, true)
}

{
  const parsed = parseSheetGrid([
    ['货号', 'ASIN', '颜色', '尺寸'],
    ['AMZ-2001', 'b00000000b', 'Camel', 'One Size'], // lowercase asin
    ['AMZ-2001', 'B123', 'Camel', 'One Size'], // too short
    ['AMZ-2001', 'B0000000-1', 'Camel', 'One Size'], // illegal character
  ])

  check('ASINs are uppercased on the way in', parsed.records[0].asin, 'B00000000B')
  check('a malformed ASIN is kept as a record', parsed.records.length, 3)
  check('but flagged invalid', parsed.records.map((r) => r.asinValid), [true, false, false])
  check('and its value is not stored', parsed.records.slice(1).map((r) => r.asin), ['', ''])
  check('a malformed ASIN is not a rejection', parsed.rejected.length, 0)
}

{
  const parsed = parseSheetGrid([
    ['name', 'price', 'stock', 'note'],
    ['A', '1', 'Black', 'M'],
  ])
  check('a foreign header is reported, not guessed at', parsed.headerLooksRight, false)
  check('and rows are still read by column order', parsed.records[0].sku, 'A')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. alignSkus — "g7f906" in a sheet means the product called G7F906
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n2. alignSkus')

{
  const { records, fixes } = alignSkus(
    [
      { row: 2, sku: 'g7f906', colour: 'Black', size: 'M' },
      { row: 3, sku: ' amz-1003 ', colour: 'Sand', size: 'S' },
      { row: 4, sku: 'NEW-01', colour: 'Camel', size: 'M' },
    ],
    DB_PRODUCTS,
  )

  check('lowercase 货号 is rewritten onto the database spelling', records[0].sku, 'G7F906')
  check('surrounding whitespace is folded too', records[1].sku, 'AMZ-1003')
  check('an unknown 货号 is left exactly as typed', records[2].sku, 'NEW-01')
  check('the rewrite is reported for the preview', fixes, [
    { row: 2, from: 'g7f906', to: 'G7F906' },
    { row: 3, from: 'amz-1003', to: 'AMZ-1003' },
  ])
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. preferFilledAsin — an empty cell loses to a filled one
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n3. preferFilledAsin')

{
  const { records, dropped } = preferFilledAsin([
    { row: 2, sku: 'G7F906', colour: 'Black', size: 'M', asin: '' },
    { row: 3, sku: 'G7F906', colour: 'Black', size: 'M', asin: 'B000000001' },
    { row: 4, sku: 'G7F906', colour: 'Blue', size: 'M', asin: '' },
    { row: 5, sku: 'G7F906', colour: 'Blue', size: 'M', asin: '' },
  ])

  check('the empty duplicate is dropped', records.map((r) => r.row), [3, 4, 5])
  check('and counted', dropped, 1)
  check('two rows that are both empty are both kept', records.filter((r) => !r.asin).length, 2)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. pickCsvText — Excel on Chinese Windows writes GBK
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n4. pickCsvText')

/** Node has no GBK encoder (TextDecoder only decodes), so the byte pairs are
 *  found once by decoding the whole double-byte space. ~24k decodes, 40ms. */
function gbkBytes(text) {
  const map = new Map()
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue
      const ch = new TextDecoder('gbk').decode(Uint8Array.of(lead, trail))
      if (ch.length === 1 && ch !== '\ufffd' && !map.has(ch)) map.set(ch, Uint8Array.of(lead, trail))
    }
  }
  const out = []
  for (const ch of text) {
    const pair = map.get(ch) || (ch.codePointAt(0) < 0x80 ? Uint8Array.of(ch.charCodeAt(0)) : null)
    if (!pair) throw new Error(`no GBK bytes for ${ch}`)
    out.push(...pair)
  }
  return Uint8Array.from(out)
}

const UTF8_HEADER = new TextEncoder().encode('货号,ASIN,颜色,尺寸\nG7F906,B000000001,Black,M\n')
const GBK_HEADER = gbkBytes('货号,ASIN,颜色,尺寸\nG7F906,B000000001,Black,M\n')

{
  check('UTF-8 bytes decode as UTF-8', pickCsvText(UTF8_HEADER).encoding, 'utf-8')
  check('and the header survives', pickCsvText(UTF8_HEADER).text.startsWith('货号,ASIN'), true)
  check('GBK bytes are recognised as GBK', pickCsvText(GBK_HEADER).encoding, 'gbk')
  check('with the header intact', pickCsvText(GBK_HEADER).text.startsWith('货号,ASIN'), true)
  check('an unreadable file still yields text', typeof pickCsvText(Uint8Array.of(0xff, 0xfe, 0x00)).text, 'string')
  check('and falls back to the first decoder', pickCsvText(Uint8Array.of(0xff, 0xfe, 0x00)).encoding, 'utf-8')
  check('a decoder the runtime does not have is skipped', pickCsvText(GBK_HEADER, ['utf-8', 'no-such-codec']).encoding, 'utf-8')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. planImport — append, never overwrite
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n5. planImport')

{
  const plan = planImport({
    grid: grid(
      ['NEW-01', 'B0000000N1', 'Camel', 'M'],
      ['NEW-01', 'B0000000N2', 'Camel', 'L'],
      ['NEW-01', 'B0000000N3', 'Cream', 'M'],
      ['NEW-01', '', 'Cream', 'L'], // new 货号, no ASIN on the last variant
      ['G7F906', 'B00000000X', 'Blue', 'M'], // existing — new colour
      ['G7F906', '', 'Black', 'L'], // existing — new combination, no ASIN
      ['G7F906', 'B000000001', 'Black', 'M'], // existing — ASIN unchanged
      ['AMZ-1003', '', 'Sand', 'L'], // existing — new size, no ASIN
    ),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
    hideNew: true,
  })

  const s = plan.summary
  check('one new 货号, two merged', [s.newSkus, s.mergedSkus], [1, 2])
  check('the three ASIN-less rows are counted, not dropped', s.missingAsinRows, 3)
  check('no row was rejected', s.errorRows, 0)
  check('four ASINs will be written', s.asinsToWrite, 4)
  check('three variants end up without an ASIN', plan.variantsWithoutAsin, 3)

  /* ── the create side ── */
  const created = plan.create[0]
  check('the new 货号 is created hidden', created.hidden, true)
  check('with the placeholder image', created.image, './placeholders/placeholder.svg')
  check('with the sheet spelling as its name', created.name, 'NEW-01')
  check('in the default category', created.category, 'Uncategorised')
  check('and specs built from the sheet', created.specs, {
    Colour: ['Camel', 'Cream'],
    Size: ['M', 'L'],
  })

  /* ── the update side ── */
  const g7 = plan.update.find((u) => u.product.sku === 'G7F906')
  check('the merged product keeps its own option order', g7.specs, {
    Colour: ['Black', 'White', 'Blue'],
    Size: ['M', 'L'],
  })
  check('and reports what it appended', g7.added, { Colour: ['Blue'] })
  check('the variant with no ASIN still exists', g7.specs.Size.includes('L'), true)

  const amz = plan.update.find((u) => u.product.sku === 'AMZ-1003')
  check('a new size is appended to the existing one', amz.specs, { Colour: ['Sand'], Size: ['S', 'L'] })

  /* ── the ASIN side ── */
  const g7Asins = plan.asinWrites.find((w) => w.sku === 'G7F906')
  check('an existing key the sheet never mentions is preserved', g7Asins.variants['White|L'], 'B000000002')
  check('a key the sheet repeats with the same value is unchanged', g7Asins.variants['Black|M'], 'B000000001')
  check('the new combination gets its ASIN', g7Asins.variants['Blue|M'], 'B00000000X')
  check('the combination without an ASIN is not written as an empty key', g7Asins.variants['Black|L'], undefined)
  check('mergeVariants counts what it kept', g7Asins.kept, 1)

  const newAsins = plan.asinWrites.find((w) => w.sku === 'NEW-01')
  check('a new 货号 writes only the ASINs it has', Object.keys(newAsins.variants).length, 3)

  /* ── the preview detail ── */
  const detail = plan.details.find((d) => d.sku === 'G7F906')
  check('the detail row knows it is a merge', detail.kind, 'merge')
  check('and how many colours it adds', detail.newColours, 1)
  check('the new 货号 is marked as such', plan.details.find((d) => d.sku === 'NEW-01').kind, 'new')
}

{
  /* hideNew is only ever read while building a new row. */
  const visible = planImport({
    grid: grid(['NEW-02', 'B0000000N9', 'Camel', 'M']),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
    hideNew: false,
  })
  check('hideNew=false creates a visible product', visible.create[0].hidden, false)

  const stillHidden = planImport({
    grid: grid(['G7F906', 'B00000000X', 'Blue', 'M']),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
    hideNew: true,
  })
  check(
    'an existing product is never hidden by the import',
    stillHidden.update.some((u) => u.specs.hidden !== undefined),
    false,
  )
  check('and its specs payload has no hidden key', Object.keys(stillHidden.update[0].specs).sort(), [
    'Colour',
    'Size',
  ])
}

{
  /* A product whose spec type is spelled differently keeps its own shape. */
  const plan = planImport({
    grid: grid(['G7F906', 'B00000000X', 'Blue', 'M']),
    dbProducts: [{ id: 'p009', sku: 'G7F906', name: 'x', specs: { Color: ['Black'] } }],
    existingAsins: {},
    hideNew: true,
  })
  check(
    'a spec type the product does not have is not introduced',
    plan.update[0].specs,
    { Color: ['Black'] },
  )
  check('it is reported instead', plan.update[0].ignored, { Colour: ['Blue'], Size: ['M'] })
}

{
  /* Conflicts and duplicates. */
  const plan = planImport({
    grid: grid(
      ['G7F906', 'B000000001', 'Black', 'M'],
      ['G7F906', 'B000000009', 'Black', 'M'], // same variant, different ASIN
      ['G7F906', 'B000000009', 'Black', 'M'], // exact duplicate row
      ['g7f906', 'B00000000X', 'Blue', 'M'], // lowercase 货号
    ),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
    hideNew: true,
  })
  check('the exact duplicate is counted', plan.droppedDuplicates, 1)
  check('the conflicting ASIN is reported', plan.conflicts.length, 1)
  check('with both values and both rows', plan.conflicts[0].asins, ['B000000001', 'B000000009'])
  check('the first one wins', plan.asinWrites[0].variants['Black|M'], 'B000000001')
  check('the lowercase 货号 merged into the same product', plan.summary.mergedSkus, 1)
  check('the spelling fix is reported', plan.spellingFixes.length, 1)
}

{
  /* Nothing to do at all. */
  const empty = planImport({ grid: [HEADER], dbProducts: DB_PRODUCTS, existingAsins: DB_ASINS })
  check('a header-only sheet has nothing to write', planIsEmpty(empty), true)

  const allBad = planImport({
    grid: grid(...['', '', '', ''].map((_, i) => [`${i}`, '', '', ''])),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
  })
  check('a sheet where every row is rejected has nothing to write', planIsEmpty(allBad), true)

  const real = planImport({
    grid: grid(['NEW-01', 'B0000000N1', 'Camel', 'M']),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
  })
  check('a sheet with one good row is not empty', planIsEmpty(real), false)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. executeImport — what actually reaches the writers
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n6. executeImport')

/** A recorder that stands in for the three store writers. */
function recorder({ failSkus = [] } = {}) {
  const calls = { order: [], created: [], specWrites: [], asinWrites: [] }
  return {
    calls,
    createProduct: async (...args) => {
      calls.order.push('create')
      calls.created.push(args[0])
      if (failSkus.includes(args[0].sku)) throw new Error('insert failed')
      return 'p999'
    },
    updateProductSpecs: async (...args) => {
      calls.order.push('update')
      calls.specWrites.push(args)
      if (failSkus.includes(args[0])) throw new Error('update failed')
    },
    saveVariantAsins: async (...args) => {
      calls.order.push('asins')
      calls.asinWrites.push({ sku: args[0], variants: args[1] })
      if (failSkus.includes(args[0])) throw new Error('asins failed')
    },
  }
}

const IMPORT_GRID = grid(
  ['NEW-01', 'B0000000N1', 'Camel', 'M'],
  ['NEW-01', '', 'Cream', 'L'],
  ['G7F906', 'B00000000X', 'Blue', 'M'],
)
const PLAN = planImport({
  grid: IMPORT_GRID,
  dbProducts: DB_PRODUCTS,
  existingAsins: DB_ASINS,
  hideNew: true,
})

{
  const rec = recorder()
  const stats = await executeImport(PLAN, {
    isAdmin: true,
    ...rec,
    onProgress: () => {},
  })

  check('one product created', stats.created, 1)
  check('one product merged', stats.merged, 1)
  check('two ASINs written', stats.asinsAdded + stats.asinsUpdated, 2)
  check('nothing was skipped', stats.skipped, [])
  check('the one ASIN-less variant is reported for manual fill-in', stats.variantsWithoutAsin, 1)

  /* Products before ASINs: an ASIN row for a 货号 that failed to insert is an
     orphan nothing can see. */
  check(
    'every product write happens before any ASIN write',
    rec.calls.order.lastIndexOf('asins') > Math.max(rec.calls.order.lastIndexOf('create'), rec.calls.order.lastIndexOf('update')),
    true,
  )
  check(
    'the create row carries everything a new product needs',
    Object.keys(rec.calls.created[0]).sort(),
    ['category', 'hidden', 'id', 'image', 'name', 'sku', 'sort_order', 'specs', 'tag', 'variantCount', 'variant_images'],
  )

  /* THE guarantee: an existing product's payload is the specs object and
     nothing else. */
  check('exactly one specs write happened', rec.calls.specWrites.length, 1)
  check('it went to the right product', rec.calls.specWrites[0][0], 'p001')
  check('with exactly two arguments', rec.calls.specWrites[0].length, 2)
  check(
    'and the second one is specs — no name, image, category, badge, hidden or tag',
    Object.keys(rec.calls.specWrites[0][1]).sort(),
    ['Colour', 'Size'],
  )
  check(
    'the payload is the appended list, not the sheet',
    rec.calls.specWrites[0][1],
    { Colour: ['Black', 'White', 'Blue'], Size: ['M', 'L'] },
  )

  /* The ASIN writer is handed the union, never the sheet's slice. */
  check('both 货号 wrote their ASINs', rec.calls.asinWrites.length, 2)
  const g7Write = rec.calls.asinWrites.find((w) => w.sku === 'G7F906')
  check('the merged 货号 wrote one row', Boolean(g7Write), true)
  check(
    'and it still contains the keys the sheet never mentioned',
    Object.keys(g7Write.variants).sort(),
    ['Black|M', 'Blue|M', 'White|L'],
  )
  check(
    'the new 货号 wrote only the ASINs it had',
    Object.keys(rec.calls.asinWrites.find((w) => w.sku === 'NEW-01').variants),
    ['Camel|M'],
  )
}

{
  /* Not an admin: nothing at all is written. */
  const rec = recorder()
  let thrown = null
  try {
    await executeImport(PLAN, { isAdmin: false, ...rec })
  } catch (err) {
    thrown = err
  }
  check('a non-admin run throws', thrown !== null, true)
  check('and the message says why', /administrator/.test(thrown.message), true)
  check('nothing was created', rec.calls.created.length, 0)
  check('nothing was merged', rec.calls.specWrites.length, 0)
  check('no ASIN row was touched', rec.calls.asinWrites.length, 0)
}

{
  /* A missing writer is a programming error, not a silent no-op. */
  const rec = recorder()
  let thrown = null
  try {
    await executeImport(PLAN, { isAdmin: true, ...rec, saveVariantAsins: undefined })
  } catch (err) {
    thrown = err
  }
  check('a missing writer throws', thrown !== null, true)
}

{
  /* One failed 货号 must not cost the others. */
  const rec = recorder({ failSkus: ['NEW-01'] })
  const stats = await executeImport(PLAN, { isAdmin: true, ...rec })

  check('the failed create is reported', stats.skipped.map((s) => s.sku), ['NEW-01'])
  check('the other 货号 still merged', stats.merged, 1)
  check('its ASIN was still written', stats.asinsAdded + stats.asinsUpdated, 1)
  check(
    'but no orphan ASIN row was left for the failed one',
    rec.calls.asinWrites.some((w) => w.sku === 'NEW-01'),
    false,
  )
}

{
  /* Progress reporting: the modal's loading state is driven by this. */
  const seen = []
  await executeImport(PLAN, {
    isAdmin: true,
    ...recorder(),
    onProgress: (p) => seen.push(p),
  })
  check('progress fires once per write', seen.length, 4)
  check('and counts up to the total', [seen[0].done, seen[seen.length - 1].done, seen[0].total], [1, 4, 4])
  check('the phases are named, products before ASINs', seen.map((p) => p.phase), [
    'create',
    'update',
    'asins',
    'asins',
  ])
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. the spec-order regression that started all of this
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n7. append-only, proven on order')

{
  /* A v4 selection code stores option INDEXES. Reordering specs re-points
     codes already sitting in a creator's inbox at a different colour. */
  const plan = planImport({
    grid: grid(['G7F906', '', 'Apricot', 'XL']),
    dbProducts: DB_PRODUCTS,
    existingAsins: DB_ASINS,
  })
  const before = DB_PRODUCTS[0].specs
  const after = plan.update[0].specs
  check('every original option is still in place', after.Colour.slice(0, before.Colour.length), before.Colour)
  check('every original size is still in place', after.Size.slice(0, before.Size.length), before.Size)
  check('the new option is at the end', after.Colour.at(-1), 'Apricot')
  check('the new size is at the end', after.Size.at(-1), 'XL')
  check('nothing was removed', after.Colour.length + after.Size.length, 6)
}

console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
console.log(`Failed ${failed}`)
process.exit(failed ? 1 : 0)
