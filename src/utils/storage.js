/**
 * Selection persistence
 * ──────────────────────
 * The in-progress selection is stored locally so a creator can close the tab
 * and come back. It is NOT used to decode codes — codes are self-contained.
 *
 * The stored shape is an array of lines (see utils/lines.js), wrapped in an
 * envelope that carries `updatedAt` so a stale draft can expire (see
 * utils/selectionExpiry.js for why the stamp means "last changed" and not "last
 * opened"). The two keys from the one-variant-per-product era are removed on
 * load rather than migrated: a creator mid-selection at deploy time would
 * otherwise carry specs that the current catalogue may no longer offer, and
 * re-picking is cheaper than debugging a ghost colour later.
 */

import { isLine } from './lines.js'
import {
  LINES_KEY,
  readEnvelope,
  wrapSelection,
  isExpired,
  SELECTION_EXPIRY_DAYS,
} from './selectionExpiry.js'

const LEGACY_KEYS = ['mako_selection_v2', 'mako_specs_v2']

function readRaw() {
  try {
    return localStorage.getItem(LINES_KEY)
  } catch {
    return null
  }
}

/**
 * Everything the caller needs to decide what to show on boot.
 *
 * `expired` is only true when there WAS a draft and it aged out — an empty
 * cart never reports expiry, so the "your selection expired" toast can only
 * appear in front of somebody who actually lost something.
 *
 * @returns {{lines: Array, updatedAt: number, expired: boolean, dropped: number, legacy: boolean}}
 */
export function readSelection({ now = Date.now(), days = SELECTION_EXPIRY_DAYS } = {}) {
  const envelope = readEnvelope(readRaw(), now)
  if (!envelope.lines.length) {
    return { lines: [], updatedAt: now, expired: false, dropped: 0, legacy: envelope.legacy }
  }

  /* Keys are re-derived from the catalogue during reconcile, so a missing or
   * malformed key here is not fatal — keep the line if the rest holds. */
  const lines = envelope.lines
    .filter((line) => isLine(line) || (line && line.productId && Number(line.qty) > 0))
    .map((line) => ({
      key: typeof line.key === 'string' ? line.key : `${line.productId}::`,
      productId: String(line.productId),
      qty: Math.max(1, Math.floor(Number(line.qty) || 1)),
      specs: line.specs && typeof line.specs === 'object' ? line.specs : {},
    }))

  const expired = isExpired(envelope.updatedAt, now, days)

  return {
    lines: expired ? [] : lines,
    updatedAt: expired ? now : envelope.updatedAt,
    expired: expired && lines.length > 0,
    dropped: envelope.lines.length - lines.length,
    legacy: envelope.legacy,
  }
}

/**
 * Persist the lines with an explicit stamp.
 *
 * `updatedAt` defaults to now only for callers with no notion of "when the
 * selection last changed" (there are none in the app — `useSelection` always
 * passes one). Passing the stamp it read back is what makes a page refresh
 * NOT extend the draft's life.
 */
export function saveLines(lines, updatedAt = Date.now()) {
  try {
    localStorage.setItem(LINES_KEY, wrapSelection(lines, updatedAt))
  } catch {
    /* ignore — a full quota must not break the selection */
  }
}

/** Drop the pre-multi-variant keys. Safe to call on every boot. */
export function clearLegacySelection() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * Creator handle from the URL.
 * Supports both /?ref=luna and /#/?ref=luna.
 */
export function getInfluencerRef() {
  try {
    const search = new URLSearchParams(window.location.search)
    const hashQuery = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return search.get('ref') || hashQuery.get('ref') || 'guest'
  } catch {
    return 'guest'
  }
}

export function clearSelection() {
  try {
    localStorage.removeItem(LINES_KEY)
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
