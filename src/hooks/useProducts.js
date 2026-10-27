import { useSyncExternalStore } from 'react'
import {
  getProducts,
  subscribeProducts,
  getCatalogueStatus,
  subscribeCatalogueStatus,
} from '../store/productStore.js'

/**
 * Subscribe a component to the product catalogue.
 * Re-renders when the cache is replaced — a local write or a realtime refetch.
 */
export function useProducts() {
  return useSyncExternalStore(subscribeProducts, getProducts, getProducts)
}

/** 'idle' | 'loading' | 'ready' | 'error' — drives skeletons and error states. */
export function useCatalogueStatus() {
  return useSyncExternalStore(
    subscribeCatalogueStatus,
    getCatalogueStatus,
    getCatalogueStatus,
  )
}
