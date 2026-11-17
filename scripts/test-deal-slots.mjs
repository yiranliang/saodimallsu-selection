/**
 * 秒杀档期选择 self-check
 * Run: node scripts/test-deal-slots.mjs
 *
 * 一个货号可以有多个时间窗。前台每次只能展示一个，所以"挑哪一个"就是全部
 * 逻辑所在：进行中的优先（叠期取结束最晚），否则取最近的一档，全结束则没有。
 */

import { applyDealSlots, effectiveSlot, slotOf, withEffectiveSlot } from '../src/utils/dealSlots.js'

let passed = 0
let failed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
  } else {
    failed += 1
    console.log(`  x ${name}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

const day = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T12:00:00').getTime()

const slot = (id, from, to) => ({
  sku: 'P1',
  start: NOW + from * day,
  end: NOW + to * day,
  salePrice: '10',
  originalPrice: '20',
  isCampaign: false,
  subTag: '',
  id,
})

console.log('\n[1] slotOf')
check(
  'snake_case row → camelCase slot',
  (() => {
    const s = slotOf({
      sku: ' P9 ',
      sale_start: '2026-11-20T10:00:00Z',
      sale_end: '2026-12-01T10:00:00Z',
      sale_price: '19.99',
      original_price: '39.99',
      is_campaign: true,
      sub_tag: 'Black Friday',
    })
    return [s.sku, s.isCampaign, s.subTag, typeof s.start]
  })(),
  ['P9', true, 'Black Friday', 'number'],
)
check('a missing window is null', slotOf({ sku: 'P1' }), null)
check('end before start is null', slotOf({ sku: 'P1', sale_start: '2026-12-02', sale_end: '2026-12-01' }), null)
check('null row is null', slotOf(null), null)

console.log('\n[2] effectiveSlot')
check(
  'live window wins over a future one',
  effectiveSlot([slot('live', -1, 1), slot('next', 2, 3)], NOW)?.id,
  'live',
)
check(
  'two live windows: the one ending last wins',
  effectiveSlot([slot('short', -1, 0.5), slot('long', -1, 2)], NOW)?.id,
  'long',
)
check(
  'nothing live: the earliest upcoming',
  effectiveSlot([slot('far', 5, 6), slot('near', 2, 3)], NOW)?.id,
  'near',
)
check(
  'all ended: null',
  effectiveSlot([slot('old', -5, -4)], NOW),
  null,
)
check('empty list: null', effectiveSlot([], NOW), null)
check('a window ending exactly now is over', effectiveSlot([slot('edge', -1, 0)], NOW), null)

console.log('\n[3] applyDealSlots')
const products = [
  { id: 'a', sku: 'P1', saleStart: '', saleEnd: '' },
  { id: 'b', sku: 'P2', saleStart: '', saleEnd: '' },
]

const merged = applyDealSlots(products, { P1: [slot('s1', -1, 1)] }, NOW)
check('the product with slots gets the effective window', merged[0].salePrice, '10')
check('the window is written in the admin input format', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(merged[0].saleStart), true)
check('a product without slots is untouched (same reference)', merged[1] === products[1], true)
check('the input array is not mutated', products[0].salePrice, undefined)

const none = applyDealSlots(products, {}, NOW)
check('no slots at all → copies only', none.length, 2)
check('withEffectiveSlot without a slot returns the product', withEffectiveSlot(products[0], null) === products[0], true)

console.log(`\n${failed ? 'x' : 'v'} Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
process.exitCode = failed ? 1 : 0
