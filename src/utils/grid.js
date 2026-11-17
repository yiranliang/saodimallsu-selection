/**
 * 目录网格的列数 / 每页件数
 * ══════════════════════════
 *
 * 为什么要算这个
 * ──────────────
 * 每页固定 20 件是当初为了省 Supabase 流量定的，但它会在网格里留下半行 ——
 * 3 列时 20 = 6 行 + 2 个空位，看起来像少加载了商品。
 *
 * 所以规则改成：**一页尽量凑满整行**，目标 24 件，向上取整到列数的整数倍：
 *
 *   2 列 → 24（12 行）   3 列 → 24（8 行）   4 列 → 24（6 行）
 *   5 列 → 25（5 行）    6 列 → 24（4 行）
 *
 * 一次请求的上限因此只在小范围浮动（24–25），流量成本和以前一样。
 *
 * 断点必须和 `GRID_CLASS` 里的 Tailwind 断点一一对应，否则会算出"5 列但
 * 屏幕显示 4 列"这种对不上的情况。
 */

/** 目标每页件数（不含凑整）。 */
export const TARGET_PAGE = 24

/** 宽 → 列数，顺序从宽到窄，和 Tailwind 的 2xl/xl/lg/md 对齐。 */
export const GRID_BREAKPOINTS = [
  { min: 1536, cols: 6 }, // 2xl
  { min: 1280, cols: 5 }, // xl
  { min: 1024, cols: 4 }, // lg
  { min: 768, cols: 3 }, //  md
  { min: 0, cols: 2 }, //   手机
]

/** 网格容器的 class（`useGridColumns` 的断点必须和它一致）。 */
export const GRID_CLASS =
  'grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'

/**
 * @param {number} width 视口宽度（px）
 * @returns {number} 列数
 */
export function columnsForWidth(width) {
  const w = Number(width)
  if (!Number.isFinite(w) || w <= 0) return 2
  return GRID_BREAKPOINTS.find((bp) => w >= bp.min).cols
}

/**
 * 每页件数 = 24 向上取整到列数的倍数。
 *
 * @param {number} cols
 * @returns {number}
 */
export function pageSizeFor(cols) {
  const n = Math.floor(Number(cols))
  if (!Number.isFinite(n) || n <= 0) return TARGET_PAGE
  return Math.ceil(TARGET_PAGE / n) * n
}
