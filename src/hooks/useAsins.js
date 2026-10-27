import { useSyncExternalStore } from 'react'
import { getAsins, getAsinsStatus, subscribeAsins } from '../utils/asinStore.js'

/**
 * Subscribe to the ASIN map.
 * The admin list reads it for search and for the ASIN count per 货号, so it
 * has to re-render when realtime replaces the map.
 */
export function useAsins() {
  return useSyncExternalStore(subscribeAsins, getAsins, getAsins)
}

/**
 * Subscribe to the load state of that map.
 *
 * The list needs it to tell "this product has no ASINs" from "the ASIN table has
 * not arrived yet" — the second one is a blank screen for a moment, and painting
 * every card red during it would train ops to ignore the badge.
 */
export function useAsinsStatus() {
  return useSyncExternalStore(subscribeAsins, getAsinsStatus, getAsinsStatus)
}
