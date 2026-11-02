/**
 * Featured for You self-check
 *   node scripts/test-featured.mjs
 *
 * Pure Node — no browser, no network, no database.
 *
 * 这一块最容易出的两个错，一个都看不出来：
 *   1. **推荐位被大类目垄断** —— 24 个位置被 Tops 占满，小分类从没出现过；
 *   2. **抽样把目录顺序弄乱** —— 为了实现随机，顺手把 `sort_order` 或传入数组
 *      改了，于是下方网格的顺序和后台拖拽不一致。
 * 所以断言分两组：覆盖性（每个分类有份）与不可变性（入参、顺序都不许动）。
 */

import {
  FEATURED_PER_CATEGORY,
  FEATURED_SIZE,
  groupByCategory,
  mulberry32,
  nextSeed,
  pickFeatured,
  shuffleInPlace,
} from '../src/utils/featured.js'
import { UNCATEGORISED } from '../src/store/mapping.js'

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

/** `n` 个商品，货号唯一，全部属于 `category`。 */
const make = (n, category, prefix = category) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    category,
    sku: `${prefix}${i}`,
  }))

/** 一个大小类目悬殊的目录：Tops 一个人顶四个小类目。 */
const CATALOGUE = [
  ...make(30, 'Tops'),
  ...make(12, 'Knitwear'),
  ...make(6, 'Dresses'),
  ...make(4, 'Bottoms'),
  ...make(3, 'Outerwear'),
  ...make(2, 'Accessories'),
  ...make(1, 'Sleepwear'),
]

const texts = (list) => list.map((p) => p.id)

/* ── 1. 基础形状 ── */
console.log('\n[1] pickFeatured — 24 件，且不重样')

const seeded = (seed) => pickFeatured(CATALOGUE, { random: mulberry32(seed) })

check('24 by default', seeded(1).length, 24)
check('the constant is 24', FEATURED_SIZE, 24)
check('no duplicates', new Set(texts(seeded(1))).size, 24)
check('every pick is a real product', seeded(1).every((p) => CATALOGUE.includes(p)), true)
check('a short catalogue returns what it has', pickFeatured(CATALOGUE.slice(0, 7), { random: mulberry32(3) }).length, 7)
check('empty catalogue', pickFeatured([], { random: mulberry32(1) }), [])
check('null in, empty out', pickFeatured(null, { random: mulberry32(1) }), [])
check('size 0 asks for nothing', pickFeatured(CATALOGUE, { size: 0, random: mulberry32(1) }), [])

/* ── 2. 覆盖性（本功能存在的理由） ── */
console.log('\n[2] pickFeatured — 每个分类都有份')

const categoryCountsOf = (list) => {
  const counts = {}
  list.forEach((p) => {
    const key = String(p.category ?? '').trim() || UNCATEGORISED
    counts[key] = (counts[key] || 0) + 1
  })
  return counts
}

/* 用多个种子扫一遍：一次通过可能是运气，十次都过才是算法。 */
const seeds = [1, 2, 3, 7, 11, 42, 99, 123, 777, 2026]
const coverageFailures = seeds
  .map((seed) => {
    const counts = categoryCountsOf(seeded(seed))
    return [...groupByCategory(CATALOGUE).keys()] // Map 的 key 就是全部分类的全集
      .filter((category) => !counts[category])
  })
  .filter((missing) => missing.length)

check('every category appears, on every seed', coverageFailures, [])

/* 只有 1 件的分类也必须被抽到 —— 它就是"小众目录"的极端例子。 */
check(
  'a one-product category is not squeezed out',
  seeds.every((seed) => texts(seeded(seed)).includes('Sleepwear-0')),
  true,
)

/* 名额够的时候，每个分类拿到 2 个（不是只给 1 个）。 */
check(
  'two per category when there is room',
  seeds.every((seed) => {
    const counts = categoryCountsOf(seeded(seed))
    return ['Tops', 'Knitwear', 'Dresses', 'Bottoms', 'Outerwear', 'Accessories'].every(
      (category) => counts[category] >= FEATURED_PER_CATEGORY,
    )
  }),
  true,
)

/* 大类目仍然可以多拿 —— 加权不是平均主义，名额补齐时 Tops 会占多数。 */
const topShare = (seed) => categoryCountsOf(seeded(seed)).Tops
check('the big category still supplies the remainder', seeds.every((seed) => topShare(seed) > 2), true)

/* ── 3. 分类比名额还多：先保"人人一件" ── */
console.log('\n[3] pickFeatured — 分类多到放不下时')

const manyCategories = Array.from({ length: 40 }, (_, i) => ({
  id: `c${i}`,
  category: `Cat${i}`,
}))
const crowded = pickFeatured(manyCategories, { random: mulberry32(5) })
check('still returns exactly 24', crowded.length, 24)
check('each from a different category (24 of 40)', new Set(crowded.map((p) => p.category)).size, 24)

/* ── 4. 可复现 + 每次刷新会变 ── */
console.log('\n[4] pickFeatured — 同种子可复现，不同种子会换')

check('same seed, same picks', texts(seeded(42)), texts(seeded(42)))
check('same seed, same order', texts(seeded(42)), texts(seeded(42)))
check('a different seed shuffles differently', texts(seeded(42)).join() === texts(seeded(43)).join(), false)
/* 展示顺序按分类成块就说明"最后再洗一次"没生效：24 个位置里相邻换类的次数
 * 应该很多，而不是 7 次（每个分类一段）。 */
check(
  'the display order is not grouped by category',
  seeds.every((seed) => {
    const categories = seeded(seed).map((p) => p.category)
    let switches = 0
    for (let i = 1; i < categories.length; i += 1) {
      if (categories[i] !== categories[i - 1]) switches += 1
    }
    return switches >= 10
  }),
  true,
)

/* ── 5. 不碰入参（下方网格的顺序由它决定） ── */
console.log('\n[5] pickFeatured — 只读，不改顺序')

const before = texts(CATALOGUE)
pickFeatured(CATALOGUE, { random: mulberry32(9) })
check('the catalogue array is untouched', texts(CATALOGUE), before)
check('and no product object was mutated', CATALOGUE.every((p) => !('sort_order' in p) && !('sortOrder' in p)), true)

const single = [{ id: 'a' }]
shuffleInPlace(single, mulberry32(1))
check('shuffling one item is a no-op', single.length, 1)

/* ── 6. perCategory 可调 ── */
console.log('\n[6] pickFeatured — perCategory 不是写死的')

const oneEach = pickFeatured(CATALOGUE, { size: 7, perCategory: 1, random: mulberry32(4) })
check('perCategory 1 with a tight size gives exactly one each', [...groupByCategory(oneEach).keys()].length, 7)
check('and exactly one for a small category', categoryCountsOf(oneEach).Accessories, 1)

/* ── 7. 空分类归到 Uncategorised ── */
console.log('\n[7] groupByCategory — 没填分类也算一个目录')

check(
  'blank category joins the Uncategorised bucket',
  [...groupByCategory([
    { id: 'a', category: '' },
    { id: 'b' },
    { id: 'c', category: '  Tops  ' },
  ]).keys()],
  [UNCATEGORISED, 'Tops'],
)
check(
  'a catalogue of only uncategorised products still works',
  pickFeatured([{ id: 'only', category: '' }], { random: mulberry32(6) }).map((p) => p.id),
  ['only'],
)

/* ── 8. 换一批（Shuffle）的种子 ── */
console.log('\n[8] nextSeed — 点一下必须真的换，且不越界')

check('a drawn seed is used as-is', nextSeed(5, () => 0.5), Math.floor(0.5 * 0x7fffffff))
check('a collision is nudged instead of returning the same seed', nextSeed(7, () => 7 / 0x7fffffff), 8)
check(
  'the nudge wraps at the top of the range',
  nextSeed(0x7ffffffe, () => 0x7ffffffe / 0x7fffffff),
  0,
)
check('a broken rng still yields a usable number', nextSeed(3, () => Number.NaN) >= 0, true)
check(
  'and a fresh seed really changes the pick',
  texts(pickFeatured(CATALOGUE, { random: mulberry32(nextSeed(1, () => 0.5)) })).join() ===
    texts(pickFeatured(CATALOGUE, { random: mulberry32(1) })).join(),
  false,
)

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
