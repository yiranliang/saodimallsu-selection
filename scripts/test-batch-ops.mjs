/**
 * 批量操作 self-check
 *   node scripts/test-batch-ops.mjs
 *
 * Pure Node — no browser, no database. Pins the rules the three new dialogs and
 * the reworked writers depend on:
 *
 *   [1] chunk                 — the request-size cap under a 100-sku Select all
 *   [2] buildDealFromDates    — day boundaries, validation, price parsing
 *   [3] parsePriorityInput    — empty ≠ 0 ("leave it alone" vs "unpin")
 *   [4] normaliseSubBadgeDraft / resolveCategoryName / countFillTargets
 *   [5] dealsOrder            — pin first, then live, then soonest
 *   [6] mapping round trip    — sub_tag / sub_badge_color / deal_priority
 */

import {
  BATCH_CHUNK,
  buildDealFromDates,
  chunk,
  countFillTargets,
  normaliseSubBadgeDraft,
  parsePriorityInput,
  resolveCategoryName,
} from '../src/utils/batchOps.js'
import { dealsOrder } from '../src/utils/deal.js'
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

console.log('\n[1] chunk')

check('100 ids → one slice', chunk(Array.from({ length: 100 }, (_, i) => i)).length, 1)
check('101 ids → two slices', chunk(Array.from({ length: 101 }, (_, i) => i)).length, 2)
check('273 ids → three slices', chunk(Array.from({ length: 273 }, (_, i) => i)).length, 3)
check('empty → no slices', chunk([]).length, 0)
check('slice sizes', chunk([1, 2, 3, 4, 5], 2).map((s) => s.length), [2, 2, 1])
check('default cap is 100', BATCH_CHUNK, 100)
check('size 0 falls back to the default cap', chunk([1, 2], 0).length, 1)
check('negative size is clamped to 1', chunk([1, 2], -5).length, 2)

console.log('\n[2] buildDealFromDates')

{
  const { deal, error } = buildDealFromDates({
    startDate: '2026-11-27',
    endDate: '2026-11-30',
    originalPrice: '49.99',
    salePrice: '29.99',
  })
  check('no error', error, '')
  check('start is midnight', deal.saleStart, '2026-11-27T00:00:00')
  check('end is end-of-day', deal.saleEnd, '2026-11-30T23:59:59')
  check('prices kept as text', [deal.originalPrice, deal.salePrice], ['49.99', '29.99'])
  check('no stored discount label', deal.discountLabel, '')
}

{
  check('missing start', buildDealFromDates({ endDate: '2026-11-30', originalPrice: '1', salePrice: '1' }).error, '开始日期必填')
  check('missing end', buildDealFromDates({ startDate: '2026-11-30', originalPrice: '1', salePrice: '1' }).error, '结束日期必填')
  check('impossible day', buildDealFromDates({ startDate: '2026-02-31', endDate: '2026-03-05', originalPrice: '1', salePrice: '1' }).error, '开始日期不是有效日期')
  check('end before start', buildDealFromDates({ startDate: '2026-12-05', endDate: '2026-12-01', originalPrice: '1', salePrice: '1' }).error, '结束日期早于开始日期')
  check('sale above original', buildDealFromDates({ startDate: '2026-12-01', endDate: '2026-12-05', originalPrice: '10', salePrice: '20' }).error, '折后价高于原价')
  check('currency symbol accepted', buildDealFromDates({ startDate: '2026-12-01', endDate: '2026-12-05', originalPrice: 'US$1,299.00', salePrice: '999' }).deal.originalPrice, '1299')
  check('same day is a valid one-day window', buildDealFromDates({ startDate: '2026-12-01', endDate: '2026-12-01', originalPrice: '10', salePrice: '8' }).error, '')
}

console.log('\n[3] parsePriorityInput')

check('empty = leave alone', parsePriorityInput(''), null)
check('blank = leave alone', parsePriorityInput('   '), null)
check('0 is a real value', parsePriorityInput('0'), 0)
check('a number', parsePriorityInput('5'), 5)
check('garbage = leave alone', parsePriorityInput('abc'), null)
check('negative clamps to 0', parsePriorityInput('-3'), 0)
check('huge clamps to 9999', parsePriorityInput('99999'), 9999)
check('decimals truncate', parsePriorityInput('7.9'), 7)

console.log('\n[4] sub badge / category helpers')

check(
  'sub badge collapses whitespace',
  normaliseSubBadgeDraft({ text: '  Black   Friday  ', color: '#c8855a' }),
  { subTag: 'Black Friday', subBadgeColor: '#C8855A' },
)
check(
  'empty sub text clears the colour too',
  normaliseSubBadgeDraft({ text: '', color: '#C8855A' }),
  { subTag: '', subBadgeColor: '' },
)
check(
  'existing category keeps its spelling',
  resolveCategoryName('leggings', ['Leggings', 'Tops']),
  { name: 'Leggings', isNew: false },
)
check(
  'a new category is reported as new',
  resolveCategoryName('Black Friday', ['Leggings']),
  { name: 'Black Friday', isNew: true },
)
check('blank category', resolveCategoryName('   ', ['Leggings']), { name: '', isNew: false })
check(
  'fill mode counts Uncategorised + blanks',
  countFillTargets(
    [{ category: 'Uncategorised' }, { category: 'Tops' }, { category: '' }, { category: 'uncategorised' }],
    'Uncategorised',
  ),
  3,
)

console.log('\n[5] dealsOrder — pin first, then soonest')

{
  const now = new Date(2026, 10, 28, 12, 0, 0).getTime()
  const mk = (id, start, end, dealPriority) => ({
    id,
    saleStart: start,
    saleEnd: end,
    ...(dealPriority ? { dealPriority } : {}),
  })
  const a = mk('a', '2026-11-28T10:00', '2026-11-28T20:00')
  const b = mk('b', '2026-11-28T10:00', '2026-11-28T13:00')
  const c = mk('c', '2026-11-28T10:00', '2026-11-28T22:00', 5)
  const d = mk('d', '2026-11-29T00:00', '2026-11-30T23:59:59', 9)

  check('pinned live first, then soonest', dealsOrder([a, b, c], now).map((p) => p.id), ['c', 'b', 'a'])
  check('scheduled still after every live one', dealsOrder([d, a, b, c], now).map((p) => p.id), ['c', 'b', 'a', 'd'])
  check('no priorities = pure time order', dealsOrder([a, b], now).map((p) => p.id), ['b', 'a'])
  check('negative priority is treated as unpinned', dealsOrder([{ ...a, dealPriority: -4 }, b], now).map((p) => p.id), ['b', 'a'])
}

console.log('\n[6] mapping round trip')

{
  const product = {
    id: 'p900',
    sku: 'BF1',
    name: 'Black Friday piece',
    category: 'Tops',
    image: 'https://example.com/a.jpg',
    specs: { Colour: ['Black'] },
    subTag: 'Black Friday',
    subBadgeColor: '#2b2b2b',
    dealPriority: 3,
  }
  const row = productToRow(product)
  check('sub_tag written', row.sub_tag, 'Black Friday')
  check('sub_badge_color upper-cased', row.sub_badge_color, '#2B2B2B')
  check('deal_priority written', row.deal_priority, 3)

  const back = rowToProduct(row)
  check('subTag read back', back.subTag, 'Black Friday')
  check('subBadgeColor read back', back.subBadgeColor, '#2B2B2B')
  check('dealPriority read back', back.dealPriority, 3)

  const bare = productToRow({ ...product, subTag: '', subBadgeColor: '', dealPriority: 0 })
  check('empty sub_tag', bare.sub_tag, '')
  check('no colour without text', bare.sub_badge_color, null)
  check('priority 0 stays 0', bare.deal_priority, 0)
  const bareBack = rowToProduct(bare)
  check('no subTag key when empty', 'subTag' in bareBack, false)
  check('no dealPriority key when 0', 'dealPriority' in bareBack, false)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
