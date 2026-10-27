/**
 * 秒杀导入 + CSV 导出 self-check
 *   node scripts/test-deal-import.mjs
 *
 * Pure Node — no browser, no database. Two planners, their edge cases pinned:
 *
 *   dealImport.planDealImport  — header mapping, date completion (00:00 /
 *                                 23:59:59), price parsing, duplicate 货号,
 *                                 end<start, blank-row tolerance
 *   dealImport.resolveDealTargets — match vs missing, by the live sku map
 *   exportCsv.buildExportCsv   — nine columns, BOM, quoting, | -joined specs
 */

import {
  normaliseDiscountLabel,
  planDealImport,
  resolveDealTargets,
} from '../src/utils/dealImport.js'
import { buildExportCsv, productToCsvRow } from '../src/utils/exportCsv.js'

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

console.log('\n[1] planDealImport — happy path')

{
  const grid = [
    ['货号', '原价', '折后价', '开始日期', '结束日期'],
    ['P5B008', '49.99', '29.99', '2026-11-27', '2026-11-30'],
    ['N2Z033', 'US$39.00', '19.99', '2026-11-28', '2026-12-01'],
  ]
  const { plan, problems } = planDealImport(grid)
  check('no problems', problems, [])
  check('two rows planned', plan.length, 2)
  check('start completed to 00:00', plan[0].saleStart, '2026-11-27T00:00')
  check('end completed to 23:59:59', plan[0].saleEnd, '2026-11-30T23:59:59')
  check('currency symbol stripped', plan[1].originalPrice, '39')
  check('sale price as string', plan[1].salePrice, '19.99')
}

console.log('\n[2] planDealImport — problems')

{
  const grid = [
    ['货号', '原价', '折后价', '开始日期', '结束日期'],
    ['P5B008', '49.99', '29.99', '2026-11-27', '2026-11-30'],
    ['P5B008', '49.99', '29.99', '2026-11-27', '2026-11-30'], // duplicate
    ['', '49.99', '29.99', '2026-11-27', '2026-11-30'], // no sku
    ['SKU WITH SPACE', '49.99', '29.99', '2026-11-27', '2026-11-30'], // bad sku
    ['X9', '49.99', '29.99', '11/27/2026', '2026-11-30'], // bad date
    ['Y9', '49.99', '29.99', '2026-12-05', '2026-12-01'], // end < start
    ['Z9', 'oops', '29.99', '2026-11-27', '2026-11-30'], // bad price
  ]
  const { plan, problems } = planDealImport(grid)
  check('only the first row survives', plan.length, 1)
  check('six problem rows', problems.length, 6)
  check('duplicate flagged', problems.some((p) => p.reason.includes('重复')), true)
  check('empty sku flagged', problems.some((p) => p.reason.includes('缺货号')), true)
  check('bad date flagged', problems.some((p) => p.reason.includes('开始日期')), true)
  check('end<start flagged', problems.some((p) => p.reason.includes('结束日期早于')), true)
  check('bad price flagged', problems.some((p) => p.reason.includes('原价')), true)
}

console.log('\n[3] planDealImport — missing header column')

{
  const grid = [
    ['货号', '原价', '折后价', '开始日期'], // no 结束日期
    ['P5B008', '49.99', '29.99', '2026-11-27'],
  ]
  const { plan, problems } = planDealImport(grid)
  check('nothing planned', plan.length, 0)
  check('header problem reported at row 0', problems[0].row, 0)
  check('mentions the missing column', problems[0].reason.includes('结束日期'), true)
}

console.log('\n[3b] planDealImport — Excel date serials (raw:true)')

{
  /* readSheetGrid reads with raw:true, so a CSV date becomes a SheetJS serial
   * like 46353.3333 (with a timezone fraction). Must still resolve the day. */
  const grid = [
    ['货号', '原价', '折后价', '开始日期', '结束日期'],
    ['P5B008', '49.99', '29.99', 46353.333333333336, 46356.333333333336],
  ]
  const { plan, problems } = planDealImport(grid)
  check('no problems for serial dates', problems, [])
  check('serial start → 2026-11-27T00:00', plan[0].saleStart, '2026-11-27T00:00')
  check('serial end → 2026-11-30T23:59:59', plan[0].saleEnd, '2026-11-30T23:59:59')
}

console.log('\n[3c] the ops sheet — 主卖货号 / 秒杀价 / 折扣率, no 原价')

{
  const grid = [
    ['主卖货号', '秒杀价', '折扣率', '开始日期', '结束日期'],
    ['P5B008', '29.99', '30%', '2026-11-27', '2026-11-30'],
    ['N2Z033', '19.99', '40', '2026-11-28', '2026-12-01'],
  ]
  const { plan, problems } = planDealImport(grid)
  check('no problems without 原价', problems, [])
  check('both rows planned', plan.length, 2)
  check('原价 left empty', plan.map((d) => d.originalPrice), [null, null])
  check('"30%" becomes a label', plan[0].discountLabel, '30% OFF')
  check('a bare number is a percent', plan[1].discountLabel, '40% OFF')
  check('dates still completed', [plan[0].saleStart, plan[0].saleEnd], ['2026-11-27T00:00', '2026-11-30T23:59:59'])
}

{
  /* A 原价 column that exists but is blank on some rows is still not an error. */
  const grid = [
    ['货号', '原价', '折后价', '开始日期', '结束日期'],
    ['P5B008', '', '29.99', '2026-11-27', '2026-11-30'],
    ['N2Z033', '39.00', '19.99', '2026-11-28', '2026-12-01'],
  ]
  const { plan, problems } = planDealImport(grid)
  check('blank 原价 is allowed', problems, [])
  check('blank → null, filled → the number', plan.map((d) => d.originalPrice), [null, '39'])
}

{
  const grid = [
    ['主卖货号', '秒杀价', '折扣率', '开始日期', '结束日期'],
    ['P5B008', '29.99', '30%', '2026-11-27', '2026-11-30'],
  ]
  const { plan } = planDealImport(grid)
  check('resolves against the catalogue', resolveDealTargets(plan, new Map([['P5B008', 'id-1']])).matched.length, 1)
}

console.log('\n[3d] normaliseDiscountLabel')

check('percent string', normaliseDiscountLabel('30%'), '30% OFF')
check('bare number', normaliseDiscountLabel('30'), '30% OFF')
check('excel fraction', normaliseDiscountLabel(0.3), '30% OFF')
check('already a label, lower case', normaliseDiscountLabel('30% off'), '30% OFF')
check('spaces', normaliseDiscountLabel(' 30 % '), '30% OFF')
check('empty', normaliseDiscountLabel(''), '')
check('zero is not a discount', normaliseDiscountLabel('0'), '')
check('100% is not a discount', normaliseDiscountLabel('100'), '')
check('free text is kept', normaliseDiscountLabel('Clearance'), 'Clearance')

console.log('\n[4] resolveDealTargets')

{
  const plan = [
    { sku: 'P5B008', saleStart: 'x', saleEnd: 'y', salePrice: '1', originalPrice: '2', discountLabel: '' },
    { sku: 'MISSING', saleStart: 'x', saleEnd: 'y', salePrice: '1', originalPrice: '2', discountLabel: '' },
  ]
  const bySku = new Map([['P5B008', 'id-1']])
  const { matched, missing } = resolveDealTargets(plan, bySku)
  check('one matched with id', matched, [{ id: 'id-1', deal: plan[0], sku: 'P5B008' }])
  check('one missing', missing, ['MISSING'])
}

console.log('\n[5] exportCsv — row and full document')

{
  const product = {
    sku: 'P5B008',
    name: 'Leggings, "Yoga"',
    category: 'Leggings',
    image: 'https://example.com/a.jpg',
    specs: { Colour: ['Black', 'Red'], Size: ['S', 'M'] },
    tag: 'Black Friday',
    saleStart: '2026-11-27T00:00',
    saleEnd: '2026-11-30T23:59:59',
    salePrice: '29.99',
    originalPrice: '49.99',
    accId: 'ACC123',
  }
  const row = productToCsvRow(product, new Date('2026-11-28T12:00').getTime())
  check('nine cells', row.length, 9)
  check('sku first', row[0], 'P5B008')
  check('colours joined', row[4], 'Black | Red')
  check('sizes joined', row[5], 'S | M')
  check('tag', row[6], 'Black Friday')
  check('deal live', row[7], 'live')
  check('acc id', row[8], 'ACC123')

  const csv = buildExportCsv([product], new Date('2026-11-28T12:00').getTime())
  check('starts with BOM', csv.charCodeAt(0), 0xfeff)
  check('header present', csv.includes('货号,商品名,分类'), true)
  check('name with comma+quote is escaped', csv.includes('"Leggings, ""Yoga"""'), true)
}

console.log('\n[6] exportCsv — deal status states')

{
  const base = { sku: 'X', name: 'n', category: 'c', image: '', specs: {}, tag: '', accId: '' }
  const now = new Date('2026-11-28T12:00').getTime()
  check('off when no window', productToCsvRow({ ...base }, now)[7], 'off')
  check('scheduled before start', productToCsvRow({ ...base, saleStart: '2026-12-01T00:00', saleEnd: '2026-12-05T23:59:59' }, now)[7], 'scheduled')
  check('ended after end', productToCsvRow({ ...base, saleStart: '2026-11-01T00:00', saleEnd: '2026-11-02T23:59:59' }, now)[7], 'ended')
  check('invalid when end<=start', productToCsvRow({ ...base, saleStart: '2026-12-05T00:00', saleEnd: '2026-12-01T00:00' }, now)[7], 'invalid')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
