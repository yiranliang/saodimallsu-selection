/**
 * Selection expiry self-check
 *   node scripts/test-selection-expiry.mjs
 *
 * The interesting cases are the ones that decide whether a creator's cart gets
 * thrown away, so the assertions are all about NOT deleting things:
 *
 *   [2] stale drafts expire, exactly on the boundary
 *   [3] a device with a wrong clock, a malformed blob, or a missing timestamp
 *       must never be read as "expired" — losing a real cart is worse than
 *       keeping a stale one for one more visit
 *   [4] the pre-envelope format (a bare array) keeps its contents
 */

import {
  SELECTION_EXPIRY_DAYS,
  SELECTION_VERSION,
  LINES_KEY,
  expiryCutoff,
  isExpired,
  readEnvelope,
  wrapSelection,
} from '../src/utils/selectionExpiry.js'

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

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000 // fixed instant — no dependence on the clock

const lines = [
  { key: 'p003::Black|M', productId: 'p003', qty: 2, specs: { Colour: 'Black', Size: 'M' } },
]

/* ── 1. constants ──────────────────────────────────────────────────────── */
console.log('\n[1] Constants')
check('seven days by default', SELECTION_EXPIRY_DAYS, 7)
check('envelope version is 2', SELECTION_VERSION, 2)
check('storage key unchanged (legacy array still found)', LINES_KEY, 'mako_lines_v1')
check('cutoff is now minus seven days', expiryCutoff(NOW), NOW - 7 * DAY)

/* ── 2. isExpired ──────────────────────────────────────────────────────── */
console.log('\n[2] isExpired')
check('just written', isExpired(NOW, NOW), false)
check('six days old', isExpired(NOW - 6 * DAY, NOW), false)
check('one second short of seven days', isExpired(NOW - 7 * DAY + 1000, NOW), false)
check('exactly seven days', isExpired(NOW - 7 * DAY, NOW), true)
check('eight days old', isExpired(NOW - 8 * DAY, NOW), true)
check('custom window honoured', isExpired(NOW - 2 * DAY, NOW, 1), true)
check('custom window generous', isExpired(NOW - 2 * DAY, NOW, 30), false)

console.log('\n[3] isExpired is conservative')
check('missing timestamp is not expired', isExpired(undefined, NOW), false)
check('null is not expired', isExpired(null, NOW), false)
check('zero is not expired', isExpired(0, NOW), false)
check('garbage is not expired', isExpired('yesterday', NOW), false)
check('future stamp (skewed clock) is not expired', isExpired(NOW + 3 * DAY, NOW), false)

/* ── 4. readEnvelope ───────────────────────────────────────────────────── */
console.log('\n[4] readEnvelope')
check('empty storage', readEnvelope(null, NOW), {
  lines: [],
  updatedAt: NOW,
  legacy: false,
  unreadable: false,
})

const legacyRaw = JSON.stringify(lines)
const legacy = readEnvelope(legacyRaw, NOW)
check('legacy array keeps its lines', legacy.lines.length, 1)
check('legacy array is flagged', legacy.legacy, true)
check('legacy array starts the clock now (never nuked on deploy)', legacy.updatedAt, NOW)

const sixDaysAgo = NOW - 6 * DAY
const stored = readEnvelope(
  JSON.stringify({ v: 2, updatedAt: sixDaysAgo, lines }),
  NOW,
)
check('envelope keeps the stamp', stored.updatedAt, sixDaysAgo)
check('envelope keeps the lines', stored.lines.length, 1)
check('envelope is not legacy', stored.legacy, false)
check('six-day-old envelope not expired', isExpired(stored.updatedAt, NOW), false)

const old = readEnvelope(JSON.stringify({ v: 2, updatedAt: NOW - 9 * DAY, lines }), NOW)
check('nine-day-old envelope is expired', isExpired(old.updatedAt, NOW), true)

check('broken json is unreadable, not fatal', readEnvelope('{oops', NOW), {
  lines: [],
  updatedAt: NOW,
  legacy: false,
  unreadable: true,
})
check('object without lines is unreadable', readEnvelope('{"v":2}', NOW).unreadable, true)
check('envelope without a stamp falls back to now', readEnvelope(JSON.stringify({ lines }), NOW).updatedAt, NOW)
check('envelope with a bad stamp falls back to now', readEnvelope(JSON.stringify({ updatedAt: 'x', lines }), NOW).updatedAt, NOW)

/* ── 5. wrapSelection ──────────────────────────────────────────────────── */
console.log('\n[5] wrapSelection')
const wrapped = JSON.parse(wrapSelection(lines, sixDaysAgo))
check('version written', wrapped.v, 2)
check('stamp written verbatim', wrapped.updatedAt, sixDaysAgo)
check('lines written verbatim', wrapped.lines.length, 1)

const roundTrip = readEnvelope(wrapSelection(lines, sixDaysAgo), NOW)
check('round trip keeps the stamp', roundTrip.updatedAt, sixDaysAgo)
check('round trip keeps the line key', roundTrip.lines[0].key, 'p003::Black|M')

check('non-array lines become []', JSON.parse(wrapSelection('nope', NOW)).lines, [])
check('non-numeric stamp becomes now-ish', Number.isFinite(JSON.parse(wrapSelection(lines, 'x')).updatedAt), true)

/* ── summary ───────────────────────────────────────────────────────────── */
console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed) {
  console.log(`Failed ${failed}`)
  process.exit(1)
}
