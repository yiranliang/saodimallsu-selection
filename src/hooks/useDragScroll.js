import { useCallback, useEffect, useRef, useState } from 'react'
import { dragScrollLeft, isDrag, wheelScrollDelta } from '../utils/horizontalScroll.js'

/**
 * 横向滚动栏的鼠标交互（滚轮 + 拖拽）
 * ════════════════════════════════════════
 * 手机上横向栏本来就能滑；桌面端只有触控板能滑。这个 hook 补上鼠标的两种
 * 姿势，并且不碰触摸：`pointerType !== 'mouse'` 直接返回，iOS/Android 的
 * 原生惯性滑动原样保留。
 *
 * 三个不能破坏的东西
 * ────────────────
 * 1. **点击**。按下不动、松手，还是点分类。只有位移超过 `DRAG_THRESHOLD`
 *    才算拖拽，而且拖完那一次 `click` 会在捕获阶段被吃掉 —— 否则松手就顺手
 *    把分类切了。
 * 2. **页面滚动**。滚轮到边就把事件还给页面（见 wheelScrollDelta），
 *    sticky 栏上不至于把整页锁死。
 * 3. **横向触控板手势**。`deltaX` 占优时完全不接管。
 *
 * 为什么用 window 上的 pointermove 而不是 setPointerCapture
 * ──────────────────────────────────────────────────────
 * 指针捕获会把随后那次 `click` 的目标改成捕获元素，普通点击就不再落在
 * 分类按钮上 —— 一个"能拖了但点不了"的导航。用 window 监听可以在不捕获的
 * 前提下跟到栏外，正常点击时一个监听器都不用挂。
 *
 * @param {unknown} watchKey 内容变化时重新测量"要不要显示抓手"（分类数量等）
 */
export function useDragScroll(watchKey) {
  const ref = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [scrollable, setScrollable] = useState(false)
  /** 指针状态放 ref：拖拽期间每帧都在变，进 state 就是每帧重渲染。 */
  const gesture = useRef({ down: false, dragging: false, startX: 0, startLeft: 0, suppressClick: false })
  /** 卸载时把还挂着的 window 监听摘掉（拖到一半关页面/切路由）。 */
  const teardown = useRef(null)

  useEffect(() => () => teardown.current?.(), [])

  /* 滚轮必须用原生监听：React 的 onWheel 走根节点委托，Chrome 里是 passive
   * 的，`preventDefault()` 会被忽略并报 "Unable to preventDefault"。 */
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const onWheel = (event) => {
      const delta = wheelScrollDelta(event, el)
      if (!delta) return
      event.preventDefault()
      el.scrollLeft += delta
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* 只有真的溢出时才给抓手光标 —— 一个"看着能拖但拖不动"的栏更让人困惑。
   * 内容宽度不会改变容器尺寸，ResizeObserver 观察自身拿不到，所以按
   * `watchKey` 重新量一次，外加窗口尺寸变化。 */
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const measure = () => setScrollable(el.scrollWidth - el.clientWidth > 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [watchKey])

  const onPointerDown = useCallback((event) => {
    const el = ref.current
    if (!el) return
    /* 只认鼠标左键。触摸和手写笔交给浏览器（原生惯性比我们模拟的好）。 */
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    if (el.scrollWidth - el.clientWidth <= 1) return

    const g = gesture.current
    g.down = true
    g.dragging = false
    g.suppressClick = false
    g.startX = event.clientX
    g.startLeft = el.scrollLeft

    const previousUserSelect = document.body.style.userSelect

    const move = (e) => {
      if (!g.down) return
      if (!g.dragging) {
        if (!isDrag(g.startX, e.clientX)) return
        g.dragging = true
        setDragging(true)
        /* 拖出栏外时会选到商品名/文案，拖拽期间先禁掉整页选中 */
        document.body.style.userSelect = 'none'
      }
      el.scrollLeft = dragScrollLeft(g.startLeft, g.startX, e.clientX)
    }

    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      teardown.current = null
      document.body.style.userSelect = previousUserSelect
      g.down = false
      if (!g.dragging) return
      g.dragging = false
      setDragging(false)
      /* 拖完浏览器还会补一个 click，交给 onClickCapture 吃掉。标志位不在这里
       * 清 —— 清早了 click 就漏过去，清晚了会吞掉下一次点击，所以由 click
       * 自己消费，下一次 pointerdown 再兜底复位。 */
      g.suppressClick = true
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    teardown.current = end
  }, [])

  const onClickCapture = useCallback((event) => {
    if (!gesture.current.suppressClick) return
    gesture.current.suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return { ref, dragging, scrollable, onPointerDown, onClickCapture }
}
