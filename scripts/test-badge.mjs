/**
 * Badge colour self-check
 * Run: npm run test:badge
 *
 * Pure Node — no browser, no database.
 *
 * Covers the three places a badge colour can go wrong without an error:
 *   1. a value that is not a hex colour reaching an inline style (invisible pill)
 *   2. text that disappears into the fill (cream on yellow, charcoal on charcoal)
 *   3. the field being dropped by the mapping whitelist, so saves look fine and
 *      the colour is gone on the next reload
 */

import {
  BADGE_COLOR_PRESETS,
  BADGE_TEMPLATES,
  badgeContrast,
  badgeLuminance,
  badgeStyle,
  badgeTemplateMatch,
  badgeTextColor,
  normaliseBadgeColor,
} from '../src/utils/badge.js'
import { normalizeProduct, productToRow, rowToProduct } from '../src/store/mapping.js'

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

/* ── 1. normalisation ── */
console.log('\n[1] normaliseBadgeColor')

check('#RRGGBB is kept, upper-cased', normaliseBadgeColor('#c8855a'), '#C8855A')
check('no hash is accepted', normaliseBadgeColor('C8855A'), '#C8855A')
check('short form expands', normaliseBadgeColor('#abc'), '#AABBCC')
check('surrounding spaces are trimmed', normaliseBadgeColor('  #B3453A '), '#B3453A')
check('named colours are refused', normaliseBadgeColor('red'), '')
check('rgb() is refused', normaliseBadgeColor('rgb(1,2,3)'), '')
check('empty string means "no colour"', normaliseBadgeColor(''), '')
check('null is safe', normaliseBadgeColor(null), '')
check('undefined is safe', normaliseBadgeColor(undefined), '')
check('a half-typed hex is refused', normaliseBadgeColor('#12345'), '')
check('an injection attempt is refused', normaliseBadgeColor('#fff;background:url(x)'), '')

/* ── 2. readable text over any fill ── */
console.log('\n[2] badgeTextColor')

const CREAM = '#FAF8F5'
const CHARCOAL = '#2B2B2B'

check('charcoal fill gets cream text', badgeTextColor('#2B2B2B'), CREAM)
check('near-black fill gets cream text', badgeTextColor('#000000'), CREAM)
/* Terracotta is the case a fixed threshold got wrong: cream on it is 2.8:1,
 * charcoal is 4.7:1. The picker must take the better of the two, not classify
 * the fill as "light" or "dark". */
check('terracotta gets charcoal text', badgeTextColor('#C8855A'), CHARCOAL)
check('white fill gets charcoal text', badgeTextColor('#FFFFFF'), CHARCOAL)
check('pale yellow fill gets charcoal text', badgeTextColor('#FFF9C4'), CHARCOAL)
check('deep green gets cream text', badgeTextColor('#4A6B52'), CREAM)
check('bad value falls back to cream', badgeTextColor('not-a-colour'), CREAM)
check('luminance of white is 1', Number(badgeLuminance('#FFFFFF').toFixed(3)), 1)
check('luminance of black is 0', badgeLuminance('#000000'), 0)
check('luminance of an invalid value is null', badgeLuminance('nope'), null)

/* The choice must always be the higher-contrast one of the two, and every preset
 * must clear WCAG AA for small text. */
for (const preset of BADGE_COLOR_PRESETS) {
  const text = badgeTextColor(preset.value)
  const chosen = badgeContrast(preset.value, text)
  const other = badgeContrast(preset.value, text === CREAM ? CHARCOAL : CREAM)
  check(`${preset.label}: picks the readable text colour`, chosen >= other, true)
  check(`${preset.label}: contrast ${chosen.toFixed(1)}:1 ≥ 4.5`, chosen >= 4.5, true)
}

/* ── 3. inline style ── */
console.log('\n[3] badgeStyle')

check('a colour becomes a style pair', badgeStyle('#b3453a'), {
  backgroundColor: '#B3453A',
  color: CREAM,
})
check('no colour → null, so the default classes stay', badgeStyle(''), null)
check('invalid → null', badgeStyle('blue'), null)
check('null input → null', badgeStyle(null), null)

/* ── 4. it survives the mapping whitelist ── */
console.log('\n[4] mapping round trip')

const product = {
  id: 'p900',
  sku: 'TEST-1',
  name: 'Badge test',
  category: 'Tops',
  image: './placeholders/placeholder.svg',
  tag: 'New',
  badgeColor: '#4A6B52',
  specs: { Colour: ['Black', 'White'], Size: ['S', 'M'] },
}

const row = productToRow(product, { id: 'p900', sortOrder: 7 })
check('productToRow writes the snake_case column', row.badge_color, '#4A6B52')

const back = rowToProduct({ ...row, sort_order: 7 })
check('rowToProduct reads it back', back.badgeColor, '#4A6B52')
check('and keeps the tag', back.tag, 'New')
check('specs key order is untouched', Object.keys(back.specs), ['Colour', 'Size'])
check('specs values are untouched', back.specs.Colour, ['Black', 'White'])

/* Unset is null in the column and absent on the product — two representations
 * of one state, both meaning "default pill". */
const plain = productToRow({ ...product, badgeColor: '' }, { id: 'p900' })
check('unset → null column', plain.badge_color, null)
check('unset → no badgeColor key', 'badgeColor' in rowToProduct({ ...plain, sort_order: 0 }), false)

/* Local / shipped data goes through the same normaliser. */
check('normalizeProduct keeps a valid colour', normalizeProduct(product).badgeColor, '#4A6B52')
check('normalizeProduct drops an invalid one', 'badgeColor' in normalizeProduct({ ...product, badgeColor: 'green' }), false)

/* ── 5. quick-fill templates ── */

check('six templates', BADGE_TEMPLATES.length, 6)
check(
  'every word is unique',
  new Set(BADGE_TEMPLATES.map((t) => t.text)).size,
  6,
)
check(
  'every colour is unique',
  new Set(BADGE_TEMPLATES.map((t) => t.value)).size,
  6,
)
check(
  'Coming Soon pairs the graphite template',
  BADGE_TEMPLATES.find((t) => t.text === 'Coming Soon')?.value,
  '#333333',
)
check(
  'and none of them collides with a colour preset',
  BADGE_TEMPLATES.filter((t) => BADGE_COLOR_PRESETS.some((p) => p.value === t.value)).length,
  0,
)

/* The pill is drawn with badgeStyle(value), so this is the actual legibility of
 * the button the operator clicks — and of the badge that follows it. 4.5:1 is
 * the WCAG AA floor for normal text; a badge is small text over a photo, so
 * the floor is the right bar, not a nice-to-have. */
for (const tpl of BADGE_TEMPLATES) {
  check(`${tpl.text}: the colour survives normalisation`, normaliseBadgeColor(tpl.value), tpl.value)
  check(
    `${tpl.text}: white-ish text clears 4.5:1 (${badgeContrast(tpl.value, badgeTextColor(tpl.value)).toFixed(2)}:1)`,
    badgeContrast(tpl.value, badgeTextColor(tpl.value)) >= 4.5,
    true,
  )
  /* The brief asked for white text. Every shade here was chosen dark enough
   * that the computed answer IS the cream — if a future template breaks that,
   * this fails and forces a decision instead of quietly rendering dark text
   * on a dark pill. */
  check(`${tpl.text}: the text colour is the cream`, badgeTextColor(tpl.value), CREAM)
  check(
    `${tpl.text}: the pill style is the storefront badge style`,
    badgeStyle(tpl.value),
    { backgroundColor: tpl.value, color: CREAM },
  )
}

/* The matcher decides which pill is highlighted. Both halves must match, and
 * the tag is trimmed because a pasted trailing space is invisible. */
const trending = BADGE_TEMPLATES.find((t) => t.text === 'Trending')
check('an exact match is recognised', badgeTemplateMatch('Trending', trending.value)?.text, 'Trending')
check('a trailing space still matches', badgeTemplateMatch('Trending ', trending.value)?.text, 'Trending')
check(
  'editing the text drops the match (but not the colour)',
  badgeTemplateMatch('Trending Now', trending.value),
  null,
)
check('the right word with the wrong colour is not a match', badgeTemplateMatch('Trending', '#1F7A55'), null)
check('the right colour with no text is not a match', badgeTemplateMatch('', trending.value), null)
check('no colour at all is not a match', badgeTemplateMatch('Trending', ''), null)
check('an unparseable colour is not a match', badgeTemplateMatch('Trending', 'violet'), null)
check('a non-string tag is not a match', badgeTemplateMatch(null, trending.value), null)
check('free text that happens to share a prefix is not a match', badgeTemplateMatch('Trending 2026', trending.value), null)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
