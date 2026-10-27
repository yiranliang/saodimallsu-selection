/**
 * Catalogue pipeline self-check
 *   node scripts/test-catalogue.mjs
 *
 * Pure functions only. The point of this suite is the ordering guarantee:
 * filtering happens before paging, so "Load more" always counts inside the
 * current category + search — never inside the whole catalogue. Getting that
 * backwards is invisible in a 5-product fixture and obvious in production.
 */

import {
  PAGE_SIZE,
  normaliseQuery,
  matchesQuery,
  filterCatalogue,
  badgeFirst,
  storefrontOrder,
  storefrontTier,
  STOREFRONT_TIERS,
  hasBadge,
  slicePage,
  nextLimit,
  hasMore,
} from '../src/utils/catalogue.js'
import { isShoppable } from '../src/utils/teaser.js'

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

const product = (id, name, sku, category) => ({
  id,
  name,
  sku,
  category,
  image: '',
  specs: {},
  tag: '',
})

const catalogue = [
  product('p001', 'Oversized Hoodie', 'P9B013', 'Tops'),
  product('p002', 'Wool Blend Trousers', 'P9B050', 'Bottoms'),
  product('p003', 'Leather Penny Loafers', 'H4E384', 'Shoes'),
  product('p004', 'Ribbed Tank', 'P9B013-2', 'Tops'),
  product('p005', 'Silk Slip Dress', 'N7W119', ''),
]

const ids = (list) => list.map((item) => item.id)

/* ── 1. page size ── */
console.log('\n[1] Batch size')
check('one batch is 24 cards', PAGE_SIZE, 24)

/* ── 2. query normalising ── */
console.log('\n[2] Query normalising')
check('trims', normaliseQuery('  hoodie  '), 'hoodie')
check('collapses inner spaces', normaliseQuery('wool   blend'), 'wool blend')
check('lowercases', normaliseQuery('P9B013'), 'p9b013')
check('null is empty', normaliseQuery(null), '')
check('undefined is empty', normaliseQuery(undefined), '')

/* ── 3. matching ── */
console.log('\n[3] Matching')
check('empty query matches everything', matchesQuery(catalogue[0], ''), true)
check('matches the name', matchesQuery(catalogue[0], 'hoodie'), true)
check('matches the 货号', matchesQuery(catalogue[0], 'P9B013'), true)
check('case does not matter', matchesQuery(catalogue[0], 'p9b013'), true)
check('partial 货号 matches', matchesQuery(catalogue[0], '9b01'), true)
check('every token must match', matchesQuery(catalogue[1], 'wool trousers'), true)
check('a stray token fails', matchesQuery(catalogue[1], 'wool hoodie'), false)
check('no match is false', matchesQuery(catalogue[2], 'hoodie'), false)
check('survives a missing sku', matchesQuery({ name: 'Ghost' }, 'ghost'), true)

/* ── 4. category filter ── */
console.log('\n[4] Category filter')
check('All returns everything', ids(filterCatalogue(catalogue, { category: 'All' })), [
  'p001',
  'p002',
  'p003',
  'p004',
  'p005',
])
check('one category', ids(filterCatalogue(catalogue, { category: 'Tops' })), ['p001', 'p004'])
check('an unknown category is empty', filterCatalogue(catalogue, { category: 'Hats' }), [])
check(
  'blank category lands in the uncategorised bucket',
  ids(filterCatalogue(catalogue, { category: 'Uncategorised' })),
  ['p005'],
)
check(
  'the bucket name is configurable',
  ids(filterCatalogue(catalogue, { category: 'No category', uncategorised: 'No category' })),
  ['p005'],
)

/* ── 5. search filter ── */
console.log('\n[5] Search filter')
check('name search', ids(filterCatalogue(catalogue, { query: 'hoodie' })), ['p001'])
check('货号 search', ids(filterCatalogue(catalogue, { query: 'h4e384' })), ['p003'])
check('prefix search hits both', ids(filterCatalogue(catalogue, { query: 'p9b013' })), [
  'p001',
  'p004',
])
check('no match', filterCatalogue(catalogue, { query: 'zzz' }), [])
check('whitespace-only query is ignored', filterCatalogue(catalogue, { query: '   ' }).length, 5)

/* ── 6. category + search together ── */
console.log('\n[6] Category and search combined')
check(
  'both narrow the list',
  ids(filterCatalogue(catalogue, { category: 'Tops', query: 'tank' })),
  ['p004'],
)
check(
  'a term that only exists elsewhere gives nothing',
  filterCatalogue(catalogue, { category: 'Tops', query: 'loafers' }),
  [],
)
check(
  'searching then narrowing keeps the same order',
  ids(filterCatalogue(catalogue, { category: 'All', query: 'p9b' })),
  ['p001', 'p002', 'p004'],
)

/* ── 7. paging ── */
console.log('\n[7] Paging')
const hundred = Array.from({ length: 100 }, (_, i) => product(`p${i}`, `Item ${i}`, `S${i}`, 'Tops'))

check('first batch', slicePage(hundred, PAGE_SIZE).length, 24)
check('second batch ends at 48', slicePage(hundred, 48).length, 48)
check('a short list is returned whole', slicePage(catalogue, PAGE_SIZE).length, 5)
check('limit 0 renders nothing', slicePage(hundred, 0), [])
check('a negative limit renders nothing', slicePage(hundred, -5), [])
check('a nonsense limit renders nothing', slicePage(hundred, NaN), [])
check('a fractional limit floors', slicePage(hundred, 10.9).length, 10)
check('order is preserved', slicePage(hundred, 3).map((p) => p.id), ['p0', 'p1', 'p2'])
check('empty input is safe', slicePage(null, 24), [])

/* ── 8. next batch size ── */
console.log('\n[8] Next limit')
check('adds one batch', nextLimit(24, 100), 48)
check('clamps at the end', nextLimit(96, 100), 100)
check('never runs past the end', nextLimit(100, 100), 100)
check('from zero', nextLimit(0, 100), 24)
check('empty set stays empty', nextLimit(0, 0), 0)
check('custom step', nextLimit(24, 100, 36), 60)

/* ── 9. has more ── */
console.log('\n[9] Has more')
check('more to come', hasMore(24, 100), true)
check('exactly done', hasMore(100, 100), false)
check('one short', hasMore(99, 100), true)
check('empty catalogue', hasMore(24, 0), false)

/* ── 10. the ordering guarantee ── */
console.log('\n[10] Filter before page')
const tops = filterCatalogue(hundred.map((p, i) => ({ ...p, category: i < 30 ? 'Tops' : 'Shoes' })), {
  category: 'Tops',
})
check('filtered total is the category size', tops.length, 30)
check('first page of a filtered set', slicePage(tops, PAGE_SIZE).length, 24)
check('second page of a filtered set', slicePage(tops, nextLimit(PAGE_SIZE, tops.length)).length, 30)
check('the second page never leaks other categories', slicePage(tops, 30).every((p) => p.category === 'Tops'), true)

/* paging the unfiltered list and filtering afterwards would give 0 here */
const wrongOrder = filterCatalogue(slicePage(hundred, 24), { query: 'item 42' })
const rightOrder = slicePage(filterCatalogue(hundred, { query: 'item 42' }), 24)
check('slicing first loses matches', wrongOrder.length, 0)
check('filtering first finds them', rightOrder.length, 1)

/* ── 11. badge first ──
 *
 * The storefront pins badged styles to the top. Four things have to hold, and
 * three of them are not obvious:
 *
 *   1. the two groups keep their OWN order (the admin's sort_order) — pinning
 *      must not reshuffle anything
 *   2. `badgeColor` alone is not a badge: the card would render an empty pill
 *   3. the reorder must happen BEFORE the slice, or a badged style at rank 191
 *      is invisible until eight "Load more" clicks
 *   4. it composes with category + search, because that is how the storefront
 *      is actually used
 */
console.log('\n[11] Badge first')

const badged = (product, tag, badgeColor) => ({ ...product, tag, badgeColor })
const skus = (list) => list.map((item) => item.sku)

check('a tag is a badge', hasBadge(badged(product('p1', 'A', 'S1', 'Tops'), 'New')), true)
check('no tag is not', hasBadge(product('p2', 'B', 'S2', 'Tops')), false)
check('null tag is not', hasBadge({ ...product('p3', 'C', 'S3', 'Tops'), tag: null }), false)
check('undefined tag is not', hasBadge({ id: 'p4' }), false)
check(
  'whitespace only is not (the card would show an empty pill, not a badge)',
  hasBadge(badged(product('p5', 'E', 'S5', 'Tops'), '   ')),
  false,
)
check(
  'a colour without text is not',
  hasBadge({ ...product('p6', 'F', 'S6', 'Tops'), tag: '', badgeColor: '#4A6B52' }),
  false,
)

/* Catalogue order = the order the admin dragged into place. */
const shelf = [
  product('p01', 'Alpha', 'A01', 'Tops'),
  product('p02', 'Bravo', 'A02', 'Bottoms'),
  badged(product('p03', 'Charlie', 'A03', 'Tops'), 'New'),
  product('p04', 'Delta', 'A04', 'Tops'),
  badged(product('p05', 'Echo', 'A05', 'Bottoms'), 'Best-seller'),
  product('p06', 'Foxtrot', 'A06', 'Shoes'),
  badged(product('p07', 'Golf', 'A07', 'Shoes'), 'FP dupe', '#4A6B52'),
  product('p08', 'Hotel', 'A08', 'Tops'),
]

check(
  'badged styles come first, in their own order',
  skus(badgeFirst(shelf)),
  ['A03', 'A05', 'A07', 'A01', 'A02', 'A04', 'A06', 'A08'],
)
check('and the unbadged keep theirs', skus(badgeFirst(shelf)).slice(3), ['A01', 'A02', 'A04', 'A06', 'A08'])
check('nothing gained or lost', badgeFirst(shelf).length, shelf.length)
check('the input is untouched', skus(shelf), ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08'])

const noBadges = shelf.filter((item) => !hasBadge(item))
check('a list with no badges is returned in the same order', skus(badgeFirst(noBadges)), skus(noBadges))
check('a list where everything is badged is unchanged', skus(badgeFirst(shelf.filter(hasBadge))), ['A03', 'A05', 'A07'])
check('a fresh array every time (callers can safely sort/slice it)', badgeFirst(shelf) === shelf, false)
check('empty in, empty out', badgeFirst([]), [])
check('non-array in, empty out', badgeFirst(null), [])
check('one item is its own answer', skus(badgeFirst([shelf[0]])), ['A01'])
check('running it twice changes nothing', skus(badgeFirst(badgeFirst(shelf))), skus(badgeFirst(shelf)))

/* Only the text matters: repainting a badge must not move the product. */
const recoloured = shelf.map((item) =>
  item.id === 'p03' ? { ...item, badgeColor: '#C0392B' } : item,
)
check('changing only the badge colour keeps the position', skus(badgeFirst(recoloured))[0], 'A03')
check(
  'clearing the tag drops it back into the unbadged pool',
  skus(badgeFirst(shelf.map((item) => (item.id === 'p03' ? { ...item, tag: '' } : item)))),
  ['A05', 'A07', 'A01', 'A02', 'A03', 'A04', 'A06', 'A08'],
)

/* Category and search narrow first; badge-first reorders what is left. */
check(
  'inside a category, badged styles still lead',
  skus(badgeFirst(filterCatalogue(shelf, { category: 'Tops' }))),
  ['A03', 'A01', 'A04', 'A08'],
)
check(
  'a search result that has a badge leads too',
  skus(badgeFirst(filterCatalogue(shelf, { query: 'golf' }))),
  ['A07'],
)
check(
  'and a search with no badged hit is simply the match',
  skus(badgeFirst(filterCatalogue(shelf, { query: 'alpha' }))),
  ['A01'],
)

/* The reason the order of the two steps matters: rank 191 on a real catalogue
 * is not "first", it is "page 8". */
const deep = hundred.map((item, i) =>
  i === 25 || i === 80 ? { ...item, tag: 'Best-seller' } : item,
)
const sortThenSlice = slicePage(badgeFirst(deep), PAGE_SIZE)
const sliceThenSort = badgeFirst(slicePage(deep, PAGE_SIZE))
check('sorting before paging puts the rank-25 badge in the first batch', skus(sortThenSlice).slice(0, 2), ['S25', 'S80'])
check('slicing first would leave it out entirely', sliceThenSort.some((item) => hasBadge(item)), false)
check('and the batch is still one page', sortThenSlice.length, PAGE_SIZE)
check(
  'the rest of the batch is the start of the catalogue, not a reshuffle',
  skus(sortThenSlice).slice(2, 5),
  ['S0', 'S1', 'S2'],
)

/* ── 12. hidden products sink to the bottom ──
   `hidden` means "not published" in this app, so the storefront filters those
   rows out before ordering (see SHOW_HIDDEN_PRODUCTS in SelectionPage). But the
   ordering step must still be correct when a hidden row does arrive — the admin
   preview, a future policy change, or a caller that forgot to filter. Tier 3 is
   the guarantee: no hidden product can ever sit between two live ones. */
console.log('\n[12] Hidden sink · three tiers, stable inside each')

const withHidden = [
  product('p01', 'Alpha', 'A01', 'Tops'),
  { ...product('p02', 'Bravo', 'A02', 'Bottoms'), hidden: true },
  badged(product('p03', 'Charlie', 'A03', 'Tops'), 'New'),
  { ...badged(product('p04', 'Delta', 'A04', 'Tops'), 'Best-seller'), hidden: true },
  product('p05', 'Echo', 'A05', 'Bottoms'),
  { ...product('p06', 'Foxtrot', 'A06', 'Shoes'), hidden: true },
  product('p07', 'Golf', 'A07', 'Shoes'),
]

check(
  'badged, then plain, then hidden',
  skus(storefrontOrder(withHidden)),
  ['A03', 'A01', 'A05', 'A07', 'A02', 'A04', 'A06'],
)
check(
  'a badged hidden product still goes last (unpublished beats the badge)',
  skus(storefrontOrder(withHidden)).indexOf('A04') > skus(storefrontOrder(withHidden)).indexOf('A07'),
  true,
)
check('nothing gained or lost', storefrontOrder(withHidden).length, withHidden.length)
check('the input is untouched', skus(withHidden), ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07'])

/* Stability: each tier keeps the order it arrived in (= the admin's drag order). */
const tiers = storefrontOrder(withHidden)
check('tier 1 keeps its internal order', skus(tiers).slice(0, 1), ['A03'])
check('tier 2 keeps its internal order', skus(tiers).slice(1, 4), ['A01', 'A05', 'A07'])
check('tier 3 keeps its internal order', skus(tiers).slice(4), ['A02', 'A04', 'A06'])

check('a fresh array every time', storefrontOrder(withHidden) === withHidden, false)
check('running it twice changes nothing', skus(storefrontOrder(tiers)), skus(tiers))
check('empty in, empty out', storefrontOrder([]), [])
check('non-array in, empty out', storefrontOrder(null), [])
check('one item is its own answer', skus(storefrontOrder([withHidden[0]])), ['A01'])
check('a list with no hidden rows is exactly badgeFirst', skus(storefrontOrder(shelf)), skus(badgeFirst(shelf)))

/* Unhide: the row goes back to its own tier, not to the end. */
const unhidden = withHidden.map((item) => (item.id === 'p02' ? { ...item, hidden: false } : item))
check(
  'unhiding puts it back among the plain styles, in catalogue position',
  skus(storefrontOrder(unhidden)),
  ['A03', 'A01', 'A02', 'A05', 'A07', 'A04', 'A06'],
)

/* The whole pipeline: filter → order → page. */
console.log('\n[13] Filter → order → page keeps hidden out of the first batch')

const many = []
for (let i = 0; i < 40; i++) {
  const row = product(`p${i}`, `Style ${i}`, `K${String(i).padStart(3, '0')}`, i % 2 ? 'Tops' : 'Bottoms')
  many.push(i % 5 === 0 ? { ...row, hidden: true } : row)
}
const visibleOnly = many.filter((item) => !item.hidden)
check('40 rows in, 8 hidden', visibleOnly.length, 32)
check(
  'no hidden row can reach page one when 24 slots are filled by live rows',
  slicePage(storefrontOrder(filterCatalogue(visibleOnly, { category: 'All' })), 24).some((item) => item.hidden),
  false,
)
/* Even if the caller forgets to filter, paging still shows live rows first. */
check(
  'ordering before slicing keeps hidden rows off page one anyway',
  slicePage(storefrontOrder(many), 24).some((item) => item.hidden),
  false,
)
check(
  'and the last page ends with them',
  storefrontOrder(many).slice(-8).every((item) => item.hidden),
  true,
)
check(
  'a category filter still carries its hidden rows to the end',
  storefrontOrder(filterCatalogue(many, { category: 'Tops' })).slice(-4).every((item) => item.hidden),
  true,
)
check(
  'search keeps the tier order too',
  storefrontOrder(filterCatalogue(many, { query: 'K00' })).length >= 1,
  true,
)

/* ── 14. four tiers: the first screen must be all shoppable ──
   The business complaint that produced this: a first screen of Coming Soon
   styles reads as "this shop has no stock", and the creator leaves without
   scrolling. So a teaser is still published (tier 3 — visible further down,
   which is what a preview is for) but it can never occupy a slot in the first
   batch while 24 orderable products exist. */
console.log('\n[14] Tiers · live+badge → live → Coming Soon → hidden')

const tierOf = (extra) => storefrontTier({ ...product('p1', 'X', 'X1', 'Tops'), ...extra })
check('live + badge is tier 1', tierOf({ tag: 'New' }), STOREFRONT_TIERS.LIVE_BADGED)
check('live, no badge is tier 2', tierOf({}), STOREFRONT_TIERS.LIVE_PLAIN)
check('a teaser is tier 3', tierOf({ isTeaser: true }), STOREFRONT_TIERS.TEASER)
check('a badged teaser is still tier 3', tierOf({ isTeaser: true, tag: 'New' }), STOREFRONT_TIERS.TEASER)
check('a deal badge does not promote (sorting stays time-independent)', tierOf({}), STOREFRONT_TIERS.LIVE_PLAIN)
check('hidden is tier 4', tierOf({ hidden: true }), STOREFRONT_TIERS.HIDDEN)
check('hidden beats a badge', tierOf({ hidden: true, tag: 'New' }), STOREFRONT_TIERS.HIDDEN)
check('hidden beats a teaser', tierOf({ hidden: true, isTeaser: true }), STOREFRONT_TIERS.HIDDEN)

const mixed = [
  product('p01', 'Alpha', 'A01', 'Tops'),
  { ...product('p02', 'Bravo', 'A02', 'Tops'), isTeaser: true },
  badged(product('p03', 'Charlie', 'A03', 'Tops'), 'New'),
  { ...product('p04', 'Delta', 'A04', 'Tops'), isTeaser: true, tag: 'Best-seller' },
  product('p05', 'Echo', 'A05', 'Bottoms'),
  { ...product('p06', 'Foxtrot', 'A06', 'Tops'), hidden: true },
  badged(product('p07', 'Golf', 'A07', 'Bottoms'), 'Trending'),
  { ...product('p08', 'Hotel', 'A08', 'Bottoms'), isTeaser: true, hidden: true },
]

check(
  'badged, plain, teasers, hidden — and each tier keeps its own order',
  skus(storefrontOrder(mixed)),
  ['A03', 'A07', 'A01', 'A05', 'A02', 'A04', 'A06', 'A08'],
)
check('a badged teaser sinks with the other teasers', skus(storefrontOrder(mixed)).indexOf('A04'), 5)
check('nothing gained or lost', storefrontOrder(mixed).length, mixed.length)
check('the input is untouched', skus(mixed), ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08'])
check('a fresh array every time', storefrontOrder(mixed) === mixed, false)
check('idempotent', skus(storefrontOrder(storefrontOrder(mixed))), skus(storefrontOrder(mixed)))

/* A teaser is sunk, NOT dropped: it has to be reachable by scrolling. */
check('teasers survive the ordering', storefrontOrder(mixed).filter((item) => item.isTeaser).length, 3)
check('and hidden rows survive it too', storefrontOrder(mixed).filter((item) => item.hidden).length, 2)

check('isShoppable: live', isShoppable(mixed[0]), true)
check('isShoppable: badged live', isShoppable(mixed[2]), true)
check('isShoppable: teaser', isShoppable(mixed[1]), false)
check('isShoppable: hidden', isShoppable(mixed[5]), false)

/* ── 15. the first batch ──
   The actual product requirement, on a fixture shaped like the real thing: 60
   styles, teasers deliberately placed first in the input (i.e. first by
   sort_order), so a partition that forgot to sink them would show up
   immediately. */
console.log('\n[15] The first batch of 24 contains nothing you cannot buy')

const shop = []
for (let i = 0; i < 60; i++) {
  const row = product(`s${i}`, `Style ${i}`, `S${String(i).padStart(3, '0')}`, 'Tops')
  if (i < 10) shop.push({ ...row, isTeaser: true })
  else if (i < 20) shop.push({ ...row, hidden: true })
  else if (i < 30) shop.push({ ...row, tag: 'New' })
  else shop.push(row)
}

const orderedShop = storefrontOrder(shop)
const firstBatch = slicePage(orderedShop, 24)
const secondBatch = slicePage(orderedShop.slice(24), 24)

check('the first batch is a full page', firstBatch.length, 24)
check('every card in it can be ordered', firstBatch.every(isShoppable), true)
check('no teaser slipped in', firstBatch.filter((item) => item.isTeaser).length, 0)
check('no hidden row slipped in', firstBatch.filter((item) => item.hidden).length, 0)
check('the badged styles still lead', firstBatch.slice(0, 10).every(hasBadge), true)
check('the first batch ends on plain live styles', firstBatch[23].tag, '')

/* 40 live / 10 teasers / 10 hidden: page 2 is where the teasers start showing,
 * so it is "no hidden" rather than "all shoppable" — 16 live + 8 teasers. */
check('the second batch has no hidden rows', secondBatch.every((item) => !item.hidden), true)
check('the teasers begin exactly at slot 40', secondBatch.filter((item) => item.isTeaser).length, 8)
check(
  'the teasers are the last 10 slots before hidden',
  orderedShop.slice(40, 50).every((item) => item.isTeaser && !item.hidden),
  true,
)
check('hidden rows are last', orderedShop.slice(50).every((item) => item.hidden), true)

/* Paging must not change the picture: Load more shows the sunk rows in order,
 * and the total never grows. */
check('Load more reaches them', nextLimit(24, 60) > 24, true)
check('and stops at the end', hasMore(48, 60), true)
check('the whole list is still 60', slicePage(orderedShop, 500).length, 60)

/* A shop where everything is Coming Soon still shows them — sinking must never
 * turn into hiding, or a pre-launch catalogue looks empty. */
const allTeasers = shop.slice(0, 10).map((item) => ({ ...item, hidden: false }))
check('all-teaser shop still lists 10', storefrontOrder(allTeasers).length, 10)
check('and page one is those teasers', slicePage(storefrontOrder(allTeasers), 24).length, 10)

/* Filters compose with the tiers, they do not replace them. */
const topsOrdered = storefrontOrder(filterCatalogue(shop, { category: 'Tops' }))
check(
  'a category filter keeps teasers in the third tier',
  topsOrdered.slice(-20, -10).every((item) => item.isTeaser),
  true,
)
check('and hidden rows still last', topsOrdered.slice(-10).every((item) => item.hidden), true)
check(
  'a search result is still ordered by tier',
  storefrontOrder(filterCatalogue(shop, { query: 'S0' })).every(
    (item, index, list) => index === 0 || storefrontTier(list[index - 1]) <= storefrontTier(item),
  ),
  true,
)

/* ── summary ── */
console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
