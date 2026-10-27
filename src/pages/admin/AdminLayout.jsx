import { useCallback, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Toast from '../../components/Toast.jsx'
import ErrorBoundary from '../../components/ErrorBoundary.jsx'
import { useToast } from '../../hooks/useToast.js'
import { signOut } from '../../lib/auth.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useSessionTimeout } from '../../hooks/useSessionTimeout.js'
import { readIdleTimeoutMs } from '../../utils/adminSecurity.js'
import { t } from '../../i18n/admin.js'
import { Search, Bag, Code, LogOut } from '../../components/icons.jsx'

/**
 * Admin shell
 * ────────────
 * Hidden from the storefront — no link points here. Tabs share one toast
 * instance so any child can call showToast via context-free props.
 */
/* 后台的中文标签在这里查表（`src/i18n/admin.js`）。前台一个 `t()` 都不引。 */
const TABS = [
  { to: '/admin', label: 'Lookup', icon: Search, end: true },
  { to: '/admin/products', label: 'Products', icon: Bag },
  { to: '/admin/developer', label: 'Developer', icon: Code },
]

export default function AdminLayout() {
  const { toasts, showToast } = useToast()
  const { user } = useAuth()
  const { pathname } = useLocation()

  /* Shield 3 — idle auto-logout. A public-machine guard: after 120 minutes of
     no real activity (click / key / scroll / touch — not hover) the session is
     dropped and the gate reclaims the screen. The timeout is the configurable
     constant; a test can shorten it via localStorage.adminIdleMs (capped) without
     touching production behaviour, because nobody sets that key for real. */
  const expiredRef = useRef(false)
  const handleSessionExpire = useCallback(() => {
    if (expiredRef.current) return
    expiredRef.current = true
    showToast?.(t('Session expired due to inactivity'), 'default', 2200)
    // Let the toast breathe for a beat before the gate takes over the screen.
    setTimeout(() => signOut(), 1600)
  }, [showToast])
  useSessionTimeout({ timeoutMs: readIdleTimeoutMs(), onExpire: handleSessionExpire })

  return (
    <div className="min-h-screen bg-cream">
      {/* The console is used sitting at a desk, so from `lg` up it uses the
          whole screen instead of staying phone-width. Pages that should stay
          narrow (lookup, developer) carry their own `max-w-*` on an inner
          wrapper, so they are unaffected by this. The storefront is a separate
          tree entirely — nothing here can reach it. */}
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12 lg:max-w-[1680px] lg:px-8">
        {/* Brand row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-charcoal text-[11px] font-bold text-cream">
              A
            </div>
            <span className="text-[11px] font-medium tracking-[0.16em] text-charcoal-light">
              {t('ADMIN CONSOLE')}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="#/"
              className="text-[11px] text-charcoal-light transition hover:text-charcoal"
            >
              {t('← Storefront')}
            </a>

            {user?.email && (
              <span className="hidden max-w-[160px] truncate text-[10.5px] text-charcoal-light/70 sm:inline">
                {user.email}
              </span>
            )}

            {/* Ends the Supabase session; the gate re-appears immediately */}
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-1 rounded-full bg-cream-dark/80 px-2.5 py-1 text-[10.5px] font-medium text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal active:scale-95"
            >
              <LogOut className="h-3 w-3" />
              {t('Log out')}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="mt-5 flex gap-1 rounded-full bg-cream-dark/80 p-1">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium transition ${
                  isActive
                    ? 'bg-white text-charcoal shadow-sm'
                    : 'text-charcoal-light hover:text-charcoal'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {t(label)}
            </NavLink>
          ))}
        </nav>

        <div className="mt-7">
          {/* keyed on the path so switching tabs clears a previous crash */}
          <ErrorBoundary key={pathname} compact label="This tab">
            <Outlet context={{ showToast }} />
          </ErrorBoundary>
        </div>
      </div>

      <Toast toasts={toasts} position="bottom" />
    </div>
  )
}
