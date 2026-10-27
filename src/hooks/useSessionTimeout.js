import { useEffect, useRef } from 'react'

/**
 * Idle-session guard for the admin console.
 * ──────────────────────────────────────────
 * After `timeoutMs` of no *real* user activity (mouse click, keyboard input,
 * scroll, wheel, touch) the supplied `onExpire` fires exactly once. Any covered
 * activity restarts the clock.
 *
 * We deliberately do NOT count `mousemove` — leaving the cursor resting on the
 * screen is not "using" the console, and a guard that resets on hover would
 * never fire on an unattended public machine.
 *
 * `onExpire` is held in a ref so swapping the callback does not restart the
 * timer, and the timer is cleared on unmount so leaving /admin stops the guard.
 *
 * @param {{ timeoutMs?: number, onExpire?: () => void, enabled?: boolean }} [opts]
 */
export function useSessionTimeout({ timeoutMs = 480 * 60 * 1000, onExpire, enabled = true } = {}) {
  const timer = useRef(null)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    if (!enabled) return undefined

    // Activity that counts as "the operator is still here".
    const ACTIVITY = ['click', 'keydown', 'scroll', 'wheel', 'touchstart']

    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    const arm = () => {
      clear()
      timer.current = setTimeout(() => {
        timer.current = null
        onExpireRef.current?.()
      }, timeoutMs)
    }

    arm()
    ACTIVITY.forEach((type) => window.addEventListener(type, arm, { passive: true }))

    return () => {
      ACTIVITY.forEach((type) => window.removeEventListener(type, arm))
      clear()
    }
  }, [timeoutMs, enabled])
}
