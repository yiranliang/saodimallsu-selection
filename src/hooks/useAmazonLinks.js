import { useSyncExternalStore } from 'react'
import { getLinks, subscribeLinks } from '../store/linkStore.js'

/**
 * Subscribe a component to the product → ASIN map.
 * Re-renders when the cloud fetch lands or a refetch replaces the map.
 */
export function useAmazonLinks() {
  return useSyncExternalStore(subscribeLinks, getLinks, getLinks)
}
