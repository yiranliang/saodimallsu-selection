import { useSyncExternalStore } from 'react'
import { getAuthState, subscribeAuth } from '../lib/auth.js'

/**
 * { status: 'loading' | 'signed-in' | 'signed-out', user, isAdmin, error }
 * The object identity only changes when something actually changed, which is
 * what useSyncExternalStore requires.
 */
export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
}
