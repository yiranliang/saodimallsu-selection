/**
 * Featured for You — 抽样算法
 * ═══════════════════════════
 * 300+ 件商品里，红人通常只看首屏，后面的款式几乎没有曝光。这一块在网格
 * **上方**随机挑 24 件，每次加载 / 点 Shuffle 换一批。
 *
 * 为什么是**全库纯随机**，而不是"每个分类保底 1–2 件"
 * ──────────────────────────────────────────────
 * 保底那版的出发点是"每个目录都有曝光"，但它有个反效果：只有一两件商品的
 * 小分类，每次都会被抽中**同一个**商品 —— Shuffle 十次，出来的还是它，
 * 比不推荐更没新鲜感。而且 24 个名额先按分类派完，大类目只剩边角，
 * "随机"实际上被分类配额吃掉了。
 *
 * 现在就是一次 Fisher–Yates 洗牌后取前 24：任何一件商品出现在推荐位的概率
 * 相同，与它属于哪个分类、那个分类有多大无关。小类目不再保底，但也不再被
 * 系统性偏爱 —— 要保曝光，应该是运营去改目录结构，而不是让抽样算法代劳。
 *
 * 纯函数 + 注入随机源：Node 里用固定种子就能重放，浏览器里传 `Math.random`
 * （种子在 SelectionPage 挂载时取一次）。**不碰 `sort_order`、不碰数据库**，
 * 只是读取顺序之上的一次采样；下方常规网格的顺序仍然由后台拖拽决定。
 */

/** 推荐位固定展示多少件。 */
export const FEATURED_SIZE = 24

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
 * 为什么不用 `Math.random` 直接测：随机性断言需要**可复现**的洗牌，否则失败
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
 * 从整个目录里纯随机抽 `size` 件。
 *
 * 先洗整池再切前 N —— 等价于"无放回抽 N 次"，所以天然不重复；池子比 N 小时
 * 会把所有商品都给出去，而不是少给。
 *
 * @param {object[]} products 当前可售目录（调用方已排除 hidden）
 * @param {{ size?: number, random?: () => number }} [options]
 * @returns {object[]} 新数组；长度 = min(size, products.length)
 */
export function pickFeatured(products, { size = FEATURED_SIZE, random = Math.random } = {}) {
  const list = (Array.isArray(products) ? products : []).filter(Boolean)
  const limit = Math.max(0, Math.trunc(Number(size) || 0))
  if (!list.length || !limit) return []

  return shuffleInPlace([...list], random).slice(0, limit)
}
