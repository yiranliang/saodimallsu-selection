import { useEffect, useRef, useState } from 'react'
import ProductImage from './ProductImage.jsx'

/**
 * 变体图交叉淡入
 * ──────────────
 * 换颜色时如果直接改 `src`，浏览器会先把旧图画布清空再画新的 —— 白底商品图
 * 上就是一下白闪。这一层把"换"拆成三步：
 *
 *   1. 新图先用一个游离的 `Image()` 预载，**旧图继续显示**（没有空白帧）
 *   2. 载入完成后新图垫在下面，旧图盖在上面
 *   3. 下一帧把旧图淡出（300ms），淡完即卸载，DOM 恢复成一张图
 *
 * 为什么让旧图淡出、而不是新图淡入
 * ──────────────────────────────
 * 新图淡入需要一个"从 0 到 1"的二次渲染（挂载时是 0，下一帧才变 1），
 * 中间那帧如果掉帧就会看到闪烁；而旧图淡出只需要一次状态翻转，且新图在
 * 底下已经是完整亮度，任何一帧截下来都是合法画面。
 *
 * `prefers-reduced-motion` 下旧图直接隐藏，不做过渡。
 */
export default function CrossfadeImage({ src, fallback, alt = '', className = '', ...rest }) {
  const [shown, setShown] = useState(src)
  const [outgoing, setOutgoing] = useState(null)
  const [fading, setFading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (!src || src === shown) return undefined

    let alive = true
    const swap = () => {
      if (!alive) return
      setOutgoing(shown)
      setShown(src)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setOutgoing(null), 340)
    }

    /* 单测/SSR 里没有 Image 构造器；直接换，别把界面卡住 */
    if (typeof window === 'undefined' || typeof window.Image !== 'function') {
      swap()
      return undefined
    }

    const probe = new window.Image()
    probe.onload = swap
    /* 载入失败也换 —— 让 `ProductImage` 自己的 fallback 链（变体图 → 主图 →
     * 占位图）去兜底，而不是把旧颜色永远留在屏幕上。 */
    probe.onerror = swap
    probe.src = src
    if (probe.complete) swap()

    return () => {
      alive = false
    }
  }, [src, shown])

  /* 旧图挂上来的那一帧还是 opacity-100，下一帧才切到 0，否则没有过渡可言 */
  useEffect(() => {
    if (!outgoing) {
      setFading(false)
      return undefined
    }
    const id = requestAnimationFrame(() => setFading(true))
    return () => cancelAnimationFrame(id)
  }, [outgoing])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <>
      <ProductImage
        key={shown}
        src={shown}
        fallback={fallback}
        alt={alt}
        className={className}
        {...rest}
      />
      {outgoing && (
        <ProductImage
          src={outgoing}
          fallback={fallback}
          alt=""
          aria-hidden="true"
          className={`${className} pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:hidden ${
            fading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
    </>
  )
}
