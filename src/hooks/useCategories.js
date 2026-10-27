import { useSyncExternalStore } from 'react'
import { getCategories, subscribeCategories } from '../utils/categoryStore.js'

/**
 * Subscribe a component to the category list.
 * Re-renders when the admin adds, renames or removes a category.
 */
export function useCategories() {
  return useSyncExternalStore(subscribeCategories, getCategories, getCategories)
}
