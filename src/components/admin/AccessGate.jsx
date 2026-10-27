import { useEffect, useRef, useState } from 'react'
import { Lock } from '../icons.jsx'
import { signIn, signOut } from '../../lib/auth.js'
import { useAuth } from '../../hooks/useAuth.js'
import { t } from '../../i18n/admin.js'

/**
 * Admin access gate
 * ─────────────────
 * Wraps every /admin route. While not signed in it renders this screen
 * **instead of** the admin pages, so their content never enters the DOM —
 * there is nothing to flash, peek through, or inspect.
 *
 * The passcode form is gone. `signIn` calls Supabase Auth, and the returned JWT
 * is what makes the RLS write policies pass. Signing in is not the same as
 * being allowed: `isAdmin` reflects the `admin_users` allowlist, and a
 * self-registered account that is not on it gets a clear refusal instead of a
 * console where every save fails.
 */
export function AdminGate({ children }) {
  const auth = useAuth()

  if (auth.status === 'loading') return <GateShell title={t('Checking session')}>…</GateShell>

  if (auth.status !== 'signed-in') return <AccessGate error={auth.error} />

  if (!auth.adminChecked) {
    return (
      <GateShell title={t('Checking access')}>{t('Verifying your account…')}</GateShell>
    )
  }

  if (!auth.isAdmin) return <NotAllowed email={auth.user?.email} />

  return children
}

/** Shared chrome so all three states look like the same screen. */
function GateShell({ title, children }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-gate-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-cream"
    >
      <div className="flex min-h-full items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-charcoal text-cream">
              <Lock className="h-6 w-6" />
            </div>
            <h1
              id="access-gate-title"
              className="mt-5 text-[22px] font-semibold tracking-tight text-charcoal"
            >
              {title}
            </h1>
            <div className="mt-2 max-w-[300px] text-[12.5px] leading-relaxed text-charcoal-light">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NotAllowed({ email }) {
  return (
    <GateShell title={t('Not authorised')}>
      <p>
        <span className="font-medium text-charcoal">{email || t('This account')}</span>
        {t('signed in, but')}
        {t('it is not on the admin allowlist.')}
      </p>
      <p className="mt-2">
        {t('Ask an owner to add it to')}{' '}
        <span className="font-mono text-[11px]">public.admin_users</span>
      </p>

      <button
        type="button"
        onClick={signOut}
        className="mt-6 w-full rounded-full bg-charcoal py-3 text-[13px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-[0.98]"
      >
        {t('Sign out')}
      </button>
    </GateShell>
  )
}

export function AccessGate({ error: initialError = '' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const emailRef = useRef(null)

  useEffect(() => {
    emailRef.current?.focus({ preventScroll: true })
  }, [])

  const fail = (message) => {
    setError(message)
    setPassword('')
    setShake(true)
    window.setTimeout(() => setShake(false), 450)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (busy) return

    if (!email.trim() || !password) {
      fail(t('Enter your email and password.'))
      return
    }

    setBusy(true)
    setError('')
    const result = await signIn(email, password)
    setBusy(false)

    if (!result.ok) fail(result.error)
    // On success the auth store flips to signed-in and this component unmounts.
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-gate-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-cream"
    >
      <div className="flex min-h-full items-center justify-center px-5 py-12">
        <div className={`w-full max-w-[380px] ${shake ? 'animate-shake' : ''}`}>
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-charcoal text-cream">
              <Lock className="h-6 w-6" />
            </div>

            <h1
              id="access-gate-title"
              className="mt-5 text-[22px] font-semibold tracking-tight text-charcoal"
            >
              {t('Access Required')}
            </h1>
            <p className="mt-2 max-w-[300px] text-[12.5px] leading-relaxed text-charcoal-light">
              {t(
                'This area is for the Saodimallsu team. Sign in with your admin account to open the console.',
              )}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-7" noValidate>
            <label
              htmlFor="access-email"
              className="block text-[11px] font-medium uppercase tracking-[0.12em] text-charcoal-light"
            >
              {t('Email')}
            </label>
            <input
              id="access-email"
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) setError('')
              }}
              aria-label="Email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@brand.com"
              className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-[14px] text-charcoal ring-1 ring-charcoal/[0.12] transition placeholder:text-charcoal-light/40 focus:outline-none focus:ring-charcoal/35"
            />

            <label
              htmlFor="access-password"
              className="mt-3.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-charcoal-light"
            >
              {t('Password')}
            </label>
            <input
              id="access-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (error) setError('')
              }}
              aria-label="Password"
              autoComplete="current-password"
              placeholder={t('Your password')}
              className={`mt-2 w-full rounded-xl bg-white px-4 py-3 text-[14px] text-charcoal ring-1 transition placeholder:text-[13px] placeholder:text-charcoal-light/40 focus:outline-none ${
                error ? 'ring-2 ring-red-400 focus:ring-red-400' : 'ring-charcoal/[0.12] focus:ring-charcoal/35'
              }`}
            />

            {/* Reserved space so the button does not jump when the error shows */}
            <div className="min-h-[22px] pt-1.5">
              {error && (
                <p
                  id="access-gate-error"
                  role="alert"
                  className="flex items-start gap-1.5 text-[11.5px] font-medium leading-4 text-red-600"
                >
                  <span aria-hidden="true">⚠</span>
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-full bg-charcoal py-3 text-[13px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? t('Signing in…') : t('Sign in')}
            </button>
          </form>

          <p className="mt-5 text-center text-[10.5px] leading-relaxed text-charcoal-light/70">
            {t('Access is remembered in this tab only.')}
          </p>

          <div className="mt-6 text-center">
            <a
              href="#/"
              className="text-[11px] text-charcoal-light underline-offset-4 transition hover:text-charcoal hover:underline"
            >
              {t('← Back to storefront')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
