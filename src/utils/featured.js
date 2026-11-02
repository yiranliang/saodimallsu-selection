/**
 * Featured for You — 首页随机推荐
 * ═══════════════════════════════════
 * 300+ 件商品里，红人通常只看首屏，后面的款式几乎没有曝光。这一块在网格
 * **上方**随机挑 24 件，每次加载/刷新换一批 —— 但**不是纯随机**：纯随机会
 * 让两个大类目把 24 个位置占满，小类目永远排不进去，等于把"曝光不均"从
 * 网格搬到了推荐位。
 *
 * 所以顺序是「先保证每个分类有份，再随机补齐」：
 *
 *   1. 按 `category` 分组（空分类归到 UNCATEGORISED，和后台列表同一套规则）；
 *   2. 每个分类先抽 `perCategory` 个（默认 2；分类多到放不下时降到 1，
 *      至少保证"人人有份"）；
 *   3. 剩下的名额从各分类抽完的余量里随机补满 24；
 *   4. 最后整体再洗一次 —— 否则 24 张卡会按分类一坨一坨排。
 *
 * 纯函数 + 注入随机源：Node 里用固定种子就能断言"覆盖了每个分类"，浏览器里
 * 传 `Math.random`。**不碰 `sort_order`、不碰数据库**，只是读取顺序之上的一次
 * 采样；下方常规网格的顺序仍然完全由后台拖拽决定。
 */

import { UNCATEGORISED } from '../store/mapping.js'

/** 推荐位固定展示多少件。 */
export const FEATURED_SIZE = 24

/** 每个分类先拿几个（名额不够时自动降到 1）。 */
export const FEATURED_PER_CATEGORY = 2

/** 种子范围。`mulberry32` 只吃 32 位整数，这里留出正数区间方便调试。 */
const SEED_LIMIT = 0x7fffffff

/**
 * 下一次洗牌用的种子。
 *
 * 为什么不让调用方直接写 `Math.random()`：**同一次点击必须真的换一批**。
 * 概率上两个种子撞车可以忽略，但"点了一下没反应"的观感代价很高（用户会连点
 * 三下），所以撞了就顺手 +1。纯函数 + 注入随机源，Node 里能断言这一点。
 *
 * @param {number} prev 当前种子
 * @param {() => number} [random]
 * @returns {number}
 */
export function nextSeed(prev, random = Math.random) {
  const current = Number(prev) >>> 0
  const drawn = Math.floor(random() * SEED_LIMIT)
  const next = Number.isFinite(drawn) && drawn >= 0 ? drawn : 0
  return next === current ? (current + 1) % SEED_LIMIT : next
}

/**
 * 可播种的 PRNG（mulberry32）—— 同一个种子给同一序列。
 *
 * 为什么不用 `Math.random` 直接测：覆盖性断言需要**可复现**的洗牌，否则失败
 * 时没法重放。浏览器里种子来自一次 `Math.random()`，所以每次刷新仍然是新的。
 *
 * @param {number} seed
 * @returns {() => number} [0, 1)
 */
export function mulberry32(seed) {
  let a = Number(seed) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher–Yates，**原地**洗牌并返回同一个数组（调用方负责先复制）。
 *
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 * @returns {T[]}
 */
export function shuffleInPlace(items, random = Math.random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = items[i]
    items[i] = items[j]
    items[j] = swap
  }
  return items
}

/**
 * 商品 → `Map<分类, 商品[]>`。空分类归到 UNCATEGORISED（和后台列表一致），
 * 否则一个没填分类的商品会被当成"第 0 个分类"混进 Coverage 统计里。
 *
 * @param {object[]} products
 * @returns {Map<string, object[]>}
 */
export function groupByCategory(products) {
  const groups = new Map()
  for (const product of Array.isArray(products) ? products : []) {
    if (!product) continue
    const key = String(product.category ?? '').trim() || UNCATEGORISED
    const bucket = groups.get(key)
    if (bucket) bucket.push(product)
    else groups.set(key, [product])
  }
  return groups
}

/**
 * 挑 24 件：每个分类至少 1 件（够的话 2 件），其余随机补齐。
 *
 * @param {object[]} products 当前可售目录（调用方已排除 hidden）
 * @param {{ size?: number, perCategory?: number, random?: () => number }} [options]
 * @returns {object[]} 新的数组；长度 = min(size, products.length)
 */
export function pickFeatured(
  products,
  { size = FEATURED_SIZE, perCategory = FEATURED_PER_CATEGORY, random = Math.random } = {},
) {
  const list = (Array.isArray(products) ? products : []).filter(Boolean)
  const limit = Math.max(0, Math.trunc(Number(size) || 0))
  if (!list.length || !limit) return []

  const groups = groupByCategory(list)
  /* 分类顺序也洗：否则名额不够时，永远是同一批分类先拿（Map 是插入序）。 */
  const keys = shuffleInPlace([...groups.keys()], random)

  /* 每个分类先拿几个：默认 2，但分类一多（`分类数 × 2 > 24`）就降到 1，
   * 保证"每个目录至少一件"这条比"每个目录两件"更优先。 */
  const wanted = Math.max(1, Math.trunc(Number(perCategory) || 1))
  const quota = Math.min(wanted, Math.max(1, Math.floor(limit / keys.length)))

  const picks = []
  const leftovers = []

  for (const key of keys) {
    const pool = shuffleInPlace([...groups.get(key)], random)
    picks.push(...pool.slice(0, quota))
    leftovers.push(...pool.slice(quota))
  }

  /* 名额没满：从未被抽中的余量里随机补满。 */
  if (picks.length < limit) {
    picks.push(...shuffleInPlace(leftovers, random).slice(0, limit - picks.length))
  }

  /* 展示顺序再洗一次：上面的 picks 是按分类顺序堆起来的。 */
  return shuffleInPlace(picks.slice(0, limit), random)
}
