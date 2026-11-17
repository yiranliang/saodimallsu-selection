import { useEffect, useState } from 'react'
import { columnsForWidth } from '../utils/grid.js'

/**
 * 当前窗口下网格有几列。
 *
 * 用 `innerWidth` + resize 监听，而不是 CSS 查询：分页需要这个数字来决定
 * "这一页放几件"，CSS 拿不到。监听用 rAF 合并，拖窗口时不会每像素算一次。
 *
 * SSR / 无 window 时给手机端的两列 —— 服务端渲染的页面上先按最保守的值来。
 */
export function useGridColumns() {
  const [cols, setCols] = useState(() =>
    typeof window === 'undefined' ? 2 : columnsForWidth(window.innerWidth),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    let frame = 0
    const read = () => {
      frame = 0
      setCols(columnsForWidth(window.innerWidth))
    }
    const onResize = () => {
      if (frame) return
      frame = window.requestAnimationFrame(read)
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  return cols
}
