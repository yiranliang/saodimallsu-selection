import { useSyncExternalStore } from 'react'
import { getSettings, subscribeSettings } from '../utils/settingsStore.js'

/**
 * Subscribe a component to the site settings (currently the deals tab label).
 *
 * `useSyncExternalStore` rather than state + effect: the store is the single
 * source, another tab's change arrives over realtime and notifies the same
 * listeners, and the server/initial snapshot is the same object — so there is
 * no flash of a stale label.
 */
export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings)
}
