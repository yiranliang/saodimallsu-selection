/**
 * Featured for You self-check
 *   node scripts/test-featured.mjs
 *
 * Pure Node — no browser, no network, no database.
 *
 * 这一块最容易出的两个错，一个都看不出来：
 *   1. **重复的商品卡** —— 同一件出现在推荐位两次，看上去像"库存有两件"；
 *   2. **抽样把目录顺序弄乱** —— 为了实现随机，顺手把入参数组洗了，于是下方
 *      网格的顺序和后台拖拽不一致。
 *
 * 以前还有第三组断言（"每个分类至少 1–2 件"），随着算法改成全库纯随机一起删了；
 * 现在对应的是反向断言：**小分类的商品不再被保底**，它出现在推荐位的概率和
 * 其它商品一样。
 */

import {
  FEATURED_SIZE,
  mulberry32,
  nextSeed,
  pickFeatured,
  shuffleInPlace,
} from '../src/utils/featured.js'

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

/** 一个大小类目悬殊的目录：Tops 一个人顶五个小类目，Sleepwear 只有 1 件。 */
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
const seeded = (seed, list = CATALOGUE) => pickFeatured(list, { random: mulberry32(seed) })
const seeds = [1, 2, 3, 7, 11, 42, 99, 123, 777, 2026]

/* ── 1. 基础形状 ── */
console.log('\n[1] pickFeatured — 24 件，且不重样')

check('24 by default', seeded(1).length, 24)
check('the constant is 24', FEATURED_SIZE, 24)
check('no duplicates', new Set(texts(seeded(1))).size, 24)
check('and no duplicates on any seed', seeds.every((seed) => new Set(texts(seeded(seed))).size === 24), true)
check('every pick is a real product', seeded(1).every((p) => CATALOGUE.includes(p)), true)
check('a short catalogue returns what it has', pickFeatured(CATALOGUE.slice(0, 7), { random: mulberry32(3) }).length, 7)
check(
  'a short catalogue has no duplicates either',
  new Set(texts(pickFeatured(CATALOGUE.slice(0, 7), { random: mulberry32(3) }))).size,
  7,
)
check('empty catalogue', pickFeatured([], { random: mulberry32(1) }), [])
check('null in, empty out', pickFeatured(null, { random: mulberry32(1) }), [])
check('size 0 asks for nothing', pickFeatured(CATALOGUE, { size: 0, random: mulberry32(1) }), [])
check('a custom size is honoured', pickFeatured(CATALOGUE, { size: 8, random: mulberry32(1) }).length, 8)

/* ── 2. 全库随机：小分类不再保底，每个商品机会均等 ── */
console.log('\n[2] pickFeatured — 全库随机，没有分类保底')

/* 只有 1 件商品的分类：保底版**每次**都会抽到它；随机版应该经常抽不到。
 * 10 个种子里至少漏掉一次 —— 漏不掉就说明还有保底逻辑在。 */
check(
  'a one-product category is no longer guaranteed',
  seeds.some((seed) => !texts(seeded(seed)).includes('Sleepwear-0')),
  true,
)

/* 反过来，也不能"永远轮不到"某个商品：40 次抽样里每个商品都要出现过。
 * 单次命中率 24/58 ≈ 41%，连漏 40 次的美妙概率是 0.59^40，实际不可能。 */
const seenOver40 = new Set()
for (let seed = 0; seed < 40; seed += 1) {
  texts(seeded(seed)).forEach((id) => seenOver40.add(id))
}
check('every product can appear', seenOver40.size, CATALOGUE.length)

/* 分布不会严格均匀，但也不该偏到某个商品几乎不出现。期望次数 = 200 × 24/58 ≈ 83。 */
const appearances = new Map()
for (let seed = 0; seed < 200; seed += 1) {
  texts(seeded(seed)).forEach((id) => appearances.set(id, (appearances.get(id) || 0) + 1))
}
const counts = [...appearances.values()]
check('every product is drawn', appearances.size, CATALOGUE.length)
check('no product is starved', Math.min(...counts) >= 40, true)
check('nor is any product over-drawn', Math.max(...counts) <= 130, true)

/* 展示顺序不是按分类成块：24 个位置里相邻换类的次数应该很多，而不是 6 次
 * （每个分类一段）。 */
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

/* 也不是"取输入的前 24 个"：随机之后顺序应当和输入不同。 */
check(
  'the order is not just the first 24 of the catalogue',
  seeds.some((seed) => texts(seeded(seed)).join() !== texts(CATALOGUE.slice(0, 24)).join()),
  true,
)

/* ── 3. 可复现 + 每次换一批 ── */
console.log('\n[3] pickFeatured — 同种子可复现，不同种子会换')

check('same seed, same picks', texts(seeded(42)), texts(seeded(42)))
check('a different seed shuffles differently', texts(seeded(42)).join() === texts(seeded(43)).join(), false)

/* ── 4. 不碰入参（下方网格的顺序由它决定） ── */
console.log('\n[4] pickFeatured — 只读，不改顺序')

const before = texts(CATALOGUE)
pickFeatured(CATALOGUE, { random: mulberry32(9) })
check('the catalogue array is untouched', texts(CATALOGUE), before)
check('and no product object was mutated', CATALOGUE.every((p) => !('sort_order' in p) && !('sortOrder' in p)), true)

const single = [{ id: 'a' }]
shuffleInPlace(single, mulberry32(1))
check('shuffling one item is a no-op', single.length, 1)

/* ── 5. 换一批（Shuffle）的种子 ── */
console.log('\n[5] nextSeed — 点一下必须真的换，且不越界')

check('a drawn seed is used as-is', nextSeed(5, () => 0.5), Math.floor(0.5 * 0x7fffffff))
check('a collision is nudged instead of returning the same seed', nextSeed(7, () => 7 / 0x7fffffff), 8)
check('the nudge wraps at the top of the range', nextSeed(0x7ffffffe, () => 0x7ffffffe / 0x7fffffff), 0)
check('a broken rng still yields a usable number', nextSeed(3, () => Number.NaN) >= 0, true)
check(
  'and a fresh seed really changes the pick',
  texts(seeded(nextSeed(1, () => 0.5))).join() === texts(seeded(1)).join(),
  false,
)

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
