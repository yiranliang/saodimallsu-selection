import { Check, Info, AlertCircle } from './icons.jsx'

/**
 * Toast 提示组件
 * ────────────────
 * 固定居中，逐条堆叠，带淡入上滑动画。
 *
 * `position="bottom"` is used on the admin pages — their tab bar sits at the
 * top of the screen and a top-anchored toast would cover it.
 */
export default function Toast({ toasts, position = 'top' }) {
  if (!toasts.length) return null

  const anchor =
    position === 'bottom'
      ? 'bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex-col-reverse'
      : 'top-4'

  return (
    <div
      /* Announced, not just painted: a save that failed a side-effect (an ASIN
       * write, a badge colour the database cannot store) only exists as a toast,
       * so it has to reach a screen reader — and a test. */
      role="status"
      aria-live="polite"
      className={`fixed ${anchor} left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-slide-down flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-charcoal px-4 py-2.5 text-sm text-cream shadow-xl"
        >
          {toast.type === 'success' && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
          {toast.type === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />}
          {toast.type === 'default' && <Info className="h-4 w-4 shrink-0 text-accent-light" />}
          <span className="truncate">{toast.message}</span>
        </div>
      ))}
    </div>
  )
}
