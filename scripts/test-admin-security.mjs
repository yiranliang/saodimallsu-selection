/**
 * Admin safety-guard self-check
 *   node scripts/test-admin-security.mjs
 *
 * Pure Node — no browser, no network. Covers the two decisions that have teeth:
 *   [1] computeBulkDeleteGuard  — the >30% circuit breaker (Shield 2)
 *   [2] readIdleTimeoutMs       — the 480-min default + the capped test override (Shield 3)
 */

import { computeBulkDeleteGuard, readIdleTimeoutMs } from '../src/utils/adminSecurity.js'

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

const T = 480 * 60 * 1000 // 480 minutes (8 hours)

console.log('\n[1] computeBulkDeleteGuard — the >30% circuit breaker')

// Exactly 30% must NOT trip the breaker (strictly greater than).
check('30% exactly is allowed', computeBulkDeleteGuard(30, 100).overThreshold, false)
check('30% exactly reports 30%', computeBulkDeleteGuard(30, 100).percent, 30)

// Anything above it trips, and the rounded percentage is what the UI prints.
check('31/100 trips', computeBulkDeleteGuard(31, 100).overThreshold, true)
check('31/100 reports 31%', computeBulkDeleteGuard(31, 100).percent, 31)
check('1/2 (50%) trips', computeBulkDeleteGuard(1, 2).overThreshold, true)
check('1/2 reports 50%', computeBulkDeleteGuard(1, 2).percent, 50)

// Small selections stay one-click.
check('3/190 (~1.6%) does not trip', computeBulkDeleteGuard(3, 190).overThreshold, false)
check('3/190 reports 2%', computeBulkDeleteGuard(3, 190).percent, 2)
check('0 selected never trips', computeBulkDeleteGuard(0, 190).overThreshold, false)

// Degenerate totals are safe: no catalogue, no trip, no divide-by-zero.
check('empty catalogue never trips', computeBulkDeleteGuard(5, 0).overThreshold, false)
check('empty catalogue reports 0%', computeBulkDeleteGuard(5, 0).percent, 0)
check('non-numeric inputs are coerced safely', computeBulkDeleteGuard('12', '40').overThreshold, false)
check('non-numeric 13/40 trips', computeBulkDeleteGuard('13', '40').overThreshold, true)

// selected/total are normalised to numbers for the caller's convenience.
check('selected is numeric', typeof computeBulkDeleteGuard('12', '40').selected, 'number')
check('total is numeric', typeof computeBulkDeleteGuard('12', '40').total, 'number')

console.log('\n[2] readIdleTimeoutMs — 480-min default + capped override (Shield 3)')

// Default when nothing is stored.
check('no key → 480 min', readIdleTimeoutMs(fakeStorage(null)), T)
check('empty string → 480 min', readIdleTimeoutMs(fakeStorage('')), T)

// A valid override (within [10s, 24h]) is honoured — lets the gate test fire fast.
check('12s override honoured', readIdleTimeoutMs(fakeStorage('12000')), 12_000)
check('10s floor honoured', readIdleTimeoutMs(fakeStorage(String(10_000))), 10_000)
check('24h ceiling honoured', readIdleTimeoutMs(fakeStorage(String(24 * 60 * 60 * 1000))), 24 * 60 * 60 * 1000)

// Out-of-band values are ignored (otherwise a stray value could log the user out
// instantly or never). Below the floor and above the ceiling both fall back.
check('9s (below floor) → default', readIdleTimeoutMs(fakeStorage('9000')), T)
check('25h (above ceiling) → default', readIdleTimeoutMs(fakeStorage(String(25 * 60 * 60 * 1000))), T)
check('garbage → default', readIdleTimeoutMs(fakeStorage('not-a-number')), T)
check('negative → default', readIdleTimeoutMs(fakeStorage('-5')), T)

console.log(`\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)

/** Minimal localStorage stand-in so the test needs no jsdom. */
function fakeStorage(value) {
  const map = value === null ? {} : { adminIdleMs: value }
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: () => {},
  }
}
