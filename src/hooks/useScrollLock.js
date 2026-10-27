import { useEffect } from 'react'

/**
 * 锁住页面滚动，卸载时解开。
 * ─────────────────────────
 * 为什么是**引用计数**而不是"存旧值 → hidden → 还原"
 * ────────────────────────────────────────────────
 * 两个遮罩同时开着（引导盖在商品弹层上、或者从 ? 打开引导时购物袋还开着），
 * 先关掉的那个会把 `overflow` 还原成 `''` —— 于是底下那个还开着的弹层背后，
 * 页面开始跟着手指滚。这不是理论问题：引导是"任何时候都能点 ?"打开的。
 *
 * 计数到 0 才真正还原，且还原的是**第一次加锁前的原值**（可能是 ''，也可能是
 * 别处设过的值）。
 *
 * 桌面端还有一个副作用要补：`overflow: hidden` 让滚动条消失，视口宽出约
 * 15px，整页会横向跳一下。所以同时补上等宽的 `padding-right`。
 */
let locks = 0
let savedOverflow = ''
let savedPaddingRight = ''

function acquire() {
  if (typeof document === 'undefined') return
  const body = document.body
  if (locks === 0) {
    savedOverflow = body.style.overflow
    savedPaddingRight = body.style.paddingRight

    /* A page that already has a permanent scrollbar is the only case that needs
     * the compensation — on mobile (overlay scrollbars) the value is 0. */
    const gap = window.innerWidth - document.documentElement.clientWidth
    if (gap > 0) body.style.paddingRight = `${gap}px`

    body.style.overflow = 'hidden'
  }
  locks += 1
}

function release() {
  if (typeof document === 'undefined') return
  locks = Math.max(0, locks - 1)
  if (locks > 0) return

  const body = document.body
  body.style.overflow = savedOverflow
  body.style.paddingRight = savedPaddingRight
}

/**
 * @param {boolean} active 为 true 时加锁，变 false 或卸载时解锁
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    acquire()
    return release
  }, [active])
}

/** 仅测试用：当前锁了几层。生产代码不该读它。 */
export function __scrollLockCount() {
  return locks
}
