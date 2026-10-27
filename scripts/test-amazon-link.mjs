/**
 * "View on Amazon" link self-check
 * Run: npm run test:amazon
 *
 * Pure Node — no browser, no database.
 *
 * WHY THIS SUITE EXISTS
 * ─────────────────────
 * The editor offers a link to the listing so photos can be sourced without a
 * detour through the storefront. Two things about it are easy to get wrong and
 * neither fails loudly:
 *
 *   1. the ASIN goes into an `href`. A value that is blank, truncated, or
 *      carrying a quote must produce NO link — never a URL that lands on
 *      Amazon's home page, and never an injected attribute.
 *   2. "the first valid ASIN" cannot mean `Object.keys(variants)[0]`.
 *      `asins.variants` is jsonb, so Postgres hands the keys back sorted by
 *      length then bytes — an order that changes with the data, not with the
 *      product. Section [4] pins the link to the order the panel RENDERS:
 *      colours as declared, sizes smallest → largest.
 */

import { AMAZON_DP_BASE, amazonUrl, asinOf, firstListing } from '../src/utils/amazon.js'
import { combinationsOf } from '../src/utils/soldOut.js'

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

/* ── 1. the URL ──────────────────────────────────────────────────────────── */

console.log('\n[1] URL shape')

check('a 10-character ASIN builds a /dp/ URL', amazonUrl('B0C1D2E3F4'), `${AMAZON_DP_BASE}B0C1D2E3F4`)
check('the base is amazon.com/dp/', AMAZON_DP_BASE, 'https://www.amazon.com/dp/')

check('a lowercase paste is uppercased, not rejected', amazonUrl('b0c1d2e3f4'), `${AMAZON_DP_BASE}B0C1D2E3F4`)
check('surrounding whitespace is trimmed', amazonUrl('  B0C1D2E3F4\n'), `${AMAZON_DP_BASE}B0C1D2E3F4`)
check('a full-width space is trimmed too', amazonUrl('\u3000B0C1D2E3F4'), `${AMAZON_DP_BASE}B0C1D2E3F4`)

/* The value is pasted, so it can be anything. None of these may become a URL. */
check('empty string → no link', amazonUrl(''), null)
check('whitespace only → no link', amazonUrl('   '), null)
check('null → no link', amazonUrl(null), null)
check('undefined → no link', amazonUrl(undefined), null)
check('9 characters → no link', amazonUrl('B0C1D2E3F'), null)
check('11 characters → no link', amazonUrl('B0C1D2E3F45'), null)
check('a hyphen is not alphanumeric → no link', amazonUrl('B0C1D2E3F-'), null)
check('an inner space → no link', amazonUrl('B0C1D2E3 F'), null)
check('a quote cannot escape the attribute', amazonUrl('B0C1" onclick="x'), null)
check('a tag cannot escape the attribute', amazonUrl('<script>alert(1)'), null)
check('a URL pasted by mistake → no link', amazonUrl('https://amazon.com/dp/B0C1D2E3F4'), null)

console.log('\n[2] asinOf')

check('returns the cleaned ASIN', asinOf(' b0c1d2e3f4 '), 'B0C1D2E3F4')
check('returns "" rather than null for junk', asinOf('nope'), '')
check('a number is stringified then tested', asinOf(1234567890), '1234567890')

/* ── 3. picking the row ──────────────────────────────────────────────────── */

console.log('\n[3] firstListing')

const rowsOf = (pairs) => pairs.map(([key, asin]) => ({ key, label: key.replace('|', ' / '), asin }))

check('no rows → null', firstListing([]), null)
check('nothing at all → null', firstListing(null), null)
check('a non-array → null', firstListing({ a: 1 }), null)

check(
  'picks the first row that has an ASIN',
  firstListing(rowsOf([['Black|S', 'B0BLACK001'], ['Black|M', 'B0BLACK002']]))?.asin,
  'B0BLACK001',
)
check(
  'skips a blank row instead of stopping on it',
  firstListing(rowsOf([['Black|S', ''], ['Black|M', 'B0BLACK002']]))?.asin,
  'B0BLACK002',
)
check(
  'skips a truncated ASIN rather than linking to the wrong listing',
  firstListing(rowsOf([['Black|S', 'B0BLACK'], ['Black|M', 'B0BLACK002']]))?.asin,
  'B0BLACK002',
)
check(
  'the label travels with the link, so the operator knows which variant it is',
  firstListing(rowsOf([['Black|M', 'B0BLACK002']]))?.label,
  'Black / M',
)
check(
  'and the URL is built, not just the ASIN',
  firstListing(rowsOf([['Black|M', 'b0black002']]))?.url,
  `${AMAZON_DP_BASE}B0BLACK002`,
)
check(
  'all rows unusable → null',
  firstListing(rowsOf([['Black|S', ''], ['Black|M', 'x']])),
  null,
)

/* ── 4. "first" is the render order, not the stored key order ────────────── */

console.log('\n[4] first means the order on screen')

const specs = { Colour: ['Black', 'Navy', 'Oatmeal'], Size: ['M', 'S', 'L'] }

/* The panel shows colours as declared and sizes smallest → largest, which is
 * exactly what `combinationsOf` produces. Build the rows the editor builds. */
const rowsFor = (variants) =>
  combinationsOf({ specs }).map((combo) => {
    const hit = Object.keys(variants).find((key) => key.toLowerCase() === combo.key.toLowerCase())
    return { key: hit || combo.key, label: [combo.colour, combo.size].filter(Boolean).join(' / '), asin: (hit && variants[hit]) || '' }
  })

/* Sizes stored out of order — the common case in this catalogue. The panel
 * sorts them for display; the link must follow the display. */
check(
  'the row order is colour-major, then smallest → largest',
  combinationsOf({ specs }).map((combo) => combo.key).slice(0, 3),
  ['Black|S', 'Black|M', 'Black|L'],
)

const onePerColour = {
  'Oatmeal|S': 'B0OATMEAL1',
  'Navy|S': 'B0NAVY0001',
  'Black|S': 'B0BLACK001',
}

/* jsonb does not keep insertion order: keys come back sorted by length, then
 * bytewise — so `Navy|S` (6 chars) lands BEFORE `Black|S` (7), which is what a
 * naive `Object.entries(...)[0]` would pick. */
const asJsonbHandsItBack = {
  'Navy|S': 'B0NAVY0001',
  'Black|S': 'B0BLACK001',
  'Oatmeal|S': 'B0OATMEAL1',
}
check(
  'storage order is NOT the panel order (this is the bug being avoided)',
  Object.entries(asJsonbHandsItBack)[0],
  ['Navy|S', 'B0NAVY0001'],
)
check(
  'the link ignores key order and follows the list — Black is first',
  firstListing(rowsFor(asJsonbHandsItBack))?.asin,
  'B0BLACK001',
)
check(
  'and the same map in another key order gives the same answer',
  firstListing(rowsFor(onePerColour))?.asin,
  firstListing(rowsFor(asJsonbHandsItBack))?.asin,
)

/* Black has no ASIN at all — the first USABLE one is Navy's, not a blank. */
const blackEmpty = { 'Black|S': '', 'Black|M': '', 'Navy|M': 'B0NAVY0002' }
check('a colour with no ASINs does not produce a link', firstListing(rowsFor(blackEmpty))?.asin, 'B0NAVY0002')
check('and the label names the colour it actually points at', firstListing(rowsFor(blackEmpty))?.label, 'Navy / M')

/* Rows whose keys are not in the options any more (a deleted colour) are passed
 * after the live rows, so they can only win when nothing live is filled in. */
const extra = [{ key: 'ZZ|M', label: 'ZZ / M', asin: 'B0LEGACY01' }]
check(
  'a live row beats a leftover key',
  firstListing([...rowsFor({ 'Navy|M': 'B0NAVY0002' }), ...extra])?.asin,
  'B0NAVY0002',
)
check(
  'and a leftover key is used when nothing live is filled in',
  firstListing([...rowsFor({}), ...extra])?.asin,
  'B0LEGACY01',
)

/* A typed-but-unsaved ASIN is in `mergedAsins`, which is what the rows read —
 * so the link appears without a save. */
check(
  'an ASIN typed into the panel is enough to build the link',
  firstListing(rowsFor({ 'Black|S': 'B0TYPED001' }))?.url,
  `${AMAZON_DP_BASE}B0TYPED001`,
)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
