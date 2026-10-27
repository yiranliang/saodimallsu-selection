/**
 * Amazon links
 * ════════════
 * The storefront needs two things it cannot get from the catalogue:
 *
 *   1. one ASIN per product, for the "View on Amazon" link
 *   2. which variant combinations actually have a listing, so a creator is told
 *      "this colour/size has no listing yet" instead of tapping a link that
 *      goes nowhere
 *
 * The `asins` table is allowlist-only — an anonymous visitor gets zero rows.
 * `supabase/04-product-links.sql` adds a deliberately narrow view that exposes
 * exactly those two facts and nothing else. Colour names and sizes are already
 * public in `products.specs`, so publishing which of them are linked reveals no
 * new information; the ASINs themselves do not travel.
 *
 *   {
 *     p003: { asin: 'B0H6XHHZ8N', linked: { 'Black|M': true, 'Black|L': true } },
 *   }
 *
 * Failure is quiet on purpose: if the view has not been created yet (someone
 * forgot to run 04) the fetch errors, the map stays empty and the UI simply
 * hides the links. A missing link must never break the storefront.
 */

import { supabase, isConfigured } from '../lib/supabase.js'
import { variantKey } from '../utils/asinStore.js'

const AMAZON_BASE = 'https://www.amazon.com/dp/'

/**
 * `select('*')` rather than an explicit column list, deliberately.
 *
 * The view gained `linked_variants` after its first version, so an explicit
 * list is a bet that the database has been migrated — and PostgREST answers a
 * missing column with 400 for the *whole* request, not a partial row. That bet
 * lost once: every link vanished on a database whose view was one column older,
 * even though the ASIN was sitting right there.
 *
 * `*` is version-agnostic: one request, no failed call in the network log, and
 * the shape of the answer tells us which version we are talking to.
 */
const SELECT_ALL = '*'

let cache = {}
let status = isConfigured ? 'idle' : 'ready'
let inflight = null

/**
 * Did the view tell us which variants are linked? False on an old view — the
 * link still works, only the "this combination has no listing yet" hint has to
 * stay quiet, because we cannot prove a combination is missing.
 */
let variantsKnown = false

const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function getLinks() {
  return cache
}

export function subscribeLinks(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function entryFor(productId) {
  return cache[String(productId)] || null
}

/** The ASIN behind one product, or '' */
export function getAsinForProduct(productId) {
  return entryFor(productId)?.asin || ''
}

/**
 * Amazon URL for one product, or '' when there is no ASIN.
 * Returning '' (rather than null or a placeholder URL) lets every caller use
 * the same truthiness test to decide whether to render the link at all.
 */
export function amazonUrlFor(productId) {
  const asin = getAsinForProduct(productId)
  return asin ? `${AMAZON_BASE}${asin}` : ''
}

/**
 * Does this exact colour/size combination have a listing?
 * Case-insensitive so a sheet key of "black|M" still matches "Black|M".
 *
 * When the view did not publish `linked_variants` we answer `true`: "I don't
 * know" must not be rendered as "there is no listing", because that tells a
 * creator her combination is unorderable when it may well be fine. The cost of
 * being wrong in that direction is a link that leads to a page where that size
 * is unavailable — the cost of the other direction is losing the sale.
 */
export function hasListingFor(productId, colour, size) {
  const entry = entryFor(productId)
  if (!entry) return false
  if (!entry.variantsKnown) return true

  const key = variantKey(colour, size)
  if (entry.linked[key]) return true

  const lower = key.toLowerCase()
  return Object.keys(entry.linked).some((candidate) => candidate.toLowerCase() === lower)
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function loadLinks({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    try {
      const { data, error } = await supabase.from('product_links').select(SELECT_ALL)
      if (error) throw error

      const rows = data || []
      /* The shape of the rows tells us which version of the view this is: any
       * row carrying `linked_variants` means the newer definition. An empty
       * view cannot tell us anything, so treat it as "not known" — with no rows
       * there is nothing to hint about anyway. */
      const haveVariants = rows.some((row) => row && 'linked_variants' in row)
      if (!haveVariants && rows.length > 0) {
        console.warn(
          '[mako] product_links has no `linked_variants` — links work, the ' +
            'per-variant hint is off. Re-run supabase/04-product-links.sql to restore it.',
        )
      }

      const next = {}
      for (const row of rows) {
        if (!row?.product_id) continue
        const linked = {}
        const raw = row.linked_variants
        if (raw && typeof raw === 'object') {
          for (const key of Object.keys(raw)) linked[key] = true
        }
        next[String(row.product_id)] = {
          asin: row.asin ? String(row.asin) : '',
          linked,
          variantsKnown: haveVariants,
        }
      }

      status = 'ready'
      variantsKnown = haveVariants
      cache = next
      notify()
      return next
    } catch (err) {
      /* Most likely: 04-product-links.sql has not been run at all. Keep whatever
       * we already had so a transient failure does not blank the links. */
      status = 'error'
      if (!silent) console.warn('[mako] amazon links unavailable —', err?.message || err)
      notify()
      return cache
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Test seam — lets the Node suites exercise the helpers without a network */
export function __setLinksForTests(next) {
  cache = next && typeof next === 'object' ? next : {}
  status = 'ready'
  variantsKnown = true
  notify()
}
