/**
 * Onboarding guide self-check
 *   node scripts/test-guide.mjs
 *
 * Pure Node — no browser, no network. Four things must hold or the guide either
 * never appears or never stops appearing:
 *
 *   [1] the five steps        — exact copy, unique ids/figures (the product
 *                               wrote this text; a "typo fix" here is a bug)
 *   [2] stepLabel / clampStep — 1 → `01`, and no way to land on step 0 or 6
 *   [3] seen flag             — version-aware, and it never throws: reading
 *                               localStorage does throw in private mode, and an
 *                               exception here would blank the whole page
 *   [4] shouldAutoOpen        — not during the skeleton, not on an error screen,
 *                               not after it has been seen
 */

import {
  GUIDE_KEY,
  GUIDE_STEPS,
  GUIDE_TOTAL,
  GUIDE_VERSION,
  clampStep,
  clearGuideSeen,
  hasSeenGuide,
  markGuideSeen,
  shouldAutoOpen,
  stepAt,
  stepLabel,
} from '../src/utils/guide.js'

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

/** A localStorage stand-in. `broken: true` makes every call throw, like Safari
 *  private mode used to. */
function fakeStorage(initial = null, { broken = false } = {}) {
  const map = new Map()
  if (initial !== null) map.set(GUIDE_KEY, initial)
  return {
    getItem: (key) => {
      if (broken) throw new Error('SecurityError')
      return map.has(key) ? map.get(key) : null
    },
    setItem: (key, value) => {
      if (broken) throw new Error('QuotaExceededError')
      map.set(key, String(value))
    },
    removeItem: (key) => {
      if (broken) throw new Error('SecurityError')
      map.delete(key)
    },
  }
}

/* ── 1. the steps ── */
console.log('\n[1] Five steps, copy verbatim')

check('there are five', GUIDE_STEPS.length, 5)
check('and GUIDE_TOTAL agrees', GUIDE_TOTAL, 5)

check(
  'titles, in order',
  GUIDE_STEPS.map((step) => step.title),
  [
    'Select Category',
    'Choose Pieces & View Spec',
    'Size, Color & Selection',
    'Review and Generate Code',
    'Copy and Send Code',
  ],
)

check(
  'bodies, verbatim',
  GUIDE_STEPS.map((step) => step.body),
  [
    'Select a category to find the items you want.',
    'Tap your favorite pieces and click "View on Amazon" for full specs, size guides, and reviews.',
    'Pick your color and size, then add the piece to your selection.',
    'Review your cart and tap "Generate my code".',
    'Copy and send your code directly to your contact.',
  ],
)

check('ids are unique', new Set(GUIDE_STEPS.map((step) => step.id)).size, 5)
check('figures are unique (five distinct drawings)', new Set(GUIDE_STEPS.map((step) => step.figure)).size, 5)
check('no step body is empty', GUIDE_STEPS.every((step) => step.body.trim().length > 12), true)
check(
  'no markdown or html leaked into the copy',
  GUIDE_STEPS.some((step) => /[<>*_`]/.test(step.title + step.body)),
  false,
)

/* ── 2. numbering and bounds ── */
console.log('\n[2] stepLabel / clampStep')

check('1 → 01', stepLabel(1), '01')
check('5 → 05', stepLabel(5), '05')
check('10 → 05 (clamped, never "010")', stepLabel(10), '05')
check('0 → 01', stepLabel(0), '01')
check('NaN → 01', stepLabel(NaN), '01')

check('clamp down', clampStep(0), 1)
check('clamp up', clampStep(9), 5)
check('keeps a valid step', clampStep(3), 3)
check('rounds down a fraction', clampStep(2.9), 2)

check('stepAt(1) is the first', stepAt(1).id, 'category')
check('stepAt(5) is the last', stepAt(5).id, 'send')
check('stepAt(0) clamps instead of returning undefined', stepAt(0).id, 'category')
check('stepAt(99) clamps', stepAt(99).id, 'send')

/* ── 3. the seen flag ── */
console.log('\n[3] hasSeenGuide / markGuideSeen — and it never throws')

check('nothing stored → not seen', hasSeenGuide(fakeStorage()), false)
check('empty string → not seen', hasSeenGuide(fakeStorage('')), false)
check('current version → seen', hasSeenGuide(fakeStorage(GUIDE_VERSION)), true)
check('an older version → shown again', hasSeenGuide(fakeStorage('v0')), false)
check('a stray "true" → not seen (the value is a version, not a boolean)', hasSeenGuide(fakeStorage('true')), false)
check('no storage at all → not seen', hasSeenGuide(null), false)
check('a storage that throws → not seen, no exception', hasSeenGuide(fakeStorage(null, { broken: true })), false)

const box = fakeStorage()
check('markGuideSeen writes', markGuideSeen(box), true)
check('and the value is the version', box.getItem(GUIDE_KEY), GUIDE_VERSION)
check('now it reads as seen', hasSeenGuide(box), true)
check('marking twice is harmless', markGuideSeen(box) && markGuideSeen(box), true)
check('clear removes it', clearGuideSeen(box), true)
check('so it counts as unseen again', hasSeenGuide(box), false)

check('mark on a broken storage reports failure, no throw', markGuideSeen(fakeStorage(null, { broken: true })), false)
check('clear on a broken storage reports failure, no throw', clearGuideSeen(fakeStorage(null, { broken: true })), false)

/* ── 4. when to open ── */
console.log('\n[4] shouldAutoOpen')

check('first visit, data ready', shouldAutoOpen({ loading: false, failed: false, seen: false }), true)
check('still loading the skeleton', shouldAutoOpen({ loading: true, failed: false, seen: false }), false)
check('catalogue failed', shouldAutoOpen({ loading: false, failed: true, seen: false }), false)
check('already seen', shouldAutoOpen({ loading: false, failed: false, seen: true }), false)
check('loading AND seen', shouldAutoOpen({ loading: true, failed: false, seen: true }), false)
check('no arguments at all', shouldAutoOpen({}), true)

console.log(`\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
