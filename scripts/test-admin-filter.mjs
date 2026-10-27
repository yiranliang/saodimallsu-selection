/**
 * Admin catalogue filter self-check
 * Run: npm run test:filter
 *
 * Pure Node — no browser, no database.
 *
 * WHY THIS SUITE EXISTS
 * ─────────────────────
 * The category dropdown looks like a view detail and is not one: "visible" is
 * what Select all ticks, what the bulk Hide / Delete buttons hit, and what turns
 * dragging off. So the things worth pinning are not "does the filter filter",
 * they are the interactions:
 *
 *   1. the three controls AND together — a category plus a 货号 narrows twice
 *   2. a category filter never leaks a product from another category (the bulk
 *      delete risk)
 *   3. catalogue order survives filtering — the admin list is a sorted list, and
 *      a filter that reordered it would look like the drag had been undone
 *   4. the empty / blank / missing-category cases degrade to "show everything",
 *      never to "show nothing", because an empty list reads as a data bug
 *   5. the dropdown only offers categories that exist in the catalogue
 *   6. a pasted list of 货号 searches them as an OR of exact SKUs, and a single
 *      word still searches fuzzily — the two modes must not bleed into one
 *      another (see [8] and [9])
 */

import {
  ALL_CATEGORIES,
  BULK_MIN_TOKENS,
  DEAL_ITEMS,
  categoryOptionsOf,
  dealItemsCountOf,
  filterProducts,
  isDealItem,
  matchesCategory,
  parseBulkQuery,
} from '../src/utils/adminFilter.js'

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

/* A miniature catalogue with every awkward shape the live one has: a product
 * with no 货号, one with no specs, one with two sold-out combinations, and a
 * category whose name is a prefix of another ("Tops" / "Tops & Sets"). */
const catalogue = [
  { id: 'p001', sku: 'H4E390', name: 'Luna Bralette', category: 'Tops', specs: { Colour: ['Black'], Size: ['S', 'M'] } },
  { id: 'p002', sku: 'P9B013', name: 'Ruffle Strap Longline', category: 'Tops', specs: { Colour: ['Black', 'Green'], Size: ['S'] }, soldOutVariants: ['Green|S'] },
  { id: 'p003', sku: 'N2Z034', name: 'Cloud Knit Set', category: 'Tops & Sets', specs: { Colour: ['Oat'], Size: ['M'] } },
  { id: 'p004', sku: 'N9Z087', name: 'Wide Leg Trouser', category: 'Bottoms', specs: { Colour: ['Brown'], Size: ['S', 'M'] }, soldOutVariants: ['Brown|S', 'Brown|M'] },
  { id: 'p005', sku: '', name: 'Sample Piece', specs: {} },
]

const ids = (rows) => rows.map((row) => row.id)

/* ── 1. the sentinel ── */
console.log('\n[1] "All" means no filter')

check('the sentinel is the string the dropdown uses', ALL_CATEGORIES, 'All')
check('All returns the whole catalogue, in order', ids(filterProducts(catalogue, { category: ALL_CATEGORIES })), [
  'p001',
  'p002',
  'p003',
  'p004',
  'p005',
])
check('no options at all behaves like All', ids(filterProducts(catalogue)), ids(catalogue))
check('an empty filter string behaves like All', ids(filterProducts(catalogue, { category: '' })), ids(catalogue))

/* ── 2. one category ── */
console.log('\n[2] A category narrows to exactly that category')

check('Tops', ids(filterProducts(catalogue, { category: 'Tops' })), ['p001', 'p002'])
check('Tops & Sets is not swallowed by Tops', ids(filterProducts(catalogue, { category: 'Tops & Sets' })), ['p003'])
check('a category nothing is in returns nothing', filterProducts(catalogue, { category: 'Outerwear' }), [])
check(
  'a product with no category is only reachable through All',
  ids(filterProducts(catalogue, { category: 'Tops' })).includes('p005'),
  false,
)
check('category comparison is exact, not case-folded', filterProducts(catalogue, { category: 'tops' }), [])
check('matchesCategory agrees with the filter', [matchesCategory(catalogue[0], 'Tops'), matchesCategory(catalogue[0], 'Bottoms')], [true, false])

/* ── 3. AND with the search box ── */
console.log('\n[3] Category + search combine with AND')

check('a 货号 in the right category matches', ids(filterProducts(catalogue, { category: 'Tops', query: 'P9B013' })), ['p002'])
check('the same 货号 under another category matches nothing', filterProducts(catalogue, { category: 'Bottoms', query: 'P9B013' }), [])
check('a name fragment still narrows inside the category', ids(filterProducts(catalogue, { category: 'Tops', query: 'luna' })), ['p001'])
check('search alone is unchanged', ids(filterProducts(catalogue, { query: 'luna' })), ['p001'])
check(
  'an ASIN search works through the category filter too',
  ids(
    filterProducts(catalogue, {
      category: 'Tops',
      query: 'B0H6XHHZ8N',
      asinMap: { H4E390: { 'Black|S': 'B0H6XHHZ8N' } },
    }),
  ),
  ['p001'],
)
check(
  'the same ASIN search under another category matches nothing',
  filterProducts(catalogue, {
    category: 'Bottoms',
    query: 'B0H6XHHZ8N',
    asinMap: { H4E390: { 'Black|S': 'B0H6XHHZ8N' } },
  }),
  [],
)

/* ── 4. AND with the sold-out view ── */
console.log('\n[4] Sold-out view combines with the category')

check('every sold-out style', ids(filterProducts(catalogue, { soldOutOnly: true })), ['p002', 'p004'])
check('sold out within Tops', ids(filterProducts(catalogue, { soldOutOnly: true, category: 'Tops' })), ['p002'])
check('sold out within Bottoms', ids(filterProducts(catalogue, { soldOutOnly: true, category: 'Bottoms' })), ['p004'])
check('sold out in a category with none', filterProducts(catalogue, { soldOutOnly: true, category: 'Tops & Sets' }), [])

/* ── 5. what Select all would tick ── */
console.log('\n[5] The filtered view never leaks another category')

const tops = filterProducts(catalogue, { category: 'Tops' })
check('every visible row is in the chosen category', tops.every((row) => row.category === 'Tops'), true)
check('no visible row is from another category', tops.some((row) => row.category !== 'Tops'), false)
check(
  'the ids are a subset of the catalogue, in catalogue order',
  ids(tops),
  ids(catalogue).filter((id) => ids(tops).includes(id)),
)

/* ── 6. junk in, empty out (never a crash) ── */
console.log('\n[6] Odd input degrades to an empty list, not an exception')

check('null catalogue', filterProducts(null), [])
check('undefined catalogue', filterProducts(undefined, { category: 'Tops' }), [])
check('a string instead of an array', filterProducts('nope'), [])
check('rows without a category', ids(filterProducts([{ id: 'x' }, { id: 'y', category: 'Tops' }], { category: 'Tops' })), ['y'])
/* The column is `text`, so a numeric category can only come from a stub or a
 * future schema change. Both sides are coerced to text — matching is textual,
 * not `===` — because "3" vs 3 must not silently empty the list. */
check('a numeric category compares as text', ids(filterProducts([{ id: 'z', category: 3 }], { category: '3' })), ['z'])

/* ── 7. dropdown options ── */
console.log('\n[7] The dropdown lists the catalogue, sorted and deduplicated')

check('deduplicated and sorted', categoryOptionsOf(catalogue), ['Bottoms', 'Tops', 'Tops & Sets'])
check('blank categories are not offered', categoryOptionsOf([{ category: '' }, { category: 'Tops' }]), ['Tops'])
check('a category named "All" is left out of the list', categoryOptionsOf([{ category: 'All' }, { category: 'Tops' }]), ['Tops'])
check('and the option list is empty for an empty catalogue', categoryOptionsOf([]), [])
check('null catalogue', categoryOptionsOf(null), [])

/* ── 8. splitting a pasted list ── */
console.log('\n[8] A pasted list is split on every separator Excel produces')

check('newlines', parseBulkQuery('H4E390\nP9B013\nN2Z034'), ['H4E390', 'P9B013', 'N2Z034'])
check('spaces', parseBulkQuery('H4E390 P9B013  N2Z034'), ['H4E390', 'P9B013', 'N2Z034'])
check('commas', parseBulkQuery('H4E390,P9B013,N2Z034'), ['H4E390', 'P9B013', 'N2Z034'])
check('semicolons', parseBulkQuery('H4E390;P9B013;N2Z034'), ['H4E390', 'P9B013', 'N2Z034'])
check('tabs (the other thing Excel pastes)', parseBulkQuery('H4E390\tP9B013'), ['H4E390', 'P9B013'])
check('full-width comma / semicolon / 、', parseBulkQuery('H4E390，P9B013；N2Z034、N9Z087'), ['H4E390', 'P9B013', 'N2Z034', 'N9Z087'])
check(
  'a realistic mixed paste',
  parseBulkQuery('  H4E390 ,\n P9B013;  N2Z034 \r\n\n'),
  ['H4E390', 'P9B013', 'N2Z034'],
)
check('a trailing newline is not an empty token', parseBulkQuery('H4E390\n'), ['H4E390'])
check('duplicates collapse, case-insensitively', parseBulkQuery('h4e390, H4E390, H4E390'), ['h4e390'])
check('the first spelling is the one kept', parseBulkQuery('p9b013, P9B013')[0], 'p9b013')
check('a single 货号 stays single', parseBulkQuery('P9B013'), ['P9B013'])
check('blank input', parseBulkQuery('   \n  '), [])
check('null input', parseBulkQuery(null), [])
check('the switch happens at two tokens', BULK_MIN_TOKENS, 2)

/* ── 9. bulk filtering ── */
console.log('\n[9] Two or more 货号 = OR of exact SKUs')

const bulkIds = (q, extra = {}) => ids(filterProducts(catalogue, { query: q, ...extra }))

check('newline separated paste', bulkIds('H4E390\nP9B013'), ['p001', 'p002'])
check('space separated paste', bulkIds('H4E390 P9B013'), ['p001', 'p002'])
check('comma separated paste', bulkIds('H4E390,N9Z087'), ['p001', 'p004'])
check('case does not matter', bulkIds('h4e390 p9b013'), ['p001', 'p002'])
check('stray separators are ignored', bulkIds('H4E390,, ,N9Z087'), ['p001', 'p004'])
check('one unknown 货号 does not hide the others', bulkIds('H4E390 NOPE'), ['p001'])
check('no match at all → empty', bulkIds('NOPE NADA'), [])

/* The important boundary: a single token is still FUZZY (substring), a list is
 * EXACT. Getting this backwards would either break "P9" or make a paste of
 * 100 货号 match hundreds of names. */
check('one token stays fuzzy: a prefix matches', bulkIds('H4E39'), ['p001'])
check('the same prefix inside a list is not a match', bulkIds('H4E39 P9B013'), ['p002'])
check('one token still matches a name', bulkIds('bralette'), ['p001'])
check('one token still matches a category', bulkIds('Bottoms'), ['p004'])

check('catalogue order wins over paste order', bulkIds('N9Z087 H4E390'), ['p001', 'p004'])
check('a product with no 货号 can never match a list', bulkIds('P9B013   '), ['p002'])
check('bulk AND category', bulkIds('H4E390\nP9B013', { category: 'Tops' }), ['p001', 'p002'])
check('bulk AND a category that excludes one', bulkIds('H4E390\nN9Z087', { category: 'Bottoms' }), ['p004'])
check('bulk AND sold-out view', bulkIds('P9B013\nN9Z087', { soldOutOnly: true }), ['p002', 'p004'])
check('empty catalogue', ids(filterProducts([], { query: 'A B' })), [])
check('non-array input', filterProducts(null, { query: 'A B' }), [])

/* A real paste is 50-100 货号. Correctness first — the Set is what makes it
 * cheap, and this is the case that would expose a per-product scan. */
const wide = Array.from({ length: 300 }, (_, i) => ({
  id: `p${i}`,
  sku: `SKU${1000 + i}`,
  name: `Style ${i}`,
  category: 'Tops',
  specs: {},
}))
const pasted = wide.slice(0, 100).map((p) => p.sku).join('\n')
const wideStart = Date.now()
const wideResult = filterProducts(wide, { query: pasted })
const wideMs = Date.now() - wideStart
console.log(`  100 货号 × 300 products: ${wideResult.length} rows in ${wideMs} ms`)
check('every pasted 货号 is found', wideResult.length, 100)
check('and nothing else is', wideResult.every((p) => p.sku.startsWith('SKU1')), true)

console.log('\n[10] ⚡ Deal Items — a view, not a category')

{
  const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime()
  const NOW = at(2026, 10, 28, 12, 0)

  const withDeals = [
    { id: 'live', sku: 'A', category: 'Tops', saleStart: '2026-10-28T10:00', saleEnd: '2026-10-28T22:00' },
    { id: 'scheduled', sku: 'B', category: 'Tops', saleStart: '2026-10-29T10:00', saleEnd: '2026-10-30T10:00' },
    { id: 'ended', sku: 'C', category: 'Bottoms', saleStart: '2026-10-01T10:00', saleEnd: '2026-10-02T10:00' },
    /* 只有一半的时间窗 —— 前台永远不生效，所以也不算秒杀商品。 */
    { id: 'half', sku: 'D', category: 'Bottoms', saleStart: '2026-10-28T10:00' },
    { id: 'none', sku: 'E', category: 'Tops' },
  ]

  check('the sentinel cannot collide with a real category', DEAL_ITEMS.includes('__'), true)
  check(
    'live + scheduled only — ended and half-filled drop out',
    ids(filterProducts(withDeals, { category: DEAL_ITEMS, now: NOW })),
    ['live', 'scheduled'],
  )
  check('the dropdown count matches the list', dealItemsCountOf(withDeals, NOW), 2)
  check('count ignores a non-array', dealItemsCountOf(null, NOW), 0)
  check('isDealItem: live', isDealItem(withDeals[0], NOW), true)
  check('isDealItem: ended', isDealItem(withDeals[2], NOW), false)

  /* 它必须和其它两个控件 AND 起来：先按分类再切秒杀，或者反过来。 */
  check(
    'and it still combines with the search box',
    ids(filterProducts(withDeals, { category: DEAL_ITEMS, query: 'B', now: NOW })),
    ['scheduled'],
  )
  check(
    'and with the sold-out view',
    ids(
      filterProducts(
        [
          /* `soldOutSummary` only counts marks that still exist in `specs`, so
           * the fixture needs one real combination. */
          {
            ...withDeals[0],
            specs: { Colour: ['Black'], Size: ['S'] },
            soldOutVariants: ['Black|S'],
          },
          withDeals[1],
        ],
        { category: DEAL_ITEMS, soldOutOnly: true, now: NOW },
      ),
    ),
    ['live'],
  )
}

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
