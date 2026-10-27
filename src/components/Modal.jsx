import { useEffect } from 'react'
import { useScrollLock } from '../hooks/useScrollLock.js'

/**
 * 通用弹窗外壳
 * ──────────────
 * - 移动端：从底部滑出的 sheet（圆角上边）
 * - 桌面端：居中弹窗
 * - 点击遮罩 / 按 Esc 关闭
 * - 打开时锁定 body 滚动
 */
export default function Modal({ open, onClose, children, title, maxWidth = 'max-w-lg' }) {
  /* 锁定背景滚动。抽到 `useScrollLock` 是因为引导也要锁，而两份实现会在
   * 「两个遮罩同时打开、先关一个」时把 overflow 提前还原 —— 详见那个文件。 */
  useScrollLock(open)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 animate-fade-in bg-charcoal/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* 内容容器 */}
      <div
        className={`relative z-10 max-h-[92vh] w-full ${maxWidth} animate-slide-up overflow-hidden rounded-t-3xl bg-cream shadow-2xl sm:animate-scale-in sm:rounded-3xl`}
      >
        {children}
      </div>
    </div>
  )
}
