import { Component } from 'react'

/**
 * Error boundary
 * ──────────────
 * React unmounts the entire subtree when a render throws. Without a boundary
 * that means a blank page with nothing in the console the user can act on —
 * exactly what a missing import produced in the products tab.
 *
 * Two instances are mounted:
 *   · around <App/>          — the last resort, full-page message
 *   · around the admin <Outlet/> — keeps the tab bar and Log out usable, so a
 *     broken tab can be left rather than trapping the user on a white screen
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Mako] render failed', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const { compact = false, label = 'This page' } = this.props

    return (
      <div
        role="alert"
        className={
          compact
            ? 'rounded-2xl bg-red-50 px-4 py-5 ring-1 ring-red-200'
            : 'mx-auto mt-16 max-w-md rounded-2xl bg-white px-6 py-8 ring-1 ring-charcoal/10'
        }
      >
        <p className="text-[13px] font-medium text-red-700">
          {label} could not be displayed.
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-charcoal-light">
          Nothing was saved. Reloading usually clears it — if it keeps happening,
          the message below is what to look at.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-cream-dark/70 px-3 py-2 text-[10.5px] leading-relaxed text-charcoal-light">
          {String(error?.message || error)}
        </pre>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-charcoal px-3.5 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/90 active:scale-95"
          >
            Reload
          </button>
          {compact && (
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-full bg-white px-3.5 py-1.5 text-[11px] font-medium text-charcoal/70 ring-1 ring-charcoal/10 transition hover:text-charcoal active:scale-95"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }
}
