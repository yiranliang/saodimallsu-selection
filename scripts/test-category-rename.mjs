/**
 * 分类改名判定 self-check
 *   node scripts/test-category-rename.mjs
 *
 * 纯 Node，不碰浏览器、不碰网络。
 *
 * 这个判定只有三种答案，但错一次就会重演线上那个 bug：
 *   rename  应该走 `update categories set name = …`（级联带商品，排序不动）
 *   merge   应该先搬商品再删旧行
 *   noop    什么都不做
 *
 * 最危险的一种是"大小写改名"（Tops → tops）：它不是合并。判成合并就会
 * 删掉一行、再由触发器建一行新的（排在最底）—— 外观和那个 bug 一模一样。
 */

import { planCategoryRename } from '../src/utils/categoryRename.js'

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

const NAMES = ['Tops', 'Bottoms', 'Dresses', 'Uncategorised']

console.log('\n[1] 纯改名 — 一条 UPDATE，不新建行')

check('a brand-new name is a rename', planCategoryRename('Tops', 'Knitwear', NAMES), {
  mode: 'rename',
  from: 'Tops',
  to: 'Knitwear',
})
check('an empty list is still a rename', planCategoryRename('Tops', 'Knitwear', []), {
  mode: 'rename',
  from: 'Tops',
  to: 'Knitwear',
})
/* 只把自己列进列表不算"已存在"。 */
check('the source itself does not count as taken', planCategoryRename('Tops', 'Knitwear', ['Tops']), {
  mode: 'rename',
  from: 'Tops',
  to: 'Knitwear',
})

console.log('\n[2] 大小写改名 — 仍然是 rename（不是 merge）')

/* Postgres 的主键是大小写敏感的，'Tops' 和 'tops' 是两行不同的值。
 * 判成 merge 就会删一建一，排序照样掉底 —— 所以这条必须钉死。 */
check('Tops → tops is a rename', planCategoryRename('Tops', 'tops', NAMES), {
  mode: 'rename',
  from: 'Tops',
  to: 'tops',
})
check('TOPS → Tops is a rename', planCategoryRename('TOPS', 'Tops', ['TOPS']), {
  mode: 'rename',
  from: 'TOPS',
  to: 'Tops',
})

console.log('\n[3] 合并 — 撞上另一个已存在的分类')

check('renaming onto an existing category merges', planCategoryRename('Tops', 'Bottoms', NAMES), {
  mode: 'merge',
  from: 'Tops',
  to: 'Bottoms',
})
check(
  'the comparison is case-insensitive',
  planCategoryRename('Tops', 'bottoms', NAMES).mode,
  'merge',
)
check(
  'and whitespace in the input does not save it',
  planCategoryRename('Tops', '  Bottoms  ', NAMES).mode,
  'merge',
)

console.log('\n[4] noop — 空名字 / 原地不动')

check('the same name', planCategoryRename('Tops', 'Tops', NAMES).mode, 'noop')
check('the same name after trimming', planCategoryRename('Tops', '  Tops  ', NAMES).mode, 'noop')
check('a blank target', planCategoryRename('Tops', '   ', NAMES).mode, 'noop')
check('a blank source', planCategoryRename('', 'Knitwear', NAMES).mode, 'noop')
check('null', planCategoryRename(null, null, NAMES).mode, 'noop')
check('undefined list', planCategoryRename('Tops', 'Knitwear', undefined).mode, 'rename')

console.log('\n[5] 返回值带着 trim 过的名字（写库直接用）')

check('the target is trimmed', planCategoryRename('Tops', '  Knitwear ', NAMES).to, 'Knitwear')
check('the source is trimmed', planCategoryRename(' Tops ', 'Knitwear', NAMES).from, 'Tops')

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
