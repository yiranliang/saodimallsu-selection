/**
 * ACC（Amazon Creator Connections）佣金 self-check
 *   node scripts/test-acc.mjs
 *
 * Pure Node — no browser, no network, no database. Four places the feature has
 * to hold or it silently breaks a promise:
 *
 *   [1] isAcc        — strict true only; a stray string must not put a money
 *                      badge on a product nobody set up a campaign for
 *   [2] badge        — the 💰 template is legible, and does not collide with a
 *                      preset the operator can pick by hand
 *   [3] badge stack  — ACC only in the detail sheet; deal > ACC > tag otherwise
 *   [4] mapping      — has_acc / acc_id survive the row round trip, a product
 *                      without ACC grows no keys, and the ID survives being
 *                      switched off
 */

import { ACC_BADGE, campaignIdOf, isAcc } from '../src/utils/acc.js'
import { BADGE_ZONE, DEAL_BADGE, badgeFor, badgeStackFor } from '../src/utils/deal.js'
import { TEASER_BADGE } from '../src/utils/teaser.js'
import { BADGE_COLOR_PRESETS, badgeContrast, badgeTextColor } from '../src/utils/badge.js'
import { normalizeProduct, productToRow, rowToProduct } from '../src/store/mapping.js'

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

/* Fixed local clock so the priority tests never depend on when they run. */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0).getTime()
const START = at(2026, 10, 28, 10, 0)
const END = at(2026, 10, 30, 22, 0)
const MID = at(2026, 10, 29, 12, 0)

console.log('\n[1] isAcc — the switch is a boolean, not a truthy value')

check('true is on', isAcc({ hasAcc: true }), true)
check('false is off', isAcc({ hasAcc: false }), false)
check('missing is off', isAcc({}), false)
check('the string "true" is off', isAcc({ hasAcc: 'true' }), false)
check('1 is off', isAcc({ hasAcc: 1 }), false)
check('null product is off', isAcc(null), false)
check('a campaign ID alone does not switch it on', isAcc({ accId: 'CAMP-1' }), false)

console.log('\n[2] the 💰 badge')

check('the wording is plain text, no icon', ACC_BADGE.text, 'ACC')
check(
  'it clears 4.5:1 on its computed text colour',
  badgeContrast(ACC_BADGE.value, badgeTextColor(ACC_BADGE.value)) >= 4.5,
  true,
)
check(
  'it does not reuse a colour the operator can pick by hand',
  BADGE_COLOR_PRESETS.some((preset) => preset.value === ACC_BADGE.value),
  false,
)
check('nor Coming Soon’s graphite', ACC_BADGE.value === TEASER_BADGE.value, false)
check('nor the deal red', ACC_BADGE.value === DEAL_BADGE.value, false)

console.log('\n[3] badge stack — ACC lives in the detail sheet only')

/* ACC 只出现在详情页：卡片上那枚在 169px 的宽度里只是噪音，而详情页有一整块
 * ACC 卡片（Campaign ID + 复制按钮）。所以这里的断言全部指定 `detail` 面。 */
const detail = (product, now) => badgeStackFor(product, now, { zone: BADGE_ZONE.DETAIL })
const detailBadge = (product, now) => badgeFor(product, now, { zone: BADGE_ZONE.DETAIL })
const card = (product, now) => badgeStackFor(product, now, { zone: BADGE_ZONE.CATALOGUE })

const liveDeal = {
  hasAcc: true,
  accId: 'CAMP-1',
  saleStart: '2026-10-28T10:00',
  saleEnd: '2026-10-30T22:00',
  salePrice: '19.99',
  originalPrice: '39.99',
  discountLabel: '50% OFF',
  tag: 'New',
}

check('a live deal takes the identity line', detailBadge(liveDeal, MID), {
  text: 'Limited Deal',
  value: DEAL_BADGE.value,
  kind: 'deal',
})
check('the ops label takes the second line — not a discount', detail(liveDeal, MID).map((b) => b.text), [
  'Limited Deal',
  'New',
])
check(
  'a scheduled deal beats ACC too',
  detailBadge(liveDeal, START - 60_000),
  { text: 'Limited Deal', value: DEAL_BADGE.value, kind: 'deal' },
)
check('an ended deal does not', detailBadge(liveDeal, END + 1000), {
  text: ACC_BADGE.text,
  value: ACC_BADGE.value,
  kind: 'acc',
})
check(
  'and its label moves down a line',
  detail(liveDeal, END + 1000).map((b) => b.text),
  [ACC_BADGE.text, 'New'],
)
check('Coming Soon beats ACC', detailBadge({ ...liveDeal, isTeaser: true }, MID), {
  text: TEASER_BADGE.text,
  value: TEASER_BADGE.value,
  kind: 'teaser',
})
check(
  'ACC takes the identity line from the ops tag',
  detailBadge({ hasAcc: true, tag: 'New', badgeColor: '#1F7A55' }),
  { text: ACC_BADGE.text, value: ACC_BADGE.value, kind: 'acc' },
)
check(
  'and the tag survives on the second line',
  detail({ hasAcc: true, tag: 'New', badgeColor: '#1F7A55' }).map((b) => b.text),
  [ACC_BADGE.text, 'New'],
)
check('ACC without an ID still badges', detailBadge({ hasAcc: true, accId: '' }).text, ACC_BADGE.text)
check('no ACC → the tag is back', detailBadge({ tag: 'New', badgeColor: '#1F7A55' }), {
  text: 'New',
  value: '#1F7A55',
  kind: 'tag',
})
check('a product with nothing has no badge', detailBadge({ tag: '' }), null)
/* The switch being off must not leave a hint of the badge behind. */
check('has_acc false is invisible', detailBadge({ hasAcc: false, accId: 'CAMP-1', tag: '' }), null)

/* ── the card surfaces: no ACC, ever ── */
check('catalogue cards never wear ACC', card({ hasAcc: true, tag: '' }), [])
check('a labelled ACC product shows only the label', card({ hasAcc: true, tag: 'New' }).map((b) => b.text), ['New'])
check(
  'deal cards do not wear it either',
  card({ ...liveDeal, tag: '' }, MID).map((b) => b.text),
  ['Limited Deal'],
)

console.log('\n[4] campaignIdOf')

check('trims the paste', campaignIdOf({ accId: '  CAMP-9  ' }), 'CAMP-9')
check('missing → empty', campaignIdOf({}), '')
check('null → empty', campaignIdOf({ accId: null }), '')
check('a number is stringified', campaignIdOf({ accId: 12345 }), '12345')
check('null product → empty', campaignIdOf(null), '')

console.log('\n[5] mapping — two columns, one switch')

const accProduct = { id: 'a1', sku: 'ACC-1', name: 'ACC piece', hasAcc: true, accId: ' CAMP-7 ' }
const row = productToRow(accProduct)
check('has_acc lands in the row', row.has_acc, true)
check('acc_id is trimmed', row.acc_id, 'CAMP-7')

const back = rowToProduct({ ...row, id: 'a1' })
check('the switch survives the round trip', back.hasAcc, true)
check('the ID survives', back.accId, 'CAMP-7')
check('and the badge comes with it', detailBadge(back).text, ACC_BADGE.text)

/* Off must write `false`, not "omit and let the default decide". */
const offRow = productToRow({ id: 'a2', name: 'No ACC' })
check('a product without ACC writes has_acc false', offRow.has_acc, false)
check('and a null acc_id', offRow.acc_id, null)
check('reading it back is off', isAcc(rowToProduct({ ...offRow, id: 'a2' })), false)
check('with no badge', badgeFor(rowToProduct({ ...offRow, id: 'a2' })), null)

/* Turning the switch off keeps the ID: it cannot be regenerated. */
const keptRow = productToRow({ id: 'a3', name: 'Paused', hasAcc: false, accId: 'CAMP-3' })
check('switching off keeps acc_id', keptRow.acc_id, 'CAMP-3')
check('and stores the switch as false', keptRow.has_acc, false)
check('so nothing shows', isAcc(rowToProduct({ ...keptRow, id: 'a3' })), false)
check('but the ID is still there for next time', rowToProduct({ ...keptRow, id: 'a3' }).accId, 'CAMP-3')

/* Local / shipped shape: `normalizeProduct` must not drop the two fields, or the
 * seed catalogue would lose them on every rebuild. */
const local = normalizeProduct({ id: 'a4', name: 'Seed', hasAcc: true, accId: 'CAMP-4' })
check('normalizeProduct keeps the switch', local.hasAcc, true)
check('and the ID', local.accId, 'CAMP-4')
const localOff = normalizeProduct({ id: 'a5', name: 'Seed 2' })
check('a seed without ACC grows no hasAcc key', 'hasAcc' in localOff, false)
check('and no accId key', 'accId' in localOff, false)

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
