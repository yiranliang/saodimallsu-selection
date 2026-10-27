/**
 * Coming Soon (Teaser) self-check
 *   node scripts/test-teaser.mjs
 *
 * Pure Node — no browser, no network. Covers the four places the flag has to
 * hold or the promise breaks:
 *   [1] isTeaser       — strict true only (a stray string cannot gate a purchase)
 *   [2] badge          — the Coming Soon template exists, is legible, is unique
 *   [3] makeLine       — no add path can create a line for a teaser
 *   [4] mapping        — is_teaser survives the row round trip, and a normal
 *                        product does not grow the key
 */

import { isTeaser, TEASER_BADGE } from '../src/utils/teaser.js'
import {
  BADGE_TEMPLATES,
  BADGE_COLOR_PRESETS,
  badgeTemplateMatch,
  badgeContrast,
  badgeTextColor,
} from '../src/utils/badge.js'
import { makeLine } from '../src/utils/lines.js'
import { productToRow, rowToProduct } from '../src/store/mapping.js'

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

console.log('\n[1] isTeaser — strict true only')

check('true is a teaser', isTeaser({ isTeaser: true }), true)
check('false is not', isTeaser({ isTeaser: false }), false)
check('missing is not', isTeaser({}), false)
check('the string "true" is not (never gate a purchase on a string)', isTeaser({ isTeaser: 'true' }), false)
check('1 is not', isTeaser({ isTeaser: 1 }), false)
check('null product is not', isTeaser(null), false)

console.log('\n[2] Coming Soon badge template')

check('TEASER_BADGE text', TEASER_BADGE.text, 'Coming Soon')
check('TEASER_BADGE colour', TEASER_BADGE.value, '#333333')
const tpl = BADGE_TEMPLATES.find((t) => t.text === 'Coming Soon')
check('the template is in the quick-fill list', Boolean(tpl), true)
check('and it is the same object the page uses', tpl, TEASER_BADGE)
check('its colour does not collide with a preset', BADGE_COLOR_PRESETS.some((p) => p.value === tpl.value), false)
check(
  'its text clears 4.5:1 on cream',
  badgeContrast(tpl.value, badgeTextColor(tpl.value)) >= 4.5,
  true,
)
check('the computed text colour is cream', badgeTextColor(tpl.value), '#FAF8F5')
check(
  'badgeTemplateMatch recognises it',
  badgeTemplateMatch('Coming Soon', '#333333')?.text,
  'Coming Soon',
)

console.log('\n[3] makeLine — a teaser can never become a line')

const shirt = { id: 'p100', specs: { Colour: ['Black'], Size: ['M'] }, isTeaser: true }
check('complete specs still → null', makeLine(shirt, { Colour: 'Black', Size: 'M' }, 1), null)
check('quantity is irrelevant', makeLine(shirt, { Colour: 'Black', Size: 'M' }, 5), null)

const oneSize = { id: 'p101', specs: {}, isTeaser: true }
check('one-size teaser → null', makeLine(oneSize, {}, 1), null)

const normal = { id: 'p102', specs: { Colour: ['Black'], Size: ['M'] } }
check('a normal product still builds a line', makeLine(normal, { Colour: 'Black', Size: 'M' }, 1)?.qty, 1)
check(
  'and the line carries the specs',
  makeLine(normal, { Colour: 'Black', Size: 'M' }, 1)?.specs,
  { Colour: 'Black', Size: 'M' },
)

console.log('\n[4] Mapping — is_teaser round trip')

const teaserRow = productToRow({ id: 'p200', name: 'X', specs: {}, isTeaser: true })
check('teaser writes is_teaser: true', teaserRow.is_teaser, true)
check('a normal product writes false', productToRow({ id: 'p201', name: 'Y' }).is_teaser, false)
check('round trip keeps the flag', rowToProduct({ ...teaserRow, id: 'p200' }).isTeaser, true)
check(
  'a normal product does not grow the key',
  'isTeaser' in rowToProduct({ ...productToRow({ id: 'p202', name: 'Z' }), id: 'p202' }),
  false,
)
check('the database never sees camelCase', 'isTeaser' in teaserRow, false)

console.log(`\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
