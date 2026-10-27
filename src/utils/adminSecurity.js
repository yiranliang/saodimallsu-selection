/**
 * Admin safety guards
 * ────────────────────
 * Pure, framework-free decisions so the browser UI and the tests share one
 * source of truth. Nothing here touches the DOM or the network.
 */

/**
 * Decides whether a bulk delete needs the typed-confirmation circuit breaker.
 *
 * The breaker fires only when the selection is *strictly more* than `threshold`
 * of the whole catalogue — 30% is allowed, 30.0001% is not. The `percent` the
 * warning prints is rounded for display; the boolean `overThreshold` is what the
 * UI actually gates its confirm button on.
 *
 * @param {number} selectedCount  how many products are ticked
 * @param {number} totalCount     size of the full catalogue
 * @param {number} [threshold=0.3] fraction of the catalogue that trips the breaker
 * @returns {{ selected:number, total:number, ratio:number, percent:number, overThreshold:boolean }}
 */
export function computeBulkDeleteGuard(selectedCount, totalCount, threshold = 0.3) {
  const total = Number(totalCount) || 0
  const selected = Number(selectedCount) || 0
  const ratio = total > 0 ? selected / total : 0
  const percent = Math.round(ratio * 100)
  // Strictly greater: exactly 30% is a legitimate "select a third" action and
  // must not force the typed confirmation.
  const overThreshold = total > 0 && ratio > threshold
  return { selected, total, ratio, percent, overThreshold }
}

/**
 * Idle timeout for the admin session, in milliseconds.
 *
 * Defaults to 480 minutes (8 hours) — a full working day. The guard exists to
 * protect an unattended public machine, not to interrupt someone who leaves the
 * console open; logging out every 2 hours only made them sign in again and
 * re-pull the whole catalogue. A test/bench can lower it by writing
 * `adminIdleMs` to localStorage *before* the admin shell mounts — this is
 * capped to a sane [10s, 24h] band so a stray value can never make the console
 * log itself out instantly or never. In production nobody sets the key, so the
 * default always applies.
 *
 * @param {Storage} [storage] injectable for tests
 * @returns {number}
 */
export function readIdleTimeoutMs(storage) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const raw = store?.getItem?.('adminIdleMs')
  const n = Number(raw)
  // 10s floor: a sub-ten-second idle would be a misfire, not a security feature.
  if (Number.isFinite(n) && n >= 10_000 && n <= 24 * 60 * 60 * 1000) return n
  return 480 * 60 * 1000
}
