/**
 * 横向滚动栏的鼠标交互 —— 纯计算部分
 * ════════════════════════════════════
 * 分类栏在手机上本来就能滑，但桌面端只有触控板用户滑得动：一个普通鼠标既
 * 没有横向滚轮，也不能按住拖动。于是分类一多，右边那几项就永远点不到。
 *
 * 这一层只回答两个问题，不碰 DOM、不碰 React，所以能在 Node 里直接测：
 *
 *   1. 这个滚轮事件该不该被翻译成横向滚动？翻译多少像素？
 *   2. 拖了这么远，算"点击"还是算"拖拽"？
 *
 * 为什么滚轮不能无条件吃掉
 * ──────────────────────
 * 分类栏是 sticky 的，鼠标很容易停在它上面。如果无条件 `preventDefault`，
 * 用户想往下看商品时会发现页面不动了 —— 那比"滑不到右边"更烦人。
 * 所以只有**还能往那个方向滚**的时候才接管；到了头就把事件还给页面。
 *
 * 触控板的横向手势（`deltaX` 大于 `deltaY`）也不接管：浏览器本来就会左右滚，
 * 再翻译一次等于滚两倍。
 */

/** 超过这个像素才算拖拽；小于它仍然是点击（手抖不该切分类）。 */
export const DRAG_THRESHOLD = 5

/** `deltaMode === 1` 时浏览器给的是"行"，一行按 16px 折算。 */
const LINE_HEIGHT = 16

/**
 * 还能横向走多远（0 = 没有溢出，不需要任何特殊处理）。
 *
 * @param {{scrollWidth?:number, clientWidth?:number}|null} el
 * @returns {number}
 */
export function overflowOf(el) {
  if (!el) return 0
  const max = Number(el.scrollWidth) - Number(el.clientWidth)
  return Number.isFinite(max) && max > 0 ? max : 0
}

/**
 * 滚轮事件 → 应该给 `scrollLeft` 加多少像素。返回 `0` 表示"别管，交给浏览器"。
 *
 * @param {{deltaX?:number, deltaY?:number, deltaMode?:number}|null} event
 * @param {{scrollWidth?:number, clientWidth?:number, scrollLeft?:number}|null} el
 * @returns {number}
 */
export function wheelScrollDelta(event, el) {
  const max = overflowOf(el)
  if (!max) return 0

  const dx = Number(event?.deltaX) || 0
  const dy = Number(event?.deltaY) || 0

  /* 触控板的横向手势（或 shift + 滚轮，Chrome 会把它变成 deltaX）—— 浏览器
   * 自己就会滚，再翻译一次就是双倍速。 */
  if (Math.abs(dx) > Math.abs(dy)) return 0
  if (!dy) return 0

  const mode = Number(event?.deltaMode) || 0
  const unit = mode === 1 ? LINE_HEIGHT : mode === 2 ? Number(el?.clientWidth) || 0 : 1
  const amount = dy * unit
  if (!amount) return 0

  const left = Number(el?.scrollLeft) || 0
  /* 已经在边缘还往外滚 → 让页面滚。留 1px 容差：高分屏的 scrollLeft 是小数。 */
  if (amount > 0 && left >= max - 1) return 0
  if (amount < 0 && left <= 1) return 0

  return amount
}

/**
 * 拖拽中的 `scrollLeft`：指针往左拖 → 内容往左走 → scrollLeft 变大。
 *
 * @param {number} startLeft 按下时的 scrollLeft
 * @param {number} startX    按下时的 clientX
 * @param {number} clientX   当前的 clientX
 * @returns {number}
 */
export function dragScrollLeft(startLeft, startX, clientX) {
  const base = Number(startLeft) || 0
  const dx = (Number(clientX) || 0) - (Number(startX) || 0)
  return base - dx
}

/**
 * 这次移动够不够"拖拽"。
 *
 * @param {number} startX
 * @param {number} clientX
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isDrag(startX, clientX, threshold = DRAG_THRESHOLD) {
  return Math.abs((Number(clientX) || 0) - (Number(startX) || 0)) >= threshold
}
