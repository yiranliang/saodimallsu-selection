/**
 * 导航标签视图 self-check
 *   node scripts/test-nav-views.mjs
 *
 * Pure Node — no browser, no database.
 *
 * 锁三件事：
 *   [1] token 切分：只有逗号/顿号/竖线分隔的词才算一枚（和卡片徽章一致）
 *   [2] 关键词：New / Best-seller 不能被 `Newest` 这类词误命中；节日词覆盖中英
 *   [3] 索引：一次遍历产出三个 Set；视图过滤保持目录顺序、未知视图返回空
 */

import {
  HOLIDAY_KEYWORDS,
  HOLIDAY_TAB_DEFAULT_LABEL,
  normaliseHolidayLabel,
  TAG_VIEW,
  buildTagIndex,
  isTagView,
  tagTokens,
  tagViewCount,
  tagViewProducts,
} from '../src/utils/navViews.js'

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

const p = (id, tag = '') => ({ id, name: `Item ${id}`, tag })

/* ── 1. token ── */
console.log('\n[1] tag tokens')

check('single tag', tagTokens(p('a', 'New')), ['new'])
check('comma list', tagTokens(p('a', 'Bestseller, New')), ['bestseller', 'new'])
check('ideographic comma', tagTokens(p('a', '爆款、New')), ['爆款', 'new'])
check('pipe', tagTokens(p('a', 'New|Holiday')), ['new', 'holiday'])
check('inner whitespace collapses', tagTokens(p('a', 'Best   seller')), ['best seller'])
check('empty tag', tagTokens(p('a', '')), [])
check('missing tag', tagTokens({ id: 'a' }), [])
check('null product is safe', tagTokens(null), [])

/* ── 2. keywords ── */
console.log('\n[2] keyword matching')

const index = buildTagIndex([
  p('a', 'New'),
  p('b', 'Best-seller'),
  p('c', 'Bestseller, New'),
  p('d', 'Newest'), // 不能算新品
  p('e', 'Holiday'),
  p('f', 'Xmas Sale'),
  p('g', '圣诞特选'),
  p('h', 'Clearance'),
  p('i', ''),
])

check('new ids', [...index[TAG_VIEW.NEW]].sort(), ['a', 'c'])
check('bestseller ids (hyphen and plain)', [...index[TAG_VIEW.BESTSELLER]].sort(), ['b', 'c'])
check('holiday ids', [...index[TAG_VIEW.HOLIDAY]].sort(), ['e', 'f', 'g'])
check('counts', [
  tagViewCount(index, TAG_VIEW.NEW),
  tagViewCount(index, TAG_VIEW.BESTSELLER),
  tagViewCount(index, TAG_VIEW.HOLIDAY),
], [2, 2, 3])
check('holiday words include Chinese', HOLIDAY_KEYWORDS.includes('圣诞'), true)

/* ── 3. filtering ── */
console.log('\n[3] view filtering')

const catalogue = [p('c', 'Bestseller, New'), p('e', 'Holiday'), p('a', 'New')]
check(
  'new view keeps catalogue order',
  tagViewProducts(catalogue, TAG_VIEW.NEW, index).map((item) => item.id),
  ['c', 'a'],
)
check(
  'holiday view',
  tagViewProducts(catalogue, TAG_VIEW.HOLIDAY, index).map((item) => item.id),
  ['e'],
)
check('an unknown view is empty, not everything', tagViewProducts(catalogue, 'nope', index), [])
check('a real category name is not a tag view', isTagView('Tops'), false)
check('a tag view id is recognised', isTagView(TAG_VIEW.HOLIDAY), true)
check('empty catalogue is safe', tagViewProducts([], TAG_VIEW.NEW, index), [])
check('products without ids are skipped', buildTagIndex([{ tag: 'New' }])[TAG_VIEW.NEW].size, 0)

/* ── 4. 节日专区的名字（可配置） ── */
console.log('\n[4] Holiday label')

check('default name', HOLIDAY_TAB_DEFAULT_LABEL, 'Holiday Picks')
check('a custom name passes through', normaliseHolidayLabel('Christmas Shop'), 'Christmas Shop')
check('surrounding spaces are trimmed', normaliseHolidayLabel('  Spring Picks  '), 'Spring Picks')
check('inner spaces collapse', normaliseHolidayLabel('Easter   Edit'), 'Easter Edit')
check('empty falls back to default', normaliseHolidayLabel(''), 'Holiday Picks')
check('whitespace falls back to default', normaliseHolidayLabel('   '), 'Holiday Picks')
check('null falls back to default', normaliseHolidayLabel(null), 'Holiday Picks')
check(
  'it is capped so the menu does not wrap',
  normaliseHolidayLabel('x'.repeat(80)).length,
  24,
)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
