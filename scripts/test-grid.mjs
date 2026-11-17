/**
 * 目录网格：列数 / 每页件数 self-check
 * Run: node scripts/test-grid.mjs
 *
 * 为什么值得测
 * ────────────
 * 这两个数字决定了"一页里有几件"。它们错了不会报错，只会表现成
 * "网格最后一行缺两格"或者"加载更多点了一次却多出 3 件" —— 都是那种
 * 看着像数据问题的视觉 bug。所以把规则本身钉死：
 *
 *   每页件数必须能被列数整除（没有半行）
 *   每页件数在 24–26 之间浮动（流量成本和固定 24 件一个量级）
 *   断点必须和 GRID_CLASS 里的 Tailwind 断点对齐
 */

import {
  GRID_BREAKPOINTS,
  GRID_CLASS,
  TARGET_PAGE,
  columnsForWidth,
  pageSizeFor,
} from '../src/utils/grid.js'

let passed = 0
let failed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

console.log('\n[1] Columns by viewport width')
check('phone 375 → 2', columnsForWidth(375), 2)
check('tablet 768 → 3', columnsForWidth(768), 3)
check('laptop 1024 → 4', columnsForWidth(1024), 4)
check('desktop 1280 → 5', columnsForWidth(1280), 5)
check('wide 1536 → 6', columnsForWidth(1536), 6)
check('4k 2560 → 6', columnsForWidth(2560), 6)
check('0 falls back to 2', columnsForWidth(0), 2)
check('NaN falls back to 2', columnsForWidth(Number.NaN), 2)
check('767 is still 2', columnsForWidth(767), 2)
check('1279 is still 4', columnsForWidth(1279), 4)

console.log('\n[2] Page size per column count')
check('2 cols → 24', pageSizeFor(2), 24)
check('3 cols → 24', pageSizeFor(3), 24)
check('4 cols → 24', pageSizeFor(4), 24)
check('5 cols → 25', pageSizeFor(5), 25)
check('6 cols → 24', pageSizeFor(6), 24)
check('garbage → 24', pageSizeFor(undefined), 24)
check('zero → 24', pageSizeFor(0), 24)

console.log('\n[3] Invariants')
check('target is 24', TARGET_PAGE, 24)

for (const cols of [2, 3, 4, 5, 6]) {
  const size = pageSizeFor(cols)
  check(`${cols} cols: ${size} is a whole number of rows`, size % cols, 0)
  check(`${cols} cols: ${size} ≈ one page of work`, size >= 24 && size <= 24 + cols, true)
}

/* 每页最多比目标多一列——否则"加载更多"会一次拉进太多，流量失控。 */
const worst = Math.max(...[2, 3, 4, 5, 6].map((cols) => pageSizeFor(cols) - TARGET_PAGE))
check('overshoot stays under one row', worst <= 6, true)

console.log('\n[4] Grid class matches the breakpoints')
check('2 cols default', GRID_CLASS.includes('grid-cols-2'), true)
check('md → 3', GRID_CLASS.includes('md:grid-cols-3'), true)
check('lg → 4', GRID_CLASS.includes('lg:grid-cols-4'), true)
check('xl → 5', GRID_CLASS.includes('xl:grid-cols-5'), true)
check('2xl → 6', GRID_CLASS.includes('2xl:grid-cols-6'), true)
check(
  'breakpoint table is widest-first',
  GRID_BREAKPOINTS.every((bp, i) => i === 0 || bp.min < GRID_BREAKPOINTS[i - 1].min),
  true,
)

console.log(`\n${failed ? '✗' : '✓'} Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
process.exitCode = failed ? 1 : 0
