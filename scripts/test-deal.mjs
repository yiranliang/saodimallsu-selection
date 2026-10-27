/**
 * Limited Deal (Flash Sale) self-check
 *   node scripts/test-deal.mjs
 *
 * Pure Node — no browser, no network, no database. Six places the feature has to
 * hold or the promise breaks:
 *
 *   [1] parseLocalTime  — the formats an operator actually types, and the dirty
 *                         ones that must NOT silently roll over
 *   [2] isDealActive    — the window, inclusive on both ends of the decision,
 *                         and every incomplete/invalid shape being inert
 *   [3] dealStatus      — what the editor shows before saving
 *   [4] prices          — verbatim text, one `$`, never a float round trip
 *   [5] countdown       — HH:MM:SS, long windows, zero/negative
 *   [6] badgeFor        — Coming Soon > ⚡ Limited Deal > tag, and nothing else
 *   [7] mapping         — five text columns survive a round trip, and a product
 *                         without a deal grows no keys
 */

import {
  DEAL_BADGE,
  DEAL_BUCKETS,
  DEALS_TAB,
  autoDiscountLabel,
  autoDiscountLabelFor,
  badgeFor,
  badgeStackFor,
  BADGE_ZONE,
  campaignKey,
  countdownDisplay,
  isSameCampaign,
  tagPlacementOf,
  DEALS_TAB_DEFAULT_LABEL,
  DEALS_TAB_LABEL_MAX,
  normaliseDealsTabLabel,
  bucketCountsOf,
  bucketOf,
  dealPhase,
  dealPriceInfo,
  dealStatus,
  dealWindow,
  dealsOrder,
  discountOf,
  discountPercents,
  filterDeals,
  formatCountdown,
  formatPrice,
  formatPriceText,
  isDealActive,
  legacyDealTimes,
  numbersOf,
  parseLocalTime,
  parsePercentLabel,
  parsePriceRange,
} from '../src/utils/deal.js'
import { isTeaser } from '../src/utils/teaser.js'
import { ACC_BADGE } from '../src/utils/acc.js'
import { badgeContrast, badgeTextColor } from '../src/utils/badge.js'
import { productToRow, rowToProduct } from '../src/store/mapping.js'

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

/* A fixed clock so nothing here depends on when the suite runs. Built with the
 * local constructor on purpose — the whole feature is local-time. */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime()
const START = at(2026, 10, 28, 10, 0)
const END = at(2026, 10, 30, 22, 0)

const dealProduct = (over = {}) => ({
  id: 'p900',
  name: 'Deal piece',
  saleStart: '2026-10-28T10:00',
  saleEnd: '2026-10-30T22:00',
  salePrice: '19.99',
  originalPrice: '39.99',
  discountLabel: '50% OFF',
  ...over,
})

/* ── 1. parsing ── */
console.log('\n[1] parseLocalTime — what an operator types')

check('the documented form', parseLocalTime('2026-10-28T10:00'), START)
check('a space instead of T (V8 accepts it, Safari does not)', parseLocalTime('2026-10-28 10:00'), START)
check('seconds', parseLocalTime('2026-10-28T10:00:00'), START)
check('slashes', parseLocalTime('2026/10/28 10:00'), START)
check('date only → local midnight', parseLocalTime('2026-10-28'), at(2026, 10, 28))
check('leading/trailing spaces are trimmed', parseLocalTime('  2026-10-28T10:00  '), START)
check('lowercase t', parseLocalTime('2026-10-28t10:00'), START)

check('empty string', parseLocalTime(''), null)
check('whitespace', parseLocalTime('   '), null)
check('null', parseLocalTime(null), null)
check('undefined', parseLocalTime(undefined), null)
check('prose', parseLocalTime('next tuesday'), null)
check('month 13 does not roll into next year', parseLocalTime('2026-13-01T10:00'), null)
check('Feb 31 does not roll into March', parseLocalTime('2026-02-31T10:00'), null)
check('hour 24 does not roll into tomorrow', parseLocalTime('2026-10-28T24:00'), null)
check('minute 60', parseLocalTime('2026-10-28T10:60'), null)

/* An explicit offset is still honoured — somebody may want an absolute moment.
 * That is the ONLY path that involves a timezone, and it is opt-in by writing
 * a `Z` or an offset. */
check(
  'an explicit Z is respected, not reinterpreted',
  parseLocalTime('2026-10-28T10:00:00Z'),
  Date.UTC(2026, 9, 28, 10, 0, 0),
)

/* ── 2. the window ── */
console.log('\n[2] isDealActive — left-closed, right-open')

const deal = dealProduct()

check('before the start', isDealActive(deal, START - 1000), false)
check('the exact start second counts', isDealActive(deal, START), true)
check('the middle', isDealActive(deal, at(2026, 10, 29, 12)), true)
check('one second before the end', isDealActive(deal, END - 1000), true)
check('the end second does not', isDealActive(deal, END), false)
check('after the end', isDealActive(deal, END + 1000), false)

check('no start at all', isDealActive(dealProduct({ saleStart: '' }), START), false)
check('no end at all', isDealActive(dealProduct({ saleEnd: null }), START), false)
check('neither', isDealActive({ id: 'p1' }, START), false)
check('a broken start is inert, not "always on"', isDealActive(dealProduct({ saleStart: 'soon' }), START), false)
check('a broken end is inert too', isDealActive(dealProduct({ saleEnd: 'later' }), START), false)
check('end before start never activates', isDealActive(dealProduct({ saleEnd: '2026-10-27T10:00' }), START), false)

/* A deal that has not opened yet must not leak a price or a badge — this is the
 * "I scheduled it and it showed up early" bug. */
check('scheduled is not active', isDealActive(dealProduct(), START - 86_400_000), false)

const window = dealWindow(deal, at(2026, 10, 30, 21, 0))
check('the window reports the end', window.endsAt, END)
check('and what is left', window.msLeft, END - at(2026, 10, 30, 21, 0))
check('msLeft never goes negative', dealWindow(deal, END + 60_000).msLeft, 0)
check('no window without both times', dealWindow({ id: 'p1' }), null)

/* ── 3. editor status ── */
console.log('\n[3] dealStatus — the line the editor shows before saving')

check('nothing filled', dealStatus({}), 'off')
check('only a price, no window', dealStatus({ salePrice: '19.99' }), 'off')
check('a start but no end', dealStatus({ saleStart: '2026-10-28T10:00' }), 'incomplete')
check('an end but no start', dealStatus({ saleEnd: '2026-10-30T22:00' }), 'incomplete')
check('a typo', dealStatus({ saleStart: 'tomorrow', saleEnd: '2026-10-30T22:00' }), 'incomplete')
check('end before start', dealStatus({ saleStart: '2026-10-30T22:00', saleEnd: '2026-10-28T10:00' }), 'invalid')
check('before the window', dealStatus(deal, START - 1000), 'scheduled')
check('inside the window', dealStatus(deal, START), 'live')
check('after the window', dealStatus(deal, END), 'ended')

/* ── 4. prices ── */
console.log('\n[4] Prices — verbatim text, ranges become $a – $b')

check('a bare number gets a dollar sign', formatPrice('19.99'), '$19.99')
check('an already-symbolised price is untouched', formatPrice('$19.99'), '$19.99')
check('so is another currency', formatPrice('€19.99'), '€19.99')
check('integers are not reformatted', formatPrice('20'), '$20')
check('trailing zeros survive', formatPrice('19.90'), '$19.90')
check('an empty price', formatPrice(''), '')
check('null', formatPrice(null), '')
check('whitespace is trimmed', formatPrice('  19.99 '), '$19.99')

/* The point of not using parseFloat: a price the operator typed must come back
 * as the same characters, not as the nearest double. */
check('no float round trip', formatPrice('19.989999999999998'), '$19.989999999999998')
check('a thousands separator survives on a single price', formatPrice('1,299'), '$1,299')

/* Ranges: the text is not recomputed, only the currency symbol is added to each
 * end. An en dash, because a hyphen at 14px next to a minus-looking range is
 * ambiguous. */
check('a spaced range', formatPriceText('15 - 25'), '$15 – $25')
check('a tight range', formatPriceText('15-25'), '$15 – $25')
check('a range with symbols already on it', formatPriceText('$15-$25'), '$15 – $25')
check('a range written high-to-low is normalised', formatPriceText('25-15'), '$15 – $25')
check('a single price is passed through unchanged', formatPriceText('19.99'), '$19.99')
check('empty range', formatPriceText(''), '')
check('a range of three numbers collapses to min/max', formatPriceText('10/20/30'), '$10 – $30')

const info = dealPriceInfo(deal)
check('the sale price', info.price, '$19.99')
check('the struck price', info.was, '$39.99')
check('the computed label', info.label, '50% OFF')
check('and the numbers behind it', [info.min, info.max], [50, 50])
check('and the bucket', info.bucket, '40+')
check(
  'no sale price → no price block at all',
  dealPriceInfo(dealProduct({ salePrice: '' })),
  null,
)
check(
  'a range price renders as a range',
  dealPriceInfo(dealProduct({ salePrice: '15 - 25', originalPrice: '30 - 50' })).price,
  '$15 – $25',
)
check(
  'no original price → no strikethrough, but a price remains',
  dealPriceInfo(dealProduct({ originalPrice: '' })).was,
  '',
)

/* ── 4b. the discount is computed from the prices ── */
console.log('\n[4b] Discount from prices — low-to-low, high-to-high')

check('a single pair', autoDiscountLabelFor('39.99', '29.99'), '25% OFF')
/* The example from the brief: both ends are exactly 50%, so the honest answer is
 * 50%, not "20% - 50%". */
check('30-50 → 15-25 is 50% at both ends', autoDiscountLabelFor('30 - 50', '15 - 25'), '50% OFF')
check('30-50 → 15-40 really is a spread', autoDiscountLabelFor('30-50', '15-40'), '20% - 50% OFF')
check('a range against a single price', autoDiscountLabelFor('30-50', '20'), '33% - 60% OFF')
check('half price', autoDiscountLabelFor('100', '50'), '50% OFF')
check('no discount at all', autoDiscountLabelFor('100', '100'), '')
check('a price above the original never prints a negative', autoDiscountLabelFor('100', '120'), '')
check('missing original', autoDiscountLabelFor('', '20'), '')
check('missing sale', autoDiscountLabelFor('100', ''), '')
check('original of zero does not divide by zero', autoDiscountLabelFor('0', '10'), '')
check('prose is ignored', autoDiscountLabelFor('about thirty', '20'), '')
check('a huge discount is capped at 99%', autoDiscountLabelFor('100', '0.5'), '99% OFF')

check('numbersOf drops spaces and thousands commas', numbersOf(' 1,299 - 1,499 '), [1299, 1499])
check('numbersOf on prose', numbersOf('none'), [])
check('parsePriceRange normalises order', parsePriceRange('25 - 15'), { low: 15, high: 25 })
check('parsePriceRange on one number', parsePriceRange('19.99'), { low: 19.99, high: 19.99 })
check('discountPercents on a spread', discountPercents('30-50', '15-40'), { min: 20, max: 50 })

/* The manual label wins — and the bucket follows the label, so the card and the
 * filter chip cannot disagree. */
check('a manual label beats the computed one', discountOf(dealProduct({ discountLabel: '70% OFF' })).label, '70% OFF')
check('and it is marked as manual', discountOf(dealProduct({ discountLabel: '70% OFF' })).source, 'manual')
check('its numbers feed the bucket', bucketOf(discountOf(dealProduct({ discountLabel: '70% OFF' })).max), '40+')
check('a manual range label', discountOf(dealProduct({ discountLabel: '15% - 35% OFF' })).max, 35)
check('computed when there is no label', discountOf(dealProduct({ discountLabel: '' })).source, 'computed')
check('nothing when there are no prices either', discountOf({ id: 'p1' }).source, 'none')
check('no % in the label → not a discount label', parsePercentLabel('2 for $50'), null)
check('only numbers glued to % count', parsePercentLabel('2 FOR 50%'), { min: 50, max: 50 })
check('a label range', parsePercentLabel('20% - 50% OFF'), { min: 20, max: 50 })

/* ── 5. countdown ── *//* ── 5. countdown ── */
console.log('\n[5] Countdown — HH:MM:SS, and no way to show a negative')

check('one hour', formatCountdown(3_600_000), '01:00:00')
check('a mixed value', formatCountdown((2 * 3600 + 34 * 60 + 56) * 1000), '02:34:56')
check('under a second', formatCountdown(400), '00:00:00')
check('zero', formatCountdown(0), '00:00:00')
check('negative clamps to zero', formatCountdown(-5000), '00:00:00')
check('NaN clamps to zero', formatCountdown(NaN), '00:00:00')
check('a three-day sale is not wrapped to 23:xx', formatCountdown(71 * 3600 * 1000), '71:00:00')
check('a short window pads to two digits', formatCountdown(9 * 1000), '00:00:09')

/* ── 6. the badge stack ── */
console.log('\n[6] badgeStackFor — two rows, three surfaces')

const texts = (product, now = START, opts) => badgeStackFor(product, now, opts).map((e) => e.text)
const onCard = (product, now = START) => texts(product, now, { zone: BADGE_ZONE.CATALOGUE })
const onDeals = (product, now = START) => texts(product, now, { zone: BADGE_ZONE.DEALS })
const onDetail = (product, now = START) => texts(product, now, { zone: BADGE_ZONE.DETAIL })

/* ── 常规货架：身份 + 强推，不出折扣 ── */
check('catalogue: a live deal wears its identity only', onCard(deal), ['Limited Deal'])
check('catalogue: the identity is the deal red', badgeStackFor(deal, START)[0].value, DEAL_BADGE.value)
check('catalogue: no discount line at all', onCard(deal).some((v) => v.includes('OFF')), false)
check(
  'catalogue: a hand-typed label rides underneath',
  onCard(dealProduct({ tag: 'Highly Recommend' })),
  ['Limited Deal', 'Highly Recommend'],
)

/* ── 专区：不重复 Limited Deal，第二行才是折扣 ── */
check('deals: the identity line is suppressed', onDeals(deal), ['50% OFF'])
check('deals: kind says it is the discount', badgeStackFor(deal, START, { zone: BADGE_ZONE.DEALS })[0].kind, 'discount')
check(
  'deals: a campaign takes the first line, the number the second',
  onDeals({ ...deal, subTag: 'Black Friday', subBadgeColor: '#2B2B2B' }),
  ['Black Friday', '50% OFF'],
)
check(
  'deals: a plain label also takes the first line',
  onDeals({ ...deal, tag: 'Highly Recommend' }),
  ['Highly Recommend', '50% OFF'],
)
check(
  'deals: no campaign and no label leaves just the number',
  onDeals(deal).length,
  1,
)

/* ── 详情：完整信息 ── */
check('detail: identity then discount', onDetail(deal), ['Limited Deal', '50% OFF'])
check(
  'detail: a campaign outranks the derived deal',
  onDetail({ ...deal, subTag: 'Black Friday', subBadgeColor: '#2B2B2B' }),
  ['Black Friday', '50% OFF'],
)
check('detail: no emoji anywhere', onDetail(deal).some((v) => /[⚡🔥💰]/.test(v)), false)

/* ── Coming Soon 独占 ── */
check(
  'a teaser beats a plain label',
  onCard(dealProduct({ isTeaser: true, tag: 'Best-seller' })),
  ['Coming Soon'],
)
check('and it never gets a second line', onCard({ ...deal, isTeaser: true }).length, 1)

/* ── ACC 只在详情出现 ── */
check('ACC is not on catalogue cards', onCard({ hasAcc: true, tag: 'New' }), ['New'])
check('nor on deal cards', onDeals({ ...deal, hasAcc: true }), ['50% OFF'])
check('but it does show in the detail sheet', onDetail({ hasAcc: true })[0], ACC_BADGE.text)

/* Scheduled deals are not an afterthought: the deals tab shows them, so their
 * cards must look like deals instead of falling back to a label. */
check('a scheduled deal still counts as a deal', onCard(deal, START - 1000), ['Limited Deal'])
check('an ended deal is a normal product again', badgeStackFor(deal, END + 1000), [])
check('no badge at all', badgeStackFor({}), [])
check('never more than two rows', onCard({ ...deal, tag: 'New', subTag: 'Black Friday' }).length, 2)

/* ── 落位：批量角标弹窗要回答"新标排第几" ── */
check('a plain product puts a new tag first', tagPlacementOf({}), 'first')
check('a campaign pushes it to the second line', tagPlacementOf({ subTag: 'Black Friday' }), 'second')
/* 秒杀把普通标压到第二行，但**看得见** —— 常规目录的第二行本来就是标，
 * 专区里它还会升到第一行。旧版把这种情况报成"前台看不到"，运营点完发现
 * 它明明在，从此不再相信那个数字。 */
check('a live deal pushes it down, not out', tagPlacementOf(deal, START), 'second')
check('Coming Soon is the only thing that hides it', tagPlacementOf({ isTeaser: true }), 'hidden')
/* 覆盖模式写的是活动标槽位，所以永远是第一行 —— 这正是弹窗承诺的效果。 */
check('the campaign slot is always the first line', tagPlacementOf(deal, START, { overwrite: true }), 'first')
check('even next to a campaign already there', tagPlacementOf({ subTag: 'Cyber Monday' }, START, { overwrite: true }), 'first')
check('but Coming Soon still owns its line', tagPlacementOf({ isTeaser: true }, START, { overwrite: true }), 'hidden')

/* ── 活动名归一：专区和角标是两个输入框，永远不可能逐字相等 ── */
check('a name collapses case and spacing', campaignKey('Black  Friday'), 'blackfriday')
check('the emoji the operator typed is not part of the name', campaignKey('🔥Black Friday'), 'blackfriday')
check('the generic suffix is not either', campaignKey('Black Friday Deals'), 'blackfriday')
check('and neither is the plural deal word', campaignKey('Limited Deals'), 'limited')
check('which makes "Limited Deal" the same campaign', isSameCampaign('Limited Deal', 'Limited Deals'), true)
/* `50% OFF` 必须留在原地：剥掉 `off` 会让它和任何 `50` 撞车。 */
check('a percentage label is not a campaign tail', campaignKey('50% OFF'), '50off')
check('so it never matches its own number', isSameCampaign('50% OFF', '50'), false)
check('two different campaigns stay different', isSameCampaign('Black Friday', 'Cyber Monday'), false)
check('empty never matches', isSameCampaign('', 'Black Friday'), false)

/* ── 专区里不重复挂自己的名字 ── */
const BF = '🔥Black Friday'
check(
  'the catalogue keeps the campaign badge',
  texts({ ...deal, subTag: 'Black Friday' }, START, {
    zone: BADGE_ZONE.CATALOGUE,
    campaign: BF,
  }),
  ['Black Friday'],
)
check(
  'inside its own tab the name is redundant',
  texts({ ...deal, subTag: 'Black Friday' }, START, { zone: BADGE_ZONE.DEALS, campaign: BF }),
  ['50% OFF'],
)
check(
  'the plain tag equal to the tab is dropped too',
  texts({ ...deal, tag: 'Black Friday' }, START, { zone: BADGE_ZONE.DEALS, campaign: BF }),
  ['50% OFF'],
)
check(
  'a different label still takes the first line',
  texts({ ...deal, tag: 'Highly Recommend', subTag: 'Black Friday' }, START, {
    zone: BADGE_ZONE.DEALS,
    campaign: BF,
  }),
  ['Highly Recommend', '50% OFF'],
)
check(
  'without the tab name nothing is dropped',
  texts({ ...deal, subTag: 'Black Friday' }, START, { zone: BADGE_ZONE.DEALS }),
  ['Black Friday', '50% OFF'],
)
check(
  'the tab name is ignored on the catalogue',
  texts({ ...deal, subTag: 'Black Friday' }, START, {
    zone: BADGE_ZONE.CATALOGUE,
    campaign: BF,
  }),
  ['Black Friday'],
)

/* ── 范围 / 手填文案 ── */
check(
  'a range deal puts the range on the discount line',
  onDetail(dealProduct({ salePrice: '15-25', originalPrice: '30-50', discountLabel: '' })),
  ['Limited Deal', '50% OFF'],
)
check(
  'a manual label is the discount line, word for word',
  onDetail(dealProduct({ discountLabel: '70% OFF' })),
  ['Limited Deal', '70% OFF'],
)

/* Contrast: the deal pill is white text on #C62828, the same bar the five
 * badge templates are held to. */
check(
  'the deal badge passes WCAG AA against the text colour it will actually use',
  badgeContrast(DEAL_BADGE.value, badgeTextColor(DEAL_BADGE.value)) >= 4.5,
  true,
)

/* ── 7. mapping ── *//* ── 7. mapping ── */
console.log('\n[7] Mapping — five text columns, verbatim')

const row = productToRow(deal)
check('sale_start', row.sale_start, '2026-10-28T10:00')
check('sale_end', row.sale_end, '2026-10-30T22:00')
check('sale_price', row.sale_price, '19.99')
check('original_price', row.original_price, '39.99')
check('discount_label', row.discount_label, '50% OFF')
check('nothing was turned into a Date', typeof row.sale_start, 'string')
check('no camelCase leaks to the database', 'saleStart' in row, false)

const back = rowToProduct({ ...row, id: 'p901' })
check('round trip keeps the start', back.saleStart, '2026-10-28T10:00')
check('round trip keeps the label', back.discountLabel, '50% OFF')

const none = productToRow({ id: 'p902', name: 'No deal' })
check('an unset field is NULL, not an empty string', none.sale_start, null)
check('all five behave the same', [none.sale_start, none.sale_end, none.sale_price, none.original_price, none.discount_label], [null, null, null, null, null])
const noneBack = rowToProduct({ ...none, id: 'p902' })
check(
  'a product without a deal grows no deal keys',
  ['saleStart', 'saleEnd', 'salePrice', 'originalPrice', 'discountLabel'].filter((key) => key in noneBack),
  [],
)
check('whitespace-only is also NULL', productToRow({ id: 'p903', saleStart: '   ' }).sale_start, null)
check('a deal product is not a teaser', isTeaser(row), false)

/* ── 8. dealPhase ── */
console.log('\n[8] dealPhase — off / scheduled / live / ended')

check('no window', dealPhase({ id: 'p1' }, START), 'off')
check('a broken date', dealPhase(dealProduct({ saleStart: 'soon' }), START), 'off')
check('before the start', dealPhase(deal, START - 1000), 'scheduled')
check('at the start second', dealPhase(deal, START), 'live')
check('in the middle', dealPhase(deal, at(2026, 10, 29, 12)), 'live')
check('at the end second', dealPhase(deal, END), 'ended')
check('after the end', dealPhase(deal, END + 1000), 'ended')

check('a scheduled window knows how long until it opens', dealWindow(deal, START - 60_000).msUntilStart, 60_000)
check('a live window has nothing left to wait for', dealWindow(deal, START).msUntilStart, 0)

/* ── 9. discount buckets ── */
console.log('\n[9] bucketOf — left-closed, right-open, max discount')

check('four bands', DEAL_BUCKETS.length, 4)
check('and a sentinel that cannot collide with a real category', DEALS_TAB.startsWith('__'), true)

check('9% is not a good deal', bucketOf(9), null)
check('9.9% is not either', bucketOf(9.9), null)
check('10% enters the first band', bucketOf(10), '10-20')
check('19% stays in it', bucketOf(19), '10-20')
check('exactly 20% is the next band', bucketOf(20), '20-30')
check('29% stays', bucketOf(29), '20-30')
check('30% is the next band', bucketOf(30), '30-40')
check('39% stays', bucketOf(39), '30-40')
check('40% is the top band', bucketOf(40), '40+')
check('75% is still the top band', bucketOf(75), '40+')
check('nothing to bucket', bucketOf(0), null)
check('NaN', bucketOf(NaN), null)
check('a string number still buckets', bucketOf('35'), '30-40')

/* The band follows the number the badge prints, not a second computation. */
check(
  'a 25% deal lands in 20-30',
  bucketOf(discountOf(dealProduct({ discountLabel: '', originalPrice: '40', salePrice: '30' })).max),
  '20-30',
)
check(
  'a manual 70% label moves it to 40+',
  bucketOf(discountOf(dealProduct({ discountLabel: '70% OFF' })).max),
  '40+',
)

/* ── 10. the deals view ── */
console.log('\n[10] filterDeals / dealsOrder')

const liveEarly = dealProduct({ id: 'd1', saleStart: '2026-10-28T10:00', saleEnd: '2026-10-28T12:00' })
const liveLate = dealProduct({ id: 'd2', saleStart: '2026-10-28T10:00', saleEnd: '2026-10-30T22:00' })
const scheduledSoon = dealProduct({ id: 'd3', saleStart: '2026-10-28T11:00', saleEnd: '2026-10-28T13:00' })
const scheduledLater = dealProduct({ id: 'd4', saleStart: '2026-10-29T09:00', saleEnd: '2026-10-29T20:00' })
const ended = dealProduct({ id: 'd5', saleStart: '2026-10-01T10:00', saleEnd: '2026-10-02T10:00' })
const plain = { id: 'd6', name: 'No deal', tag: '' }

const pool = [ended, scheduledLater, liveLate, plain, scheduledSoon, liveEarly]
const now = at(2026, 10, 28, 10, 30)

/* `filterDeals` only filters — it keeps the incoming order (dealsOrder is what
 * sorts). Input order is [d5, d4, d2, d6, d3, d1]. */
check('only live + scheduled survive, in input order', filterDeals(pool, now).map((p) => p.id), ['d4', 'd2', 'd3', 'd1'])
check('an ended deal is not in the tab', filterDeals(pool, now).some((p) => p.id === 'd5'), false)
check('a product without a window is not in the tab', filterDeals(pool, now).some((p) => p.id === 'd6'), false)
check('empty in, empty out', filterDeals([], now), [])
check('non-array in', filterDeals(null, now), [])
/* Coming Soon is dropped even with a live window: it cannot be bought. */
check(
  'a teaser never reaches the deals tab',
  filterDeals([{ ...liveEarly, isTeaser: true }], now),
  [],
)
check(
  'and the ordering agrees',
  dealsOrder([{ ...liveEarly, isTeaser: true }], now),
  [],
)

/* Urgency order: live by soonest end, then scheduled by soonest start. Inside a
 * tab that exists for time-limited offers, "ending in 90 minutes" belongs first. */
check('live ending soonest comes first', dealsOrder(pool, now).map((p) => p.id), ['d1', 'd2', 'd3', 'd4'])
check('an ended deal is dropped by the ordering too', dealsOrder(pool, now).length, 4)
check('and a plain product as well', dealsOrder([plain], now), [])

/* A tie must keep the incoming order (the admin's drag order), not flip. */
const tieA = dealProduct({ id: 't1', saleStart: '2026-10-28T10:00', saleEnd: '2026-10-28T12:00' })
const tieB = dealProduct({ id: 't2', saleStart: '2026-10-28T10:00', saleEnd: '2026-10-28T12:00' })
check('equal end times keep drag order', dealsOrder([tieA, tieB], now).map((p) => p.id), ['t1', 't2'])
check('and the other way round', dealsOrder([tieB, tieA], now).map((p) => p.id), ['t2', 't1'])
check('the input array is untouched', pool.map((p) => p.id), ['d5', 'd4', 'd2', 'd6', 'd3', 'd1'])

/* A scheduled deal becomes live without a reload — same list, later clock. */
/* At 11:30 d3 has opened too, and the live block is ordered by END: d1 (12:00),
 * d3 (13:00), d2 (in two days). */
check(
  'the same pool an hour later has one more live deal',
  dealsOrder(pool, at(2026, 10, 28, 11, 30)).map((p) => p.id),
  ['d1', 'd3', 'd2', 'd4'],
)

/* ── 11. normalisation + band counts ── */
console.log('\n[11] legacy times get normalised · band chips count what the grid shows')

/* The stored shape after one save: start at midnight, end at the last second.
 * Nothing to warn about, so the editor stays quiet. */
check(
  'an already-normalised record has nothing to rewrite',
  legacyDealTimes({ saleStart: '2026-10-28T00:00:00', saleEnd: '2026-10-30T23:59:59' }),
  null,
)
check(
  'a hand-written start time is reported',
  legacyDealTimes({ saleStart: '2026-10-28T10:00', saleEnd: '2026-10-30T23:59:59' }),
  { start: '10:00' },
)
check(
  'a hand-written end time is reported',
  legacyDealTimes({ saleStart: '2026-10-28T00:00:00', saleEnd: '2026-10-30T22:00' }),
  { end: '22:00' },
)
check(
  'both ends, as HH:MM',
  legacyDealTimes({ saleStart: '2026-10-28 10:00:00', saleEnd: '2026-10-30 22:00:00' }),
  { start: '10:00', end: '22:00' },
)
check(
  'slashes and a single-digit hour',
  legacyDealTimes({ saleStart: '2026/10/28 9:30', saleEnd: '' }),
  { start: '09:30' },
)
/* A bare date is what the date input produces — not a legacy value. */
check(
  'date-only values are already normal',
  legacyDealTimes({ saleStart: '2026-10-28', saleEnd: '2026-10-30' }),
  null,
)
/* An explicit offset would need a timezone conversion to report a local time;
 * guessing one is worse than staying silent. Saving still normalises it. */
check(
  'an offset is left alone by the notice',
  legacyDealTimes({ saleStart: '2026-10-28T10:00:00Z', saleEnd: '' }),
  null,
)
check('no deal at all', legacyDealTimes({ saleStart: '', saleEnd: '' }), null)
check('no product at all', legacyDealTimes(null), null)

const countPool = [
  dealProduct({ id: 'c1', originalPrice: '', salePrice: '', discountLabel: '50% OFF' }),
  dealProduct({ id: 'c2', originalPrice: '', salePrice: '', discountLabel: '25% OFF' }),
  dealProduct({ id: 'c3', originalPrice: '', salePrice: '', discountLabel: '30% OFF' }),
  dealProduct({ id: 'c4', originalPrice: '', salePrice: '', discountLabel: '9% OFF' }),
  dealProduct({ id: 'c5', originalPrice: '', salePrice: '', discountLabel: '' }),
]

/* `all` (5) is deliberately bigger than the bands added up (3): the 9% deal and
 * the one with no computable discount are only in All, by decision. */
check('counts per band, with All as the true total', bucketCountsOf(countPool), {
  all: 5,
  '10-20': 0,
  '20-30': 1,
  '30-40': 1,
  '40+': 1,
})
check('exactly 30% is counted in 30-40', bucketCountsOf([countPool[2]])['30-40'], 1)
check('a 9% deal lands in no band', bucketCountsOf([countPool[3]])['10-20'], 0)
check('but it is still a deal', bucketCountsOf([countPool[3]]).all, 1)
check('empty list', bucketCountsOf([]), { all: 0, '10-20': 0, '20-30': 0, '30-40': 0, '40+': 0 })
check('non-array in', bucketCountsOf(null).all, 0)

/* ── 10. the deals tab label ── */
console.log('\n[10] normaliseDealsTabLabel — what the chip is allowed to say')

check('the default', DEALS_TAB_DEFAULT_LABEL, 'Limited Deals')
check('unchanged when already clean', normaliseDealsTabLabel('Black Friday Deals'), 'Black Friday Deals')
check('collapses pasted whitespace', normaliseDealsTabLabel('  Black   Friday  '), 'Black Friday')
check('an emoji is kept, not stripped', normaliseDealsTabLabel('🔥 Black Friday'), '🔥 Black Friday')
check('empty means "back to default"', normaliseDealsTabLabel(''), 'Limited Deals')
check('whitespace only means the same', normaliseDealsTabLabel('   '), 'Limited Deals')
check('null and undefined too', [normaliseDealsTabLabel(null), normaliseDealsTabLabel(undefined)], [
  'Limited Deals',
  'Limited Deals',
])
check(
  'capped at the pill length',
  Array.from(normaliseDealsTabLabel('x'.repeat(80))).length,
  DEALS_TAB_LABEL_MAX,
)
/* Array.from 而不是 .slice：一枚 emoji 是两个 UTF-16 码元，按码元截断会把
 * 最后一枚劈成半个，渲染成一个方块。 */
check(
  'and the cap counts characters, not UTF-16 units',
  Array.from(normaliseDealsTabLabel('🔥'.repeat(40))).length,
  DEALS_TAB_LABEL_MAX,
)

/* ── 12. the countdown label ── */
console.log('\n[12] countdownDisplay — days far away, seconds up close')

const DD = 86400000

check('scheduled, six days out', countdownDisplay('scheduled', 6 * DD), {
  mode: 'days',
  lead: 'Deal starts in',
  value: '6 days',
})
check('live, six days out', countdownDisplay('live', 6 * DD), {
  mode: 'days',
  lead: '',
  value: '6 days left',
})
check('25 hours floors to one day', countdownDisplay('live', 25 * 3600000).value, '1 day left')
check('and it is singular', countdownDisplay('scheduled', 25 * 3600000).value, '1 day')
/* 恰好 24 小时走时钟 —— 需求写的是"<= 24 小时"。 */
check('exactly 24h is still a clock', countdownDisplay('live', DD), {
  mode: 'clock',
  lead: 'Deal ends in',
  value: '24:00:00',
})
check('one second under is a clock too', countdownDisplay('live', DD - 1000).value, '23:59:59')
check('scheduled under a day counts down to the start', countdownDisplay('scheduled', 90 * 60000), {
  mode: 'clock',
  lead: 'Deal starts in',
  value: '01:30:00',
})
check('zero reads 00:00:00, not -1', countdownDisplay('live', 0).value, '00:00:00')
check('negative clamps', countdownDisplay('live', -5000).value, '00:00:00')
check('NaN clamps', countdownDisplay('live', Number.NaN).value, '00:00:00')
check('an ended deal has no countdown', countdownDisplay('ended', 1000), null)
check('nor does a product with no window', countdownDisplay('off', 1000), null)

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
