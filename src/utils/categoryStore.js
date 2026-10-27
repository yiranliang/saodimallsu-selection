/**
 * Category store
 * ══════════════
 * The ordered list behind the storefront rail and the editor's suggestions.
 *
 * Two rules the database already knows, restated here because the UI has to
 * drive them in the right order:
 *
 *   · products.category is a foreign key on categories.name, so a product can
 *     never point at a category that does not exist
 *   · renaming onto an existing name MERGES the two — the FK cascade cannot do
 *     that, so the products are moved first and the old row is then deleted
 *
 * The list is a suggestion list, not a constraint: a hand-typed category is
 * auto-created by the `ensure_category` trigger and shows up here on the next
 * fetch.
 */

import { categories as DEFAULT_CATEGORIES } from '../data/products.js'
import { isConfigured, requireClient } from '../lib/supabase.js'
import { setProductsCategory } from '../store/productStore.js'

let status = isConfigured ? 'idle' : 'ready'
let cache = isConfigured ? [] : [...DEFAULT_CATEGORIES]
let inflight = null

/**
 * name → sort_order, kept beside `cache` for the same reason the product store
 * keeps `orderById`: the number is what the database orders by, and reordering
 * means swapping two of them. Without this map `nextSortOrder()` could only
 * guess from the array length — which put a newly added category *before*
 * Bras(8) and Leggings(9) instead of at the end.
 */
const sortOrderByName = new Map()

const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

function normalize(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function getCategories() {
  return cache
}

export function subscribeCategories(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function loadCategories({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    try {
      const { data, error } = await requireClient()
        .from('categories')
        .select('name, sort_order')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw new Error(error.message)

      sortOrderByName.clear()
      for (const row of data || []) {
        const name = String(row.name ?? '').trim()
        if (name) sortOrderByName.set(name, row.sort_order ?? 0)
      }

      cache = normalize((data || []).map((row) => row.name))
      status = 'ready'
    } catch (error) {
      status = 'error'
      throw error
    } finally {
      inflight = null
      notify()
    }
  })()

  return inflight
}

/* ── writes ──────────────────────────────────────────────────────────────── */

function nextSortOrder() {
  let max = -1
  for (const value of sortOrderByName.values()) max = Math.max(max, value)
  return max + 1
}

/** Add one category. Returns false when it is blank or already there. */
export async function addCategory(name) {
  const clean = String(name ?? '').trim()
  if (!clean) return false
  if (cache.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return false

  const sortOrder = nextSortOrder()
  const { error } = await requireClient()
    .from('categories')
    .insert({ name: clean, sort_order: sortOrder })

  if (error) throw new Error(error.message)

  cache = [...cache, clean]
  sortOrderByName.set(clean, sortOrder)
  notify()
  return true
}

/**
 * Swap a category with its neighbour — two updates, no reindex, exactly like
 * the product list. Categories are a handful of rows, so a full renumber would
 * also be fine; the swap is simply the same pattern the rest of the console
 * already uses, and it leaves the numbers alone.
 *
 * The storefront rail reads `getCategories()`, so it follows on the next render
 * (and other tabs on the next realtime refetch of the `categories` table).
 */
export async function moveCategory(name, direction) {
  const index = cache.indexOf(name)
  const target = index + direction
  if (index < 0 || target < 0 || target >= cache.length) return false

  const a = cache[index]
  const b = cache[target]
  const aOrder = sortOrderByName.get(a) ?? index
  const bOrder = sortOrderByName.get(b) ?? target

  const client = requireClient()
  const [first, second] = await Promise.all([
    client.from('categories').update({ sort_order: bOrder }).eq('name', a),
    client.from('categories').update({ sort_order: aOrder }).eq('name', b),
  ])

  const failure = first.error || second.error
  if (failure) throw new Error(failure.message)

  sortOrderByName.set(a, bOrder)
  sortOrderByName.set(b, aOrder)

  const next = [...cache]
  next[index] = b
  next[target] = a
  cache = next

  notify()
  return true
}

/**
 * Rename, moving the products in the same step.
 * Doing both here is what keeps the list and the products from drifting apart.
 */
export async function renameCategory(from, to) {
  const target = String(to ?? '').trim()
  if (!target || target === from) return { ok: false, moved: 0 }

  const merges = cache.some(
    (existing) => existing !== from && existing.toLowerCase() === target.toLowerCase(),
  )

  // 1. products first — otherwise the FK blocks the delete
  const moved = await setProductsCategory(from, target)

  // 2. then the category row: rename it, or drop it when merging into one
  const client = requireClient()
  const { error } = merges
    ? await client.from('categories').delete().eq('name', from)
    : await client.from('categories').update({ name: target }).eq('name', from)

  if (error) throw new Error(error.message)

  cache = merges
    ? cache.filter((name) => name !== from)
    : cache.map((name) => (name === from ? target : name))

  const movedOrder = sortOrderByName.get(from)
  sortOrderByName.delete(from)
  if (!merges && movedOrder !== undefined) sortOrderByName.set(target, movedOrder)

  notify()
  return { ok: true, moved, merged: merges }
}

/**
 * Drop a category. Its products move to the fallback bucket first, otherwise
 * the ON DELETE RESTRICT foreign key would reject the delete.
 */
export async function removeCategory(name) {
  if (!cache.includes(name)) return { ok: false, moved: 0 }

  const moved = await setProductsCategory(name, 'Uncategorised')

  const { error } = await requireClient().from('categories').delete().eq('name', name)
  if (error) throw new Error(error.message)

  cache = cache.filter((existing) => existing !== name)
  sortOrderByName.delete(name)
  notify()
  return { ok: true, moved }
}
