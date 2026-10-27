/**
 * Row ⇄ product mapping self-check (pure Node, no database)
 *   node scripts/test-mapping.mjs
 *
 * This is the layer that replaced localStorage. Two classes of bug live here:
 *
 *   1. a field silently dropped by the whitelist — `sku`, `variantImages` and
 *      `hidden` have each been lost this way once
 *   2. `specs` key order changing on the way through Postgres — the v4 code
 *      encodes option VALUES positionally, so a reordered object silently
 *      swaps every colour with its size on decode
 */

import { normalizeProduct, rowToProduct, productToRow, UNCATEGORISED } from '../src/store/mapping.js'

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

/* ── 1. row → product ── */
console.log('\n[1] Database row → product')
const row = {
  id: 'p001',
  sku: 'P9B013',
  name: 'Wide-Leg Trousers',
  category: 'Bottoms',
  image: 'https://cdn.example.com/a.jpg',
  specs: { Colour: ['Black', 'White'], Size: ['S', 'M'] },
  variant_images: { Colour: { Black: 'https://cdn.example.com/b.jpg' } },
  hidden: true,
  tag: 'New',
  sort_order: 0,
}

const product = rowToProduct(row)
check('id kept', product.id, 'p001')
check('sku kept', product.sku, 'P9B013')
check('name kept', product.name, 'Wide-Leg Trousers')
check('category kept', product.category, 'Bottoms')
check('image kept', product.image, 'https://cdn.example.com/a.jpg')
check('tag kept', product.tag, 'New')
check('hidden kept', product.hidden, true)
check('variant_images → variantImages', product.variantImages, {
  Colour: { Black: 'https://cdn.example.com/b.jpg' },
})
check('no snake_case leaks into the product', 'variant_images' in product, false)
check('sort_order is not part of the product', 'sort_order' in product, false)

/* ── 2. specs key order — the code-breaking one ── */
console.log('\n[2] specs key order')
check('Colour comes first, as stored', Object.keys(product.specs), ['Colour', 'Size'])
check('options keep their order', product.specs.Colour, ['Black', 'White'])

// A row that arrives with Size first must stay Size first. Sorting here would
// swap every colour with its size on decode.
const reversed = rowToProduct({ ...row, specs: { Size: ['S'], Colour: ['Black'] } })
check('an unusual order is preserved, not normalised', Object.keys(reversed.specs), ['Size', 'Colour'])

/* ── 3. defensive normalisation ── */
console.log('\n[3] Messy rows do not crash the UI')
const sparse = rowToProduct({ id: 'p002' })
check('missing name falls back', sparse.name, 'Untitled product')
check('missing category falls back', sparse.category, UNCATEGORISED)
check('missing image falls back', sparse.image, './placeholders/placeholder.svg')
check('missing tag becomes empty', sparse.tag, '')
check('missing specs become {}', sparse.specs, {})
check('missing hidden stays absent', 'hidden' in sparse, false)
check('missing sku stays absent', 'sku' in sparse, false)

check('blank sku is dropped', 'sku' in rowToProduct({ id: 'p003', sku: '   ' }), false)
check('sku is trimmed', rowToProduct({ id: 'p004', sku: '  A-1  ' }).sku, 'A-1')

check(
  'a scalar option becomes an array',
  rowToProduct({ id: 'p005', specs: { Colour: 'Black' } }).specs,
  { Colour: ['Black'] },
)
check(
  'blank options are dropped',
  rowToProduct({ id: 'p006', specs: { Colour: ['Black', '', null] } }).specs,
  { Colour: ['Black'] },
)
check(
  'an empty spec group disappears',
  rowToProduct({ id: 'p007', specs: { Colour: [], Size: ['M'] } }).specs,
  { Size: ['M'] },
)

/* ── 4. product → row ── */
console.log('\n[4] Product → database row')
const out = productToRow(product)
check('id carried over', out.id, 'p001')
check('variantImages → variant_images', out.variant_images, {
  Colour: { Black: 'https://cdn.example.com/b.jpg' },
})
check('no camelCase leaks to the database', 'variantImages' in out, false)
check('hidden is a real boolean', out.hidden, true)
check('is_teaser is a real boolean', out.is_teaser, false)
check('a teaser writes true', productToRow({ ...product, isTeaser: true }).is_teaser, true)

const noId = productToRow({ ...product, id: undefined })
check('a new product sends no id (the sequence assigns one)', 'id' in noId, false)
check('sort_order only when asked', 'sort_order' in noId, false)
check('sort_order when asked', productToRow(product, { sortOrder: 7 }).sort_order, 7)

/* Position is owned by the reorder writers. If a save could carry it, a save
 * built on a pre-drag snapshot would silently undo the drag — so a product that
 * happens to carry a position must still produce no `sort_order` column. */
const smuggled = productToRow({ ...product, sortOrder: 3, sort_order: 3 }, { id: product.id })
check('a position on the product is not written back', 'sort_order' in smuggled, false)
check('the explicit option still wins', productToRow({ ...product, sort_order: 3 }, { sortOrder: 9 }).sort_order, 9)

const visible = productToRow({ ...product, hidden: undefined })
check('absent hidden becomes false', visible.hidden, false)

/* ── 5. round trip ── */
console.log('\n[5] Round trip')
const back = rowToProduct(productToRow(product, { id: product.id }))
check('id', back.id, product.id)
check('sku', back.sku, product.sku)
check('category', back.category, product.category)
check('specs', back.specs, product.specs)
check('specs key order', Object.keys(back.specs), ['Colour', 'Size'])
check('variantImages', back.variantImages, product.variantImages)
check('hidden', back.hidden, true)
check('tag', back.tag, product.tag)
check('a non-teaser omits the key', 'isTeaser' in back, false)
check(
  'isTeaser survives the round trip',
  rowToProduct(productToRow({ ...product, isTeaser: true }, { id: product.id })).isTeaser,
  true,
)

/* ── 6. shipped data still normalises ── */
console.log('\n[6] Shipped data (the Node fallback)')
const local = normalizeProduct({ id: 'p009', name: 'X', specs: { Colour: ['Red'] }, hidden: true })
check('local product keeps its shape', Object.keys(local.specs), ['Colour'])
check('local hidden kept', local.hidden, true)
check('local id kept', local.id, 'p009')

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
