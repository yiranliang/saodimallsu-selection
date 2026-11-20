import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  getCategories,
  getCategoryGroups,
  subscribeCategories,
} from '../utils/categoryStore.js'

/**
 * Subscribe a component to the category list.
 * Re-renders when the admin adds, renames or removes a category.
 */
export function useCategories() {
  return useSyncExternalStore(subscribeCategories, getCategories, getCategories)
}

/**
 * name → 一级分组（设置里配过的那些）。
 *
 * 用 state 而不是 useSyncExternalStore：getCategoryGroups() 每次都返回新对象，
 * 直接当快照会让 React 认为"永远变了"。
 */
export function useCategoryGroups() {
  const [groups, setGroups] = useState(() => getCategoryGroups())

  useEffect(() => {
    const update = () => setGroups(getCategoryGroups())
    update()
    return subscribeCategories(update)
  }, [])

  return groups
}
