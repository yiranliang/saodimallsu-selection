/**
 * Selection lifetime
 * ══════════════════
 * The in-progress selection lives in localStorage so a creator can close the tab
 * and come back. It must NOT live there forever: a creator who opens her link a
 * month later would see last month's picks and send a code for pieces that are
 * long gone.
 *
 * So the stored blob carries a timestamp and expires after
 * `SELECTION_EXPIRY_DAYS`. What "the timestamp" means is the subtle part:
 *
 *   it is the last time the selection CHANGED, not the last time the page was
 *   opened. Otherwise a creator who visits weekly would keep the same draft
 *   alive indefinitely, which is exactly the bug this exists to fix.
 *
 * That is why the writer takes an explicit `updatedAt` and the mutators in
 * `useSelection` are the only things that bump it — a plain page load writes the
 * envelope back with the stamp it read.
 *
 * SIZE / SHAPE COMPATIBILITY
 * ──────────────────────────
 * Before this existed the value was a bare array. An array has no timestamp, so
 * the reader treats it as "brand new": the content is kept (nobody mid-selection
 * at deploy time loses her cart) and a stamp is attached on the next write.
 * Expiry can never be inferred for the legacy shape, and guessing "expired"
 * would throw away a real draft.
 *
 * Pure functions, no localStorage, no React — `scripts/test-selection-expiry.mjs`
 * runs them under Node.
 */

/** Days an untouched selection survives. */
export const SELECTION_EXPIRY_DAYS = 7

/** Envelope version. 1 was the bare array, which carried no version field. */
export const SELECTION_VERSION = 2

const DAY_MS = 24 * 60 * 60 * 1000

/** Storage key — unchanged, so the legacy array is found and migrated in place. */
export const LINES_KEY = 'mako_lines_v1'

/** Timestamp below which a selection counts as dead. */
export function expiryCutoff(now = Date.now(), days = SELECTION_EXPIRY_DAYS) {
  return now - days * DAY_MS
}

/**
 * Has this selection gone stale?
 *
 * `updatedAt` in the future is treated as fresh, not expired: a device with a
 * skewed clock must not wipe somebody's cart. Missing / non-numeric means "no
 * evidence of age", which is also not a reason to delete anything.
 */
export function isExpired(updatedAt, now = Date.now(), days = SELECTION_EXPIRY_DAYS) {
  const stamp = Number(updatedAt)
  if (!Number.isFinite(stamp) || stamp <= 0) return false
  if (stamp > now) return false
  return now - stamp >= days * DAY_MS
}

/**
 * Read whatever is in storage into one shape.
 *
 * Returns the raw lines untouched — validating individual lines is
 * `utils/lines.js`'s job (it owns `isLine`), not this module's.
 *
 * @returns {{lines: Array, updatedAt: number, legacy: boolean, unreadable: boolean}}
 */
export function readEnvelope(raw, now = Date.now()) {
  const fresh = { lines: [], updatedAt: now, legacy: false, unreadable: false }
  if (!raw) return fresh

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...fresh, unreadable: true }
  }

  // v1: a bare array. Keep the content, start the clock now.
  if (Array.isArray(parsed)) return { ...fresh, lines: parsed, legacy: true }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.lines)) {
    const stamp = Number(parsed.updatedAt)
    return {
      lines: parsed.lines,
      updatedAt: Number.isFinite(stamp) && stamp > 0 ? stamp : now,
      legacy: false,
      unreadable: false,
    }
  }

  return { ...fresh, unreadable: true }
}

/** Serialise for storage. Written on every read too, to migrate a v1 array. */
export function wrapSelection(lines, updatedAt = Date.now()) {
  return JSON.stringify({
    v: SELECTION_VERSION,
    updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : Date.now(),
    lines: Array.isArray(lines) ? lines : [],
  })
}
