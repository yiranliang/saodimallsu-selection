/**
 * Drag-a-colour-photo-onto-the-main-image self-check
 * Run: npm run test:variant-drop
 *
 * Pure Node — no browser, no database. The DOM part of the gesture is four
 * lines of handlers; what is worth testing is the contract around it:
 *
 *   1. the payload is private — a drop that is not ours must be inert, and a
 *      photo URL must never be able to land in a colour NAME field
 *   2. the three outcomes — empty photo / already the main image / apply
 *   3. a fake DataTransfer round-trips what `writeVariantDrag` put on it
 */

import {
  VARIANT_COLOUR_MIME,
  VARIANT_IMAGE_MIME,
  isVariantDrag,
  planMainImageDrop,
  readVariantDrop,
  writeVariantDrag,
} from '../src/utils/variantDrop.js'

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

/* A DataTransfer stand-in with the two things the code touches: `setData` /
 * `getData` (the payload) and `types` (what `dragover` can see). The real one
 * lower-cases types and hides the data until `drop`; neither matters here. */
function fakeTransfer() {
  const store = new Map()
  return {
    setData(type, value) {
      store.set(String(type).toLowerCase(), String(value))
    },
    getData(type) {
      return store.get(String(type).toLowerCase()) || ''
    },
    get types() {
      return [...store.keys()]
    },
  }
}

/* ── 1. the payload ── */

check('the image MIME type is private', VARIANT_IMAGE_MIME.startsWith('application/x-'), true)
check('and not text/plain', VARIANT_IMAGE_MIME === 'text/plain', false)
check('the colour travels on its own type', VARIANT_COLOUR_MIME === VARIANT_IMAGE_MIME, false)

const written = fakeTransfer()
writeVariantDrag(written, { url: 'https://cdn.example.com/black.jpg', colour: 'Black' })
check('dragstart writes the URL', written.getData(VARIANT_IMAGE_MIME), 'https://cdn.example.com/black.jpg')
check('and the colour', written.getData(VARIANT_COLOUR_MIME), 'Black')
check('and nothing in text/plain', written.getData('text/plain'), '')

check('a drag of ours is recognised', isVariantDrag(written.types), true)
check('a drag of something else is not', isVariantDrag(['text/plain', 'Files']), false)
check('an empty type list is not', isVariantDrag([]), false)
check('and neither is a missing one', isVariantDrag(undefined), false)

/* ── 2. reading it back ── */

check(
  'the drop reads both halves',
  readVariantDrop(written),
  { url: 'https://cdn.example.com/black.jpg', colour: 'Black' },
)
check('a transfer with nothing on it is not a payload', readVariantDrop(fakeTransfer()), null)
check('a foreign payload is not ours either', readVariantDrop({ getData: () => '' }), null)
check('a missing transfer is not a payload', readVariantDrop(null), null)
check('and neither is a non-transfer', readVariantDrop({}), null)

/* A pasted URL with spaces around it is the same URL — the field would store
 * it either way, so the comparison has to be against the trimmed form. */
const padded = fakeTransfer()
writeVariantDrag(padded, { url: '  https://cdn.example.com/black.jpg  ', colour: ' Black ' })
check(
  'surrounding whitespace is trimmed on the way out',
  readVariantDrop(padded),
  { url: 'https://cdn.example.com/black.jpg', colour: 'Black' },
)

/* ── 3. the decision ── */

const incoming = { url: 'https://cdn.example.com/black.jpg', colour: 'Black' }

check(
  'a normal drop applies',
  planMainImageDrop('https://cdn.example.com/old.jpg', incoming),
  { kind: 'apply', url: 'https://cdn.example.com/black.jpg', colour: 'Black' },
)
check(
  'dropping the photo that is already there is a no-op',
  planMainImageDrop('https://cdn.example.com/black.jpg', incoming),
  { kind: 'noop', url: 'https://cdn.example.com/black.jpg', colour: 'Black' },
)
check(
  'and so is dropping it with stray spaces around the stored value',
  planMainImageDrop('  https://cdn.example.com/black.jpg  ', incoming),
  { kind: 'noop', url: 'https://cdn.example.com/black.jpg', colour: 'Black' },
)
check(
  'an empty URL is reported, not silently ignored',
  planMainImageDrop('https://cdn.example.com/old.jpg', { url: '', colour: 'Black' }),
  { kind: 'empty', url: '', colour: 'Black' },
)
check(
  'an empty main image still applies',
  planMainImageDrop('', incoming).kind,
  'apply',
)
check(
  'a missing colour name does not break the plan',
  planMainImageDrop('', { url: 'https://cdn.example.com/x.jpg' }),
  { kind: 'apply', url: 'https://cdn.example.com/x.jpg', colour: '' },
)
check(
  'and neither does a missing incoming object',
  planMainImageDrop('https://cdn.example.com/old.jpg', undefined).kind,
  'empty',
)

/* ── 4. the thing the private MIME type exists to prevent ── */

/* If the payload ever grows a text/plain entry, dropping a card on a colour
 * name input would insert the URL as the name — which saves cleanly and
 * corrupts every ASIN key built from that colour. So assert the absence, not
 * just the presence of the private type. */
const leaky = fakeTransfer()
writeVariantDrag(leaky, { url: 'https://cdn.example.com/black.jpg', colour: 'Black' })
check('no text/plain is ever put on the drag', leaky.types.includes('text/plain'), false)
check('no text/html either', leaky.types.includes('text/html'), false)
check('no text/uri-list either', leaky.types.includes('text/uri-list'), false)
check(
  'the drag carries exactly the two private types',
  leaky.types.slice().sort(),
  [VARIANT_COLOUR_MIME, VARIANT_IMAGE_MIME].sort(),
)

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
