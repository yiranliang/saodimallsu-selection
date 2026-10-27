/**
 * ASIN map — runtime access
 * ═════════════════════════
 * Shape: { [货号]: { 'Colour|Size': 'ASIN' } } — one ASIN per variant, so the
 * admin lookup can name the exact listing instead of dumping a list.
 *
 * Read access is restricted to allowlisted admins in RLS. Creators never need
 * ASINs, so the storefront works logged-out while the sensitive table stays
 * shut. A denied table returns zero rows rather than an error, which is why
 * an empty map here is normal for an anonymous visitor.
 *
 * THE BUNDLED SNAPSHOT IS NOT IN THE MAIN BUNDLE
 * `src/data/asins.js` used to be a static import, which meant all ~4500 ASINs
 * shipped inside the public JS — anyone could read them from DevTools, making
 * the RLS policy on the table decorative. It is now a dynamic import that only
 * fires when Supabase is NOT configured (a bare `npm run dev` with no .env).
 * Vite emits it as a separate chunk that production never requests, so the
 * deployed bundle contains no ASINs at all.
 *
 * Reads are synchronous for the same reason as the product store: `utils/code.js`
 * must stay a pure function over a plain object.
 */

import { isConfigured, requireClient } from '../lib/supabase.js'
import { ASIN_PATTERN } from './amazon.js'
import { variantKey } from './sku.js'

/**
 * No bundled snapshot — deliberately.
 *
 * `src/data/asins.js` is still in the repo because `npm run push` and
 * `npm run catalog` read it from disk, but **nothing under `src/` imports it
 * any more**. That is the only reliable way to keep ~4500 ASINs out of the
 * shipped JavaScript: a dynamic import still emits a chunk and leaves an
 * `import("./asins-xxxx.js")` reference in the bundle, so the data stays one
 * URL away from anyone with DevTools.
 *
 * Consequence: without a configured database the ASIN map is empty, and the
 * admin lookup shows "No matching ASIN" for every line. That is the correct
 * state — ASINs are allowlist-only data and only ever come from Postgres.
 */

let status = isConfigured ? 'idle' : 'ready'
let cache = {}
let inflight = null

const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

/**
 * Build the variant key used by the generated map.
 * The implementation lives in `utils/sku.js` so that `soldOut.js` can share it
 * without pulling Supabase (this module) into the Node test suite.
 */
export { variantKey }

/** Validate and clean the nested map; returns null on the legacy flat shape. */
function normalizeMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null

  const clean = {}
  for (const [sku, variants] of Object.entries(map)) {
    if (Array.isArray(variants)) return null
    if (!variants || typeof variants !== 'object') continue

    const entry = {}
    for (const [key, asin] of Object.entries(variants)) {
      if (key) entry[key] = String(asin ?? '').trim()
    }
    clean[sku] = entry
  }
  return clean
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function getAsins() {
  return cache
}

export function getAsinsStatus() {
  return status
}

export function subscribeAsins(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The variant map for one 货号, always an object */
export function getVariantMap(sku) {
  if (!sku) return {}
  const variants = cache[sku]
  return variants && typeof variants === 'object' ? variants : {}
}

/**
 * ASIN for one colour+size combination, or '' when the sheet had none.
 * Case drift between the catalogue and the sheet is tolerated.
 */
export function getAsinFor(sku, colour, size) {
  const variants = getVariantMap(sku)
  if (!Object.keys(variants).length) return ''

  const key = variantKey(colour, size)
  if (variants[key] !== undefined) return variants[key] || ''

  const lower = key.toLowerCase()
  for (const [variant, asin] of Object.entries(variants)) {
    if (variant.toLowerCase() === lower) return asin || ''
  }
  return ''
}

/** Every ASIN recorded for a 货号 — used by the admin search */
export function getAllAsinsFor(sku) {
  return Object.values(getVariantMap(sku)).filter(Boolean)
}

/** Test seam — lets the Node suites inject a map without a database */
export function __setAsinsForTests(map) {
  cache = map && typeof map === 'object' ? map : {}
  status = 'ready'
  notify()
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function loadAsins({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    try {
      const { data, error } = await requireClient().from('asins').select('sku, variants')
      if (error) throw new Error(error.message)

      const map = {}
      for (const row of data || []) {
        if (row.sku && row.variants && typeof row.variants === 'object') {
          map[row.sku] = row.variants
        }
      }

      cache = map
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

export async function ensureAsins() {
  if (status === 'ready') return cache
  await loadAsins({ silent: status === 'ready' })
  return cache
}

/* ── writes ──────────────────────────────────────────────────────────────── */

/** Replace the whole map (upsert every 货号). Used by imports and exports. */
export async function setAsins(map) {
  const clean = normalizeMap(map)
  if (!clean) throw new Error('ASIN 映射必须是 { 货号: { "颜色|尺码": "ASIN" } } 这种形状')

  const rows = Object.entries(clean).map(([sku, variants]) => ({ sku, variants }))
  if (!rows.length) return

  const { error } = await requireClient().from('asins').upsert(rows, { onConflict: 'sku' })
  if (error) throw new Error(error.message)

  cache = { ...cache, ...clean }
  notify()
}

/**
 * Drop the ASIN mappings for one or more 货号.
 *
 * Called when a product is deleted for good: leaving its ASINs behind would
 * make them show up in search for a product that no longer exists. Hidden
 * products keep theirs — they may come back.
 */
export async function removeAsins(skus) {
  const drop = (Array.isArray(skus) ? skus : [skus]).filter(Boolean)
  if (!drop.length) return

  const { error } = await requireClient().from('asins').delete().in('sku', drop)
  if (error) throw new Error(error.message)

  const next = { ...cache }
  for (const sku of drop) delete next[sku]
  cache = next
  notify()
}

/* ── single-货号 writes (the product editor) ─────────────────────────────── */

/** Trim + uppercase one ASIN; '' when there was nothing usable. */
export function normaliseAsin(value) {
  return String(value ?? '').trim().toUpperCase()
}

/** 10 alphanumerics — the shape Amazon uses, and what the importer enforces.
 *
 *  The pattern itself lives in `utils/amazon.js` so the "View on Amazon" link
 *  and this check can never disagree about which strings are usable. */
export function isValidAsin(value) {
  return ASIN_PATTERN.test(normaliseAsin(value))
}

/**
 * Write one 货号's variant map from the product editor.
 *
 * The editor sends the WHOLE map for that 货号, built as "existing keys plus the
 * ones on screen" — so this is a replacement of one row, never of the table.
 * Blank values are dropped rather than stored as "": an empty input means "no
 * ASIN for this combination", and a `""` in the map would look filled to every
 * consumer (`getAllAsinsFor` filters it, `hasListingFor` would not).
 *
 * Admin-only by construction: `asins` has no grant at all for `anon`, and the
 * write policies require `is_admin()` (supabase/01-schema.sql §5.3).
 */
export async function saveVariantAsins(sku, variants) {
  const key = String(sku ?? '').trim()
  if (!key) throw new Error('存 ASIN 必须先有货号')

  const clean = {}
  for (const [variant, asin] of Object.entries(variants || {})) {
    const value = normaliseAsin(asin)
    if (variant && value) clean[variant] = value
  }

  const { error } = await requireClient()
    .from('asins')
    .upsert([{ sku: key, variants: clean }], { onConflict: 'sku' })

  if (error) throw new Error(error.message)

  cache = { ...cache, [key]: clean }
  notify()
  return clean
}

/**
 * Move a 货号's row to a new 货号 — used when the editor renames the item code.
 *
 * `asins.sku` is the primary key, so this is an UPDATE of that one row. It is
 * refused when the destination already has a map: merging two variant tables is
 * a judgement call (which ASIN wins for the same colour+size?) that a rename
 * has no business making. Ops can then clear one of them by hand.
 *
 * Returns true when a row actually moved.
 */
export async function moveAsins(fromSku, toSku) {
  const from = String(fromSku ?? '').trim()
  const to = String(toSku ?? '').trim()
  if (!from || !to || from === to) return false

  const client = requireClient()

  const { data, error: probeError } = await client.from('asins').select('sku').eq('sku', to)
  if (probeError) throw new Error(probeError.message)
  if (data && data.length) {
    throw new Error(
      `「${to}」已经有 ASIN 了 —— 请先把这两个货号手工合并，再改名`,
    )
  }

  const { error } = await client.from('asins').update({ sku: to }).eq('sku', from)
  if (error) throw new Error(error.message)

  if (from in cache) {
    const next = { ...cache, [to]: cache[from] }
    delete next[from]
    cache = next
    notify()
  }
  return true
}
