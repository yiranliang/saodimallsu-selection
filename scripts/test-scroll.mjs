/**
 * 横向滚动栏（CategoryNav）self-check
 *   node scripts/test-scroll.mjs
 *
 * Pure Node — no DOM. The mouse behaviour on the category rail is three rules,
 * and each one has a way to be wrong that only shows up in the hand:
 *
 *   [1] overflowOf      — no overflow means "don't touch anything"
 *   [2] wheelScrollDelta— vertical wheel becomes horizontal scroll, but only
 *                         while there is somewhere to go (otherwise the page
 *                         under a sticky bar stops scrolling)
 *   [3] drag            — direction, and the 5px line between a click and a pan
 */

import {
  DRAG_THRESHOLD,
  dragScrollLeft,
  isDrag,
  overflowOf,
  wheelScrollDelta,
} from '../src/utils/horizontalScroll.js'

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

const rail = (over = {}) => ({ scrollWidth: 1200, clientWidth: 800, scrollLeft: 0, ...over })

console.log('\n[1] overflowOf')

check('a rail that overflows', overflowOf(rail()), 400)
check('a rail that fits', overflowOf(rail({ scrollWidth: 800 })), 0)
check('a rail narrower than the viewport', overflowOf(rail({ scrollWidth: 500 })), 0)
check('no element', overflowOf(null), 0)
check('garbage values', overflowOf({ scrollWidth: 'x', clientWidth: 800 }), 0)

console.log('\n[2] wheelScrollDelta — only while there is somewhere to go')

check('down the wheel at the start', wheelScrollDelta({ deltaY: 120 }, rail()), 120)
check('up the wheel in the middle', wheelScrollDelta({ deltaY: -120 }, rail({ scrollLeft: 200 })), -120)
check('down at the right edge → let the page scroll', wheelScrollDelta({ deltaY: 120 }, rail({ scrollLeft: 400 })), 0)
check('down 10px before the edge still moves', wheelScrollDelta({ deltaY: 120 }, rail({ scrollLeft: 390 })), 120)
check('up at the left edge → let the page scroll', wheelScrollDelta({ deltaY: -120 }, rail({ scrollLeft: 0 })), 0)
check('a fractional scrollLeft still counts as the edge', wheelScrollDelta({ deltaY: 5 }, rail({ scrollLeft: 399.4 })), 0)

check('a trackpad swipe sideways is left alone', wheelScrollDelta({ deltaX: 80, deltaY: 5 }, rail()), 0)
check('and the other way too', wheelScrollDelta({ deltaX: -80, deltaY: 5 }, rail({ scrollLeft: 200 })), 0)
check('no delta at all', wheelScrollDelta({}, rail()), 0)
check('line mode × 16', wheelScrollDelta({ deltaY: 3, deltaMode: 1 }, rail()), 48)
check('page mode × clientWidth', wheelScrollDelta({ deltaY: 1, deltaMode: 2 }, rail()), 800)
check('nothing to scroll → nothing to translate', wheelScrollDelta({ deltaY: 120 }, rail({ scrollWidth: 700 })), 0)
check('no element', wheelScrollDelta({ deltaY: 120 }, null), 0)
check('no event', wheelScrollDelta(null, rail()), 0)

console.log('\n[3] drag — direction and the click/pan line')

check('pulling left scrolls the rail right', dragScrollLeft(0, 500, 400), 100)
check('pushing right scrolls it back', dragScrollLeft(100, 400, 500), 0)
check('a drag that starts mid-rail is relative to that point', dragScrollLeft(200, 500, 350), 350)
check('no movement', dragScrollLeft(120, 500, 500), 120)
check('missing numbers do not produce NaN', dragScrollLeft(undefined, undefined, undefined), 0)

check('the threshold is 5px', DRAG_THRESHOLD, 5)
check('4px is still a click', isDrag(500, 504), false)
check('5px is a drag', isDrag(500, 505), true)
check('and the other direction counts too', isDrag(500, 495), true)
check('no movement is a click', isDrag(500, 500), false)
check('a custom threshold', isDrag(500, 502, 2), true)

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
