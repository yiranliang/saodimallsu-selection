/**
 * Supabase client
 * ───────────────
 * One instance for the whole app. The anon (publishable) key is safe to ship:
 * it only grants what the RLS policies allow. Writes need a signed-in user on
 * the admin allowlist — that is enforced in Postgres, not here.
 *
 * Session storage is sessionStorage, not localStorage: the pass only lives as
 * long as the tab, which is what the old passcode gate did too. Close the tab
 * on a shared machine and nobody can walk back in.
 *
 * Node-safe: `import.meta.env` is undefined outside Vite, so the module falls
 * back to an unconfigured client instead of throwing. That keeps the pure
 * utilities importable from `node scripts/*.mjs`.
 */

import { createClient } from '@supabase/supabase-js'

const env = import.meta.env ?? {}

export const SUPABASE_URL = env.VITE_SUPABASE_URL || ''
export const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || ''

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

const tabStorage = {
  getItem: (key) => {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      /* private mode — the session just won't survive a reload */
    }
  },
  removeItem: (key) => {
    try {
      window.sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: tabStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null

/** Throws a readable error instead of `Cannot read property of null`. */
export function requireClient() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env',
    )
  }
  return supabase
}
