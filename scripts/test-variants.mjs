/**
 * Variant image self-check
 * Run: npm run test:variants
 *
 * Pure Node. Covers the two things that are easy to get wrong:
 *   1. the fallback chain — a colour with no URL must never render blank
 *   2. persistence — `variantImages` has to survive the product store's
 *      whitelist, or the editor saves it and the next read drops it
 */

import {
  variantImageFor,
  resolveProductImage,
  normalizeVariantImages,
  variantImageUrls,
  isColourType,
  colourForMainImage,
  PLACEHOLDER_IMAGE,
} from '../src/utils/variantImage.js'
import { productToRow, rowToProduct } from '../src/store/mapping.js'
import { decodeCode, generateCode } from '../src/utils/code.js'

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

const BLACK = 'https://cdn.example.com/hoodie-black.jpg'
const WHITE = 'https://cdn.example.com/hoodie-white.jpg'
const DEFAULT_IMG = 'https://cdn.example.com/hoodie-main.jpg'

const product = {
  id: 'p001',
  sku: 'TEST-001',
  name: 'Hoodie',
  category: 'Hoodies',
  image: DEFAULT_IMG,
  specs: { Colour: ['Black', 'White', 'Oatmeal'], Size: ['S', 'M'] },
  variantImages: {
    Colour: { Black: BLACK, White: WHITE },
  },
}

/* ── 1. colour lookup ── */
console.log('\n[1] Colour image lookup')
check('black resolves', variantImageFor(product, { Colour: 'Black', Size: 'M' }), BLACK)
check('white resolves', variantImageFor(product, { Colour: 'White', Size: 'S' }), WHITE)
check('colour beats size when both are mapped', variantImageFor(
  { ...product, variantImages: { Size: { M: 'https://x/m.jpg' }, Colour: { Black: BLACK } } },
  { Size: 'M', Colour: 'Black' },
), BLACK)

/* ── 2. fallback ── */
console.log('\n[2] Fallback — no entry must never render blank')
check('colour without a photo → default image', resolveProductImage(product, { Colour: 'Oatmeal' }), DEFAULT_IMG)
check('no specs chosen → default image', resolveProductImage(product, {}), DEFAULT_IMG)
check('no specs at all → default image', resolveProductImage(product, undefined), DEFAULT_IMG)
check('no variantImages → default image', resolveProductImage({ ...product, variantImages: undefined }, { Colour: 'Black' }), DEFAULT_IMG)
check('no image either → placeholder', resolveProductImage({ ...product, image: '', variantImages: undefined }, { Colour: 'Black' }), PLACEHOLDER_IMAGE)
check('unknown spec type is ignored', variantImageFor(product, { Fit: 'Oversized' }), '')
check('empty option value is ignored', variantImageFor(product, { Colour: '' }), '')

/* ── 3. tolerant matching ── */
console.log('\n[3] Hand-typed keys are tolerated')
check('case drift on the value', variantImageFor(product, { Colour: 'black' }), BLACK)
check('whitespace is trimmed', variantImageFor(
  { ...product, variantImages: { Colour: { Black: `  ${BLACK}  ` } } },
  { Colour: 'Black' },
), BLACK)

/* ── 4. normalisation ── */
console.log('\n[4] Normalisation')
check('drops empty urls', normalizeVariantImages({ Colour: { Black: BLACK, White: '   ' } }), { Colour: { Black: BLACK } })
check('drops empty option names', normalizeVariantImages({ Colour: { '  ': BLACK } }), null)
check('all empty → null', normalizeVariantImages({ Colour: {} }), null)
check('not an object → null', normalizeVariantImages('nope'), null)
check('array → null', normalizeVariantImages([BLACK]), null)
check('counts every url', variantImageUrls(product).length, 2)

/* ── 5. colour type detection ── */
console.log('\n[5] Colour type detection')
check('Colour', isColourType('Colour'), true)
check('Color', isColourType('color'), true)
check('颜色', isColourType('颜色'), true)
check('Size is not colour', isColourType('Size'), false)

/* ── 6. persistence through the row mapping ──
 * The catalogue lives in Postgres now, so the round trip that matters is
 * product → row → product. `variant_images` is the snake_case column name. */
console.log('\n[6] Persistence — the row mapping must keep the field')

const row = productToRow(product, { id: 'p001' })
check('variant_images written to the row', row.variant_images, {
  Colour: { Black: BLACK, White: WHITE },
})
check('camelCase key is not leaked to the database', 'variantImages' in row, false)

const stored = rowToProduct(row)
check('variantImages survives the round trip', stored.variantImages, {
  Colour: { Black: BLACK, White: WHITE },
})
check('resolves after a round-trip', resolveProductImage(stored, { Colour: 'White' }), WHITE)
check('falls back after a round-trip', resolveProductImage(stored, { Colour: 'Oatmeal' }), DEFAULT_IMG)

/* ── 7. the decoder reads the same resolved image ──
 * decodeCode() looks the product up by id in the live catalogue, so this is
 * asserted directly on the function it calls rather than through a code. */
console.log('\n[7] The lookup path resolves the picked colour')
check('white resolves', resolveProductImage(stored, { Colour: 'White', Size: 'M' }), WHITE)
check('black resolves', resolveProductImage(stored, { Colour: 'Black', Size: 'S' }), BLACK)
check('unmapped colour falls back', resolveProductImage(stored, { Colour: 'Oatmeal' }), DEFAULT_IMG)

/* ── summary ── */
console.log(`\n${'─'.repeat(44)}`)
/* ── 主图对应的颜色（详情页默认选中它） ──
 *
 * 用户是照卡片上那张图点进来的。默认选中同一颜色的色卡，能省掉"十几个色卡
 * 里找一遍"的动作；但**找不到就必须留空** —— 默认错颜色比不默认更糟。 */
console.log('\n[colourForMainImage]')

const withColourImages = {
  id: 'p1',
  image: 'https://m.media-amazon.com/images/I/red-green.jpg',
  variantImages: {
    Colour: {
      'Red&Green': 'https://m.media-amazon.com/images/I/red-green.jpg',
      Navy: 'https://m.media-amazon.com/images/I/navy.jpg',
    },
  },
}

check('matches the main image', colourForMainImage(withColourImages), {
  type: 'Colour',
  value: 'Red&Green',
})

check(
  'ignores the host and query string',
  colourForMainImage({
    ...withColourImages,
    image: 'https://images-na.ssl-images-amazon.com/images/I/navy.jpg?w=500',
  }),
  { type: 'Colour', value: 'Navy' },
)

check('no variant images → null', colourForMainImage({ id: 'p2', image: 'x.jpg' }), null)
check('main image not among them → null', colourForMainImage({
  ...withColourImages,
  image: 'https://m.media-amazon.com/images/I/other.jpg',
}), null)
check('no main image → null', colourForMainImage({ ...withColourImages, image: '' }), null)
check('null product is safe', colourForMainImage(null), null)

/* 颜色轴优先：同时存在颜色图和尺码图时，默认选颜色。 */
check(
  'colour axis wins over size axis',
  colourForMainImage({
    id: 'p3',
    image: 'https://m.media-amazon.com/images/I/s.jpg',
    variantImages: {
      Size: { L: 'https://m.media-amazon.com/images/I/s.jpg' },
      Colour: { Black: 'https://m.media-amazon.com/images/I/s.jpg' },
    },
  }),
  { type: 'Colour', value: 'Black' },
)

console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
