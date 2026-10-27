import { useEffect } from 'react'

/**
 * Staff entrance
 * ──────────────
 * Two ways in, both deliberately quiet:
 *
 *   1. a footer link in 10px, 35% grey — findable if you know to look, easy to
 *      scroll past if you don't
 *   2. typing `admin` anywhere on the storefront
 *
 * The shortcut exists because the link is, by design, nearly invisible: the
 * person who needs it should not have to hunt for a grey word at the bottom of
 * a 139-card grid. It is also safer than a button — a creator tapping around
 * the page will never trigger it.
 *
 * It refuses to fire while she is typing (search box, code input, contenteditable)
 * and ignores any modified key press, so it cannot collide with browser
 * shortcuts or eat her text.
 */

const SEQUENCE = 'admin'
/** Letters typed further apart than this start a new attempt */
const RESET_AFTER_MS = 1200

export default function StaffAccess() {
  useEffect(() => {
    let buffer = ''
    let last = 0

    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }

      /* Only single characters count — otherwise Shift, Tab and the arrows
       * would reset the buffer and the shortcut would feel broken. */
      if (event.key.length !== 1) return

      const now = Date.now()
      if (now - last > RESET_AFTER_MS) buffer = ''
      last = now

      buffer = (buffer + event.key.toLowerCase()).slice(-SEQUENCE.length)
      if (buffer !== SEQUENCE) return

      buffer = ''
      window.location.hash = '#/admin'
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <a
      href="#/admin"
      className="text-[11px] tracking-wider text-charcoal-light/45 transition hover:text-charcoal-light/75 focus-visible:text-charcoal-light/75"
    >
      Admin Login
    </a>
  )
}
