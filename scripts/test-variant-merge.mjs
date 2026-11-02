/**
 * 删除 / 合并规格选项 self-check
 *   node scripts/test-variant-merge.mjs
 *
 * 纯 Node，不碰浏览器、不碰网络。
 *
 * 这里每一个断言都对应一次"静默毁数据"的可能：删错行 → 货号少卖一个尺码；
 * 合并错 ASIN → 订单指向另一个 listing；把别的颜色顺手改了 → 更糟。
 */

import {
  axisIndex,
  diffVariants,
  keysForOption,
  mergeOptionAsins,
  rekeyOnAxis,
} from '../src/utils/variantMerge.js'
import { normaliseImportedSize } from '../src/utils/bulkImport.js'

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

/* 一个典型的待清理映射：同一个尺码有两种拼写。 */
const VARIANTS = {
  'Black|2XL': 'B0AAAAAAAA',
  'Black|XXL': 'B0BBBBBBBB',
  'Green|2XL': 'B0CCCCCCCC',
  'Green|L': 'B0DDDDDDDD',
  'White|2XL': 'B0EEEEEEEE',
}

console.log('\n[1] keysForOption — 只挑这个选项自己的键')

check('every colour under 2XL', keysForOption(VARIANTS, 'size', '2XL'), [
  'Black|2XL',
  'Green|2XL',
  'White|2XL',
])
check('case-insensitive', keysForOption(VARIANTS, 'size', '2xl').length, 3)
check('a size that has no key', keysForOption(VARIANTS, 'size', 'M'), [])
check('the colour axis', keysForOption(VARIANTS, 'colour', 'Green'), ['Green|2XL', 'Green|L'])
/* 空值 = 还没输入的选项，绝不能匹配"所有没有尺码的行"。 */
check('empty never matches', keysForOption(VARIANTS, 'size', ''), [])
check('whitespace only too', keysForOption(VARIANTS, 'size', '   '), [])
check('non-object input', keysForOption(null, 'size', '2XL'), [])

console.log('\n[2] rekeyOnAxis — 只动一个轴')

check('a size rename keeps the colour', rekeyOnAxis('Black|2XL', 'size', 'XXL'), 'Black|XXL')
check('a colour rename keeps the size', rekeyOnAxis('Black|2XL', 'colour', 'Navy'), 'Navy|2XL')
check('an empty size is not touched', rekeyOnAxis('Black|', 'size', 'XXL'), 'Black|')
/* 没有 `|` 的遗留键：不知道指哪一半，原样返回（猜错就是挂错 ASIN）。 */
check('a keyless legacy entry is left alone', rekeyOnAxis('Green', 'size', 'XXL'), 'Green')
check('axisIndex maps colour to 0', [axisIndex('colour'), axisIndex('size')], [0, 1])

console.log('\n[3] mergeOptionAsins — 2XL 并进 XXL')

const merged = mergeOptionAsins(VARIANTS, 'size', '2XL', 'XXL')
check('the target already had an ASIN → it wins', merged.variants['Black|XXL'], 'B0BBBBBBBB')
check('the source key is gone', 'Black|2XL' in merged.variants, false)
check('the other colours move', merged.variants['Green|XXL'], 'B0CCCCCCCC')
check('and theirs are gone too', 'Green|2XL' in merged.variants || 'White|2XL' in merged.variants, false)
check('unrelated keys are untouched', merged.variants['Green|L'], 'B0DDDDDDDD')
check('every conflicting pair is reported', merged.conflicts.length, 1)
check('the conflict names both ASINs', merged.conflicts[0], {
  from: 'Black|2XL',
  to: 'Black|XXL',
  fromAsin: 'B0AAAAAAAA',
  toAsin: 'B0BBBBBBBB',
})
check('three moves in total', merged.moves.length, 3)
/* 输入不许被改：编辑器把原地图当作"库里的值"继续用。 */
check('the source map is not mutated', VARIANTS['Black|2XL'], 'B0AAAAAAAA')

const preferFrom = mergeOptionAsins(VARIANTS, 'size', '2XL', 'XXL', { prefer: 'from' })
check('prefer=from overrides the target', preferFrom.variants['Black|XXL'], 'B0AAAAAAAA')
check('and still reports the conflict', preferFrom.conflicts.length, 1)

console.log('\n[4] mergeOptionAsins — 没有冲突的合并')

const clean = { 'Black|2XL': 'B0AAAAAAAA', 'Black|L': 'B0BBBBBBBB' }
const cleanMerge = mergeOptionAsins(clean, 'size', '2XL', 'XXL')
/* 键序不重要（这里不是 `specs`，没有历史码按位置解码），只比内容。 */
const entries = (object) => Object.entries(object).sort(([a], [b]) => a.localeCompare(b))
check('the ASIN moves to the surviving spelling', entries(cleanMerge.variants), [
  ['Black|L', 'B0BBBBBBBB'],
  ['Black|XXL', 'B0AAAAAAAA'],
])
check('no conflict', cleanMerge.conflicts, [])
check('one move', cleanMerge.moves.length, 1)

const same = { 'Black|XXL': 'B0AAAAAAAA' }
check(
  'an identical ASIN on both sides is not a conflict',
  mergeOptionAsins({ ...same, 'Black|2XL': 'B0AAAAAAAA' }, 'size', '2XL', 'XXL').conflicts,
  [],
)

check('merging a value into itself changes nothing', mergeOptionAsins(VARIANTS, 'size', '2XL', '2XL'), {
  variants: VARIANTS,
  moves: [],
  conflicts: [],
})
check('a value that is not there at all', mergeOptionAsins(VARIANTS, 'size', 'M', 'L').moves, [])

console.log('\n[5] diffVariants — 给编辑器的补丁')

check(
  'a moved key shows as one add and one delete',
  diffVariants({ 'Black|2XL': 'A' }, { 'Black|XXL': 'A' }),
  { 'Black|2XL': '', 'Black|XXL': 'A' },
)
check('an unchanged map is an empty patch', diffVariants(VARIANTS, { ...VARIANTS }), {})
check('a changed value is one edit', diffVariants({ a: '1' }, { a: '2' }), { a: '2' })
check('a removed key is an empty string', diffVariants({ a: '1' }, {}), { a: '' })
check('null inputs', diffVariants(null, null), {})

console.log('\n[6] normaliseImportedSize — 导入时的 2XL → XXL')

/* 网页导入和 CLI 共用同一张别名表；这条保证"以后不会再导进一个重复尺码"。 */
check('2XL becomes XXL', normaliseImportedSize('2XL'), 'XXL')
check('lower case too', normaliseImportedSize('2xl'), 'XXL')
check('an ordinary size is untouched', normaliseImportedSize('M'), 'M')
check('a numeric size is untouched', normaliseImportedSize('10'), '10')
check('empty stays empty', normaliseImportedSize(''), '')
check('undefined does not throw', normaliseImportedSize(undefined), '')

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
