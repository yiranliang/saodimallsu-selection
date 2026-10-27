/**
 * Image sizing self-check
 * Run: npm run test:image
 *
 * Pure Node — no browser, no network. Pins the rules that keep image requests
 * small without ever producing a URL that 404s.
 */

import { sizedImage, imageSrcSet, CARD_IMAGE_SIZES } from '../src/utils/image.js'

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

const REAL = 'https://m.media-amazon.com/images/I/51C4z9rC3vL._AC_SY741_.jpg'

/* ── 1. the real catalogue shape ── */
console.log('\n[1] Amazon size token')
check('height token rewritten', sizedImage(REAL, 320), REAL.replace('SY741', 'SY320'))
check('640', sizedImage(REAL, 640), REAL.replace('SY741', 'SY640'))
check('idempotent when the size already matches', sizedImage(REAL.replace('741', '320'), 320), REAL.replace('741', '320'))
check('width token also handled', sizedImage('https://m.media-amazon.com/images/I/x._AC_SX679_.jpg', 400), 'https://m.media-amazon.com/images/I/x._AC_SX400_.jpg')
check('png survives', sizedImage('https://m.media-amazon.com/images/I/x._AC_SY741_.png', 300), 'https://m.media-amazon.com/images/I/x._AC_SY300_.png')

/* ── 2. everything else is left alone ── */
console.log('\n[2] Untouchable URLs')
check('placeholder', sizedImage('./placeholders/placeholder.svg', 320), './placeholders/placeholder.svg')
check('no size token', sizedImage('https://example.com/a.jpg', 320), 'https://example.com/a.jpg')
check('empty', sizedImage('', 320), '')
check('null', sizedImage(null, 320), '')
check('zero size', sizedImage(REAL, 0), REAL)
check('negative size', sizedImage(REAL, -100), REAL)
check('rounds a fraction', sizedImage(REAL, 320.7), REAL.replace('SY741', 'SY321'))

/* ── 3. srcset is only built when resizing works ── */
console.log('\n[3] srcset')
check(
  'two widths with descriptors',
  imageSrcSet(REAL),
  `${REAL.replace('SY741', 'SY320')} 320w, ${REAL.replace('SY741', 'SY640')} 640w`,
)
check('detail widths', imageSrcSet(REAL, [640, 960]), `${REAL.replace('SY741', 'SY640')} 640w, ${REAL.replace('SY741', 'SY960')} 960w`)
/* The important one: never claim a width the file does not have. */
check('no token → no srcset', imageSrcSet('./placeholders/placeholder.svg'), undefined)
check('one width is not a srcset', imageSrcSet(REAL, [320]), undefined)
check('empty → no srcset', imageSrcSet(''), undefined)

/* ── 4. sizes ── */
console.log('\n[4] sizes hints')
check('3 breakpoints match the grid', CARD_IMAGE_SIZES.split(',').length, 3)
check('phones get ~half the viewport', /46vw/.test(CARD_IMAGE_SIZES), true)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
