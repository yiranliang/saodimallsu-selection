/**
 * Selection code self-check
 * Run: npm run test:code
 *
 * Pure Node — no browser, no test framework.
 * Run this after touching code.js, products.js or asins.js to confirm encoding
 * and decoding are still symmetrical, and that a code survives the catalogue
 * being reordered or pruned.
 *
 * v7 is the current format: ids, packed option indexes, quantity and a
 * timestamp, in plain base62 — no base64 envelope. Names, 货号 and ASINs are
 * resolved from the catalogue at decode time. v1–v6 still decode.
 */

import {
  generateCode,
  generateCodeFromLines,
  decodeCode,
  MAX_QTY,
  CODE_PREFIX,
  LEGACY_CODE_PREFIXES,
  ACCEPTED_CODE_PREFIXES,
} from '../src/utils/code.js'
import {
  collectAsins,
  asinsToText,
  selectionListText,
  amazonLink,
} from '../src/utils/clipboard.js'
import { products } from '../src/data/products.js'
import { __setCatalogueForTests as setProducts } from '../src/store/productStore.js'
import { __setAsinsForTests as setAsins } from '../src/utils/asinStore.js'

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

/* Fixtures — derived from the real catalogue so this file never needs editing
   when the sheet is re-imported. */
const [A, B, C] = products
const pick = (product) => ({
  Colour: product.specs.Colour?.[0] ?? '',
  Size: product.specs.Size?.[0] ?? '',
})

/* ── 1. typical selection with quantities and specs ── */
console.log('\n[1] Typical selection · 3 styles, mixed quantities')
const selection = { [A.id]: 2, [B.id]: 1, [C.id]: 3 }
const specs = { [A.id]: pick(A), [B.id]: pick(B), [C.id]: pick(C) }

const { code } = generateCode('luna', selection, specs)
const decoded = decodeCode(code)

console.log(`  code: ${code}  (${code.length} chars)`)
check('ok flag', decoded.ok, true)
check('version', decoded.version, 7)
check('not legacy', decoded.legacy, false)
check('creator', decoded.ref, 'luna')
check('style count', decoded.totalStyles, 3)
check('unit count', decoded.totalUnits, 6)
check('ids in order', decoded.items.map((i) => i.id), [A.id, B.id, C.id])
check('quantities', decoded.items.map((i) => i.qty), [2, 1, 3])
check('specs style 1', decoded.items[0].specs, pick(A))
check('specs style 3', decoded.items[2].specs, pick(C))
check('specText', decoded.items[0].specText, `${pick(A).Colour} / ${pick(A).Size}`)
check('name resolved from catalogue', decoded.items[0].name, A.name)
check('货号 resolved from catalogue', decoded.items[0].sku, A.sku)
check('no missing', decoded.missing, [])
check('no warnings', decoded.warnings, [])

/* ── 2. single unit still round-trips ── */
console.log('\n[2] Single style, single unit')
const one = decodeCode(generateCode('mako', { [B.id]: 1 }, {}).code)
check('ok', one.ok, true)
check('qty', one.items[0].qty, 1)
check('total', one.totalUnits, 1)

/* ── 3. quantity ceiling ── */
console.log(`\n[3] Quantity clamping (max ${MAX_QTY})`)
const clamped = decodeCode(generateCode('x', { [A.id]: 999 }, {}).code)
check('clamped to max', clamped.items[0].qty, MAX_QTY)

/* ── 4. every product can be encoded ── */
console.log('\n[4] All products')
const all = {}
products.forEach((p) => { all[p.id] = 1 })
const allDecoded = decodeCode(generateCode('chenxi', all, {}).code)
check('all styles', allDecoded.totalStyles, products.length)
check('all units', allDecoded.totalUnits, products.length)
check('ids match', allDecoded.items.map((i) => i.id), products.map((p) => p.id))

/* ── 5. empty / invalid input ── */
console.log('\n[5] Invalid input')
check('no prefix → not ok', decodeCode('hello').ok, false)
check('corrupt body → not ok', decodeCode('zby-@@@@@').ok, false)
check('empty string → not ok', decodeCode('').ok, false)
check('null → not ok', decodeCode(null).ok, false)
check('empty selection → not ok', decodeCode(generateCode('a', {}, {}).code).ok, false)
check('unknown version → not ok', decodeCode(buildRaw('9.luna._._.1._')).ok, false)
check('v4 with a stray segment → not ok', decodeCode(buildRaw('4.luna._._.1._.extra')).ok, false)

/* ── 5b. brand prefix ──
   两个品牌各有一份部署、各自的 Supabase 与各自的 catalogue，但 `p034` 在
   两边都存在且指向不同的衣服。跨品牌粘贴过来的码**必须被拦下**：强行解析的
   产物是一份名字、货号、颜色俱全、且完全错误的订单。

   同时历史前缀不能失效 —— 红人手里那些老链接不会因为后台改了名牌就作废。 */
console.log('\n[5b] Code prefix — brand boundary')

const prefixSample = generateCode('luna', { [A.id]: 1 }, { [A.id]: { Colour: 'Black', Size: 'M' } }).code
const prefixBody = prefixSample.slice(CODE_PREFIX.length + 1)

check('CODE_PREFIX is the current brand', CODE_PREFIX, 'sdm')
check('the emitted prefix is configurable, not hardcoded', LEGACY_CODE_PREFIXES.includes('zby'), true)
check('accepted prefixes = current + legacy', ACCEPTED_CODE_PREFIXES, ['sdm', 'zby'])
check(`code starts with ${CODE_PREFIX}-`, prefixSample.startsWith(`${CODE_PREFIX}-`), true)
check('body is plain text, not base64', prefixBody.startsWith('7.'), true)
check('no base64 padding, plus or slash', /[+/=]/.test(prefixSample), false)

/* 新码走当前品牌 */
check('decodes as generated', decodeCode(prefixSample).ok, true)
check('prefix match is case-insensitive', decodeCode(`SDM-${prefixBody}`).ok, true)

/* 历史老码照旧能用 —— 这是"旧码不能失效"的回归条 */
console.log('\n[5c] Legacy zby- codes still decode after the rebrand')
check('legacy prefix is still accepted', decodeCode(`zby-${prefixBody}`).ok, true)
check('and resolves to the same order', decodeCode(`zby-${prefixBody}`).items.map((i) => i.id), [A.id])
check('legacy prefix case-insensitive too', decodeCode(`ZBY-${prefixBody}`).ok, true)
/* 一个新品牌上线只影响编码，不该让已发出的码沉掉 */
check('but the new brand is what gets emitted', generateCode('luna', { [A.id]: 1 }, {}).code.startsWith('sdm-'), true)

/* 别的品牌必须被拦 */
console.log('\n[5d] A foreign brand is rejected, not decoded')
check('ngb- (brand B) → not ok', decodeCode(`ngb-${prefixBody}`).ok, false)
check('and it says why', decodeCode(`ngb-${prefixBody}`).error, 'Invalid brand prefix')
check('NGB- upper case too', decodeCode(`NGB-${prefixBody}`).error, 'Invalid brand prefix')
/* MAKO 是更早的旧名，当前实现同样不认 —— 保持被拒，不给"陌生前缀"开口子 */
check('ancient MAKO- stays rejected', decodeCode(`MAKO-${prefixBody}`).ok, false)
check('rejected as foreign too', decodeCode(`MAKO-${prefixBody}`).error, 'Invalid brand prefix')
/* 没有前缀 → 提示正确格式，而不是"品牌不对" */
check('no prefix at all → not ok', decodeCode('hello').ok, false)
check('and it names the prefix we do want', decodeCode('hello').error, 'Code must start with "sdm-"')
check('numbers are not treated as a brand', decodeCode('12345-7.x').error, 'Code must start with "sdm-"')

/* ── 6. v1 codes still decode, flagged as legacy ── */
console.log('\n[6] v1 compatibility (no quantity segment)')
const v1 = decodeCode(buildRaw(`1.luna.${(Math.pow(2, 0) + Math.pow(2, 2)).toString(36)}.00-x.tn72lo`))
check('v1 ok', v1.ok, true)
check('v1 version', v1.version, 1)
check('v1 flagged legacy', v1.legacy, true)
check('v1 warns', v1.warnings.length > 0, true)
check('v1 quantities default to 1', v1.items.map((i) => i.qty), [1, 1])

/* ── 7. v2 codes still decode, flagged as legacy ── */
console.log('\n[7] v2 compatibility (bitmask + quantity)')
const v2 = decodeCode(buildRaw(`2.luna.${(Math.pow(2, 1)).toString(36)}.11.3.tn72lo`))
check('v2 ok', v2.ok, true)
check('v2 version', v2.version, 2)
check('v2 flagged legacy', v2.legacy, true)
check('v2 qty', v2.items[0].qty, 3)
check('v2 resolved by position', v2.items[0].id, products[1].id)

/* ── 8. v3 codes still decode — same id-based logic, name snapshot ignored
        when the product is still in the catalogue ── */
console.log('\n[8] v3 compatibility (ids + name snapshot)')
const v3Specs = Object.entries(pick(A)).map(([type, value]) => `${type}=${value}`).join(',')
const v3Payload = [
  '3',
  'luna',
  `${A.id}~${B.id}`,
  `${v3Specs}~`,
  '21',
  `${encodeURIComponent('Old Name Snapshot')}~`,
  'tn72lo',
].join('.')
const v3 = decodeCode(buildRaw(v3Payload))
check('v3 ok', v3.ok, true)
check('v3 version', v3.version, 3)
check('v3 not flagged legacy', v3.legacy, false)
check('v3 ids', v3.items.map((i) => i.id), [A.id, B.id])
check('v3 quantities', v3.items.map((i) => i.qty), [2, 1])
check('v3 name from catalogue, not the snapshot', v3.items[0].name, A.name)
check('v3 options from code', v3.items[0].specs, pick(A))
check('v3 second item has no options', v3.items[1].specs, {})

/* ── 9. v4 survives a reordered catalogue ── */
console.log('\n[9] Reordering the catalogue does not corrupt a v7 code')
const original = products
const reorderSpecs = {
  [A.id]: { Colour: A.specs.Colour?.[1] ?? '', Size: A.specs.Size?.[1] ?? '' },
}
const reorderCode = generateCode('luna', { [A.id]: 2, [products[3].id]: 1 }, reorderSpecs).code
setProducts([...original].reverse())
const afterReorder = decodeCode(reorderCode)
check('still ok', afterReorder.ok, true)
check('same ids', afterReorder.items.map((i) => i.id), [A.id, products[3].id])
check('same specs', afterReorder.items[0].specs, reorderSpecs[A.id])
check('same quantities', afterReorder.items.map((i) => i.qty), [2, 1])
setProducts(original)

/* ── 10. v4 survives a deleted product ── */
console.log('\n[10] Deleting a product marks it, it does not fail the code')
const gone = A
const goneSpecs = { [gone.id]: { Colour: gone.specs.Colour?.[2] ?? '', Size: gone.specs.Size?.[0] ?? '' } }
const deleteCode = generateCode('luna', { [gone.id]: 3, [B.id]: 1 }, goneSpecs).code
setProducts(original.filter((p) => p.id !== gone.id))
const afterDelete = decodeCode(deleteCode)
check('code still ok', afterDelete.ok, true)
check('missing list', afterDelete.missing, [gone.id])
check('warning raised', afterDelete.warnings.length > 0, true)
check('reported by id, no snapshot', afterDelete.items[0].name, `已下架商品（${gone.id}）`)
check('quantity kept', afterDelete.items[0].qty, 3)
/* v7 stores option *positions*, so a deleted product cannot give the values
   back — the option lists are what turn an index into "Black". The line is
   still reported with its product id and quantity, which is the trade the
   compact format makes (see README). */
check('options cannot be recovered for a deleted product', afterDelete.items[0].specs, {})
check('and the line says so rather than guessing', afterDelete.items[0].specText, '—')
check('marked missing', afterDelete.items[0].missing, true)
check('no sku when missing', afterDelete.items[0].sku, '')
check('no asin when missing', afterDelete.items[0].asin, '')
check('other item resolves', afterDelete.items[1].id, B.id)
check('totals still count it', afterDelete.totalUnits, 4)
setProducts(original)

/* ── 11. 货号 (sku) and the single variant ASIN are resolved at decode time ── */
console.log('\n[11] 货号 + per-variant ASIN resolution')
setProducts([
  {
    id: 'p001',
    sku: 'AMZ-1003',
    name: 'AMZ-1003',
    category: 'Uncategorised',
    image: './placeholders/placeholder.svg',
    specs: { Colour: ['Black', 'Oatmeal'], Size: ['S', 'M'] },
    tag: '',
  },
])
setAsins({ 'AMZ-1003': { 'Black|S': 'B0TEST0001', 'Oatmeal|M': 'B0TEST0002' } })

const withSku = decodeCode(
  generateCode('x', { p001: 2 }, { p001: { Colour: 'Oatmeal', Size: 'M' } }).code,
)
check('sku resolved from catalogue', withSku.items[0].sku, 'AMZ-1003')
check('exact variant ASIN', withSku.items[0].asin, 'B0TEST0002')
check('options round-trip', withSku.items[0].specs, { Colour: 'Oatmeal', Size: 'M' })

const otherVariant = decodeCode(
  generateCode('x', { p001: 1 }, { p001: { Colour: 'Black', Size: 'S' } }).code,
)
check('different colour+size → different ASIN', otherVariant.items[0].asin, 'B0TEST0001')

const noVariant = decodeCode(
  generateCode('x', { p001: 1 }, { p001: { Colour: 'Black', Size: 'M' } }).code,
)
check('unmapped combination → empty asin', noVariant.items[0].asin, '')

const noSpecs = decodeCode(generateCode('x', { p001: 1 }, {}).code)
check('no options chosen → empty asin', noSpecs.items[0].asin, '')

setAsins({})

/* ── 12. escaping: delimiters and Chinese survive ── */
console.log('\n[12] Escaping · delimiters and unicode')
setProducts([
  {
    id: 'p001',
    sku: '测试 货号/01',
    name: '黑色外套',
    category: 'Uncategorised',
    image: './placeholders/placeholder.svg',
    specs: { Colour: ['A.B~C,D=E'], Size: ['均码'] },
    tag: '',
  },
])
const tricky = decodeCode(
  generateCode('x', { p001: 1 }, { p001: { Colour: 'A.B~C,D=E', Size: '均码' } }).code,
)
check('delimiter-heavy value', tricky.items[0].specs, { Colour: 'A.B~C,D=E', Size: '均码' })
check('chinese name from catalogue', tricky.items[0].name, '黑色外套')
check('chinese sku', tricky.items[0].sku, '测试 货号/01')

/* ── 13. v4 is materially shorter than v3 for the same selection ──
        Uses realistic product names, because the name snapshot was the whole
        point of the change — a 货号-only name would understate the saving. */
console.log('\n[13] v7 length vs v3 (same selection, realistic names)')
const longNames = [
  { id: 'p001', sku: 'P9B013', name: 'Oversized Cotton Zip Hoodie — Washed Black', category: 'Hoodies', image: './placeholders/placeholder.svg', specs: { Colour: ['Washed Black', 'Oatmeal'], Size: ['S', 'M'] }, tag: '' },
  { id: 'p002', sku: 'P9B018', name: 'Cropped Ribbed Knit Cardigan — Cream', category: 'Knitwear', image: './placeholders/placeholder.svg', specs: { Colour: ['Cream', 'Sage'], Size: ['S', 'M'] }, tag: '' },
  { id: 'p003', sku: 'P9B030', name: 'Wide-Leg Tailored Trousers — Charcoal', category: 'Trousers', image: './placeholders/placeholder.svg', specs: { Colour: ['Charcoal', 'Stone'], Size: ['S', 'M'] }, tag: '' },
]
setProducts(longNames)
const longSelection = { p001: 2, p002: 1, p003: 3 }
const longSpecs = {
  p001: { Colour: 'Washed Black', Size: 'M' },
  p002: { Colour: 'Cream', Size: 'S' },
  p003: { Colour: 'Charcoal', Size: 'M' },
}
const compactCode = generateCode('luna', longSelection, longSpecs).code
const v3Equivalent = buildRaw([
  '3',
  'luna',
  'p001~p002~p003',
  ['Colour=Washed%20Black,Size=M', 'Colour=Cream,Size=S', 'Colour=Charcoal,Size=M'].join('~'),
  '213',
  longNames.map((p) => encodeURIComponent(p.name)).join('~'),
  'tn72lo',
].join('.'))
console.log(`  v3: ${v3Equivalent.length} chars`)
console.log(`  v7: ${compactCode.length} chars  (${Math.round((1 - compactCode.length / v3Equivalent.length) * 100)}% shorter)`)
check('v7 shorter than v3', compactCode.length < v3Equivalent.length, true)
check('v7 at least 60% shorter', compactCode.length / v3Equivalent.length < 0.4, true)
check('v7 decodes to the same ids', decodeCode(compactCode).items.map((i) => i.id), ['p001', 'p002', 'p003'])
check('v7 decodes to the same names', decodeCode(compactCode).items.map((i) => i.name), longNames.map((p) => p.name))

/* ── 14. creator handle sanitising ── */
console.log('\n[14] Handle sanitising')
setProducts(original)
const dirty = decodeCode(generateCode('Lu Na-测试!!', { [A.id]: 1 }, {}).code)
check('stripped and lowercased', dirty.ref, 'luna')

/* ── 15. multi-variant: the same product on two lines ── */
console.log('\n[15] Multi-variant selection')
const multiProduct = {
  id: 'p001',
  sku: 'P9B013',
  name: 'Oversized Hoodie',
  category: 'Hoodies',
  image: './placeholders/placeholder.svg',
  specs: { Colour: ['Black', 'White'], Size: ['S', 'M', 'L'] },
  tag: '',
}
setProducts([multiProduct])

const twoVariants = [
  { productId: 'p001', qty: 2, specs: { Colour: 'Black', Size: 'M' } },
  { productId: 'p001', qty: 1, specs: { Colour: 'White', Size: 'L' } },
]

const multi = generateCodeFromLines('luna', twoVariants)
const multiDecoded = decodeCode(multi.code)
console.log(`  code: ${multi.code}  (${multi.code.length} chars)`)

check('two lines are encoded', multiDecoded.totalStyles, 2)
check('but it is one style', multiDecoded.distinctProducts, 1)
check('units are summed', multiDecoded.totalUnits, 3)
check('still v7 when a product repeats', multiDecoded.version, 7)
check('both ids are the same product', multiDecoded.items.map((i) => i.id), ['p001', 'p001'])
check(
  'the two options survive in order',
  multiDecoded.items.map((i) => i.specText),
  ['Black / M', 'White / L'],
)
check('quantities stay per line', multiDecoded.items.map((i) => i.qty), [2, 1])
check('payload carries both combinations', multi.payload.items.length, 2)

/* same colour+size twice would be a mistake, but a hand-built code can do it:
   the decoder keeps both lines rather than inventing a merged quantity */
const dupLines = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
  { productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
])
const dupDecoded = decodeCode(dupLines.code)
check('identical lines are not merged', dupDecoded.items.length, 2)
check('identical lines are still one style', dupDecoded.distinctProducts, 1)

/* One line is v7 too — there is no shorter legacy format worth branching for. */
const single = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 2, specs: { Colour: 'Black', Size: 'M' } },
])
check('one line is v7 as well', decodeCode(single.code).version, 7)
check('and reports one distinct product', decodeCode(single.code).distinctProducts, 1)

/* a colour deleted from the catalogue must not survive into the code */
const staleLine = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 1, specs: { Colour: 'Charcoal', Size: 'M' } },
  { productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
])
const staleDecoded = decodeCode(staleLine.code)
check('the deleted colour is dropped', staleDecoded.items.length, 1)
check('the valid combination remains', staleDecoded.items[0].specText, 'Black / M')

/* catalogue order wins over pick order, so the same selection is stable */
const reversed = generateCodeFromLines('luna', [
  { productId: 'p002', qty: 1, specs: {} },
  { productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
])
check(
  'lines are emitted in catalogue order',
  decodeCode(reversed.code).items.map((i) => i.id),
  ['p001', 'p002'],
)

/* ── 16. "Copy All ASINs" — bare list, one per line ── */
console.log('\n[16] Copy All ASINs')
setProducts([
  {
    id: 'p001',
    sku: 'SKU-A',
    name: 'Hoodie',
    category: 'Hoodies',
    image: './placeholders/placeholder.svg',
    specs: { Colour: ['Black', 'White'], Size: ['S', 'M', 'L'] },
    tag: '',
  },
  {
    id: 'p002',
    sku: 'SKU-B',
    name: 'Plain Tee',
    category: 'Tops',
    image: './placeholders/placeholder.svg',
    specs: {},
    tag: '',
  },
])
setAsins({
  'SKU-A': {
    'Black|S': 'B0AAAAAAAA',
    'Black|M': 'B0BBBBBBBB',
    'White|L': 'B0CCCCCCCC',
  },
  /* SKU-B has no listing at all → its line must vanish from the copy */
  'SKU-B': {},
})

const asinSelection = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 2, specs: { Colour: 'Black', Size: 'S' } },
  { productId: 'p001', qty: 1, specs: { Colour: 'Black', Size: 'M' } },
  { productId: 'p002', qty: 1, specs: {} },
])
const asinResult = decodeCode(asinSelection.code)

check('three lines parsed', asinResult.items.length, 3)
check('only two have an ASIN', asinResult.items.filter((i) => i.asin).length, 2)
check('collectAsins keeps code order', collectAsins(asinResult), ['B0AAAAAAAA', 'B0BBBBBBBB'])
check('text is one bare ASIN per line', asinsToText(asinResult), 'B0AAAAAAAA\nB0BBBBBBBB')

/* the contract the ERP/Amazon box needs: nothing but ASINs and newlines */
check('no trailing newline', asinsToText(asinResult).endsWith('\n'), false)
check('no empty lines', asinsToText(asinResult).split('\n').filter((l) => !l).length, 0)
check('no quotes, commas, spaces or labels', /^[A-Z0-9\n]+$/.test(asinsToText(asinResult)), true)

/* duplicates: two lines resolving to the same listing appear once */
check(
  'duplicate ASINs collapse',
  collectAsins({ items: [{ asin: 'B0X' }, { asin: 'B0X' }, { asin: 'B0Y' }] }),
  ['B0X', 'B0Y'],
)

/* the "No matching ASIN" rows are skipped, not turned into blank lines */
check(
  'blank ASINs are skipped',
  collectAsins({ items: [{ asin: '' }, { asin: 'B0Y' }, { asin: undefined }] }),
  ['B0Y'],
)

/* a product deleted after the code was issued: the row stays visible in the
   table (marked Removed) but contributes no ASIN to the copy */
setProducts([
  {
    id: 'p001',
    sku: 'SKU-A',
    name: 'Hoodie',
    category: 'Hoodies',
    image: './placeholders/placeholder.svg',
    specs: { Colour: ['Black', 'White'], Size: ['S', 'M', 'L'] },
    tag: '',
  },
])
const afterRemoval = decodeCode(asinSelection.code)
check('removed product is still listed', afterRemoval.items.length, 3)
check('but it contributes no ASIN', collectAsins(afterRemoval), ['B0AAAAAAAA', 'B0BBBBBBBB'])

/* nothing to copy at all → empty string, so the UI can disable the button */
check('no items → empty list', collectAsins({ items: [] }), [])
check('no items → empty text', asinsToText({ items: [] }), '')
check('null result is safe', asinsToText(null), '')

/* whitespace around a stored ASIN must not leak into the clipboard */
check('ASINs are trimmed', collectAsins({ items: [{ asin: '  B0Z  ' }] }), ['B0Z'])

/* ── 17. "Copy list" — the creator-facing list ── */
console.log('\n[17] Copy list (creator-facing)')
const creatorList = selectionListText(asinResult)
const creatorLines = creatorList.split('\n')

check(
  'one line per variant, name + options + qty + link',
  creatorLines[0],
  'Hoodie (Black / S) × 2 - https://www.amazon.com/dp/B0AAAAAAAA',
)
check(
  'the second variant links to its own ASIN, not the first',
  creatorLines[1],
  'Hoodie (Black / M) × 1 - https://www.amazon.com/dp/B0BBBBBBBB',
)
check(
  'no ASIN → the line stays, the link slot says so',
  creatorLines[2],
  'Plain Tee × 1 - (no ASIN on file)',
)

/* The whole point of the change: 货号 is internal, so it must not appear at all */
check('no 货号 anywhere in the list', /SKU-A|SKU-B/.test(creatorList), false)
check('no em dash between 货号 and name', creatorList.includes('—'), false)
check('no internal status wording', /removed|hidden|no matching asin/i.test(creatorList), false)
check('no line numbers', /^\d+\.\s/m.test(creatorList), false)

check('every line ends with a link or the no-link marker', creatorLines.every((l) => / - (https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]+|\(no ASIN on file\))$/.test(l)), true)
check('links point at amazon.com/dp/<ASIN>', creatorLines[0].endsWith('/dp/B0AAAAAAAA'), true)

/* A product without options prints no empty brackets */
check(
  'placeholder specText is dropped',
  selectionListText({ items: [{ name: 'Plain Tee', specText: '—', qty: 3, asin: 'B0Z' }] }),
  'Plain Tee × 3 - https://www.amazon.com/dp/B0Z',
)
check('null-safe', selectionListText(null), '')
check('no items → empty', selectionListText({ items: [] }), '')
/* Deep-link helpers on their own */
check('link helper trims', amazonLink('  B0Z  '), 'https://www.amazon.com/dp/B0Z')
check('link helper on a blank ASIN', amazonLink(''), '')

/* ── 18. v7: every line's options packed into one integer ──
   Ten lines that share a long colour/size used to repeat "Army%20Green|XXL" on
   every one of them. v7 stores each line as its index in the product's own
   colour × size grid and packs the whole column into a single base62 number, so
   the option values do not appear in the code at all. */
console.log('\n[18] v7 packing · 10 lines, one colour/size')

const flatCatalogue = Array.from({ length: 10 }, (_, i) => ({
  id: `p${String(i + 1).padStart(3, '0')}`,
  sku: `SKU-${i}`,
  name: `A very long product name number ${i} that used to live inside the code`,
  category: 'Tops',
  image: './placeholders/placeholder.svg',
  specs: { Colour: ['Army Green', 'Charcoal Grey'], Size: ['XXL', 'M'] },
  tag: '',
}))
setProducts(flatCatalogue)
setAsins({})

const flatLines = flatCatalogue.map((p) => ({
  productId: p.id,
  qty: 1,
  specs: { Colour: 'Army Green', Size: 'XXL' },
}))
const flatCode = generateCodeFromLines('luna', flatLines)
const flatDecoded = decodeCode(flatCode.code)
console.log(`  code: ${flatCode.code}  (${flatCode.code.length} chars)`)

check('every line is v7', flatDecoded.version, 7)
check('all ten lines survive', flatDecoded.totalStyles, 10)
check(
  'values are unchanged',
  flatDecoded.items.map((i) => i.specText),
  Array(10).fill('Army Green / XXL'),
)
check('names resolve from the catalogue', flatDecoded.items[0].name, flatCatalogue[0].name)
check('ten styles fit in 100 characters', flatCode.code.length < 100, true)

/* The code is a string, not the decoded object: neither the name nor the
   colour may appear inside it any more. */
const flatBody = flatCode.code.slice(4)
check('payload carries no product name', flatBody.includes('long product name'), false)
check('payload carries no colour literal', flatBody.includes('Army'), false)
check('payload carries no size literal', flatBody.includes('XXL'), false)

/* ── 19. fifty and seventy styles ── */
console.log('\n[19] Long selections · 50 and 70 styles')

const wideCatalogue = Array.from({ length: 140 }, (_, i) => ({
  id: `p${String(i + 1).padStart(3, '0')}`,
  sku: `SKU-${i + 1}`,
  name: `Style number ${i + 1}`,
  category: 'Tops',
  image: './placeholders/placeholder.svg',
  specs: {
    Colour: ['Black', 'White', 'Oatmeal', 'Sage', 'Clay'],
    Size: ['XS', 'S', 'M', 'L', 'XL'],
  },
  tag: '',
}))
setProducts(wideCatalogue)

/* A real creator does not pick every fifth row in a neat pattern; the colours
   and sizes vary line by line. This is deliberately not "all first option", so
   the packed integer is genuinely populated rather than collapsing to "_". */
const pickWide = (count) =>
  wideCatalogue.slice(0, count).map((product, i) => ({
    productId: product.id,
    qty: 1,
    specs: {
      Colour: product.specs.Colour[i % 5],
      Size: product.specs.Size[(i * 3) % 5],
    },
  }))

const fifty = generateCodeFromLines('luna', pickWide(50))
const seventy = generateCodeFromLines('luna', pickWide(70))
const fiftyDecoded = decodeCode(fifty.code)
console.log(`  50 styles: ${fifty.code.length} chars`)
console.log(`  70 styles: ${seventy.code.length} chars`)

check('50 styles decode', fiftyDecoded.ok, true)
check('50 styles are all there', fiftyDecoded.totalStyles, 50)
check('50 styles stay under 200 characters', fifty.code.length < 200, true)
check('70 styles stay under 240 characters', seventy.code.length < 240, true)
check('70 styles decode', decodeCode(seventy.code).totalStyles, 70)
check(
  'every 50-style option survives',
  fiftyDecoded.items.map((i) => i.specText),
  pickWide(50).map((line) => `${line.specs.Colour} / ${line.specs.Size}`),
)

/* Picking every fifth row is scattered, so ids encode as a bitmap; a plain run
   of five encodes as ranges. Both must round-trip. */
const scattered = wideCatalogue.filter((_, i) => i % 5 === 0).slice(0, 40)
const scatteredCode = generateCodeFromLines(
  'luna',
  scattered.map((p) => ({ productId: p.id, qty: 1, specs: { Colour: 'Black', Size: 'S' } })),
)
check('scattered picks are a bitmap', scatteredCode.code.split('.')[2].startsWith('b'), true)
check(
  'scattered picks decode to the same ids',
  decodeCode(scatteredCode.code).items.map((i) => i.id),
  scattered.map((p) => p.id),
)

const runCode = generateCodeFromLines(
  'luna',
  wideCatalogue.slice(0, 5).map((p) => ({ productId: p.id, qty: 1, specs: { Colour: 'Black', Size: 'S' } })),
)
check('a run of five ids is a range', runCode.code.split('.')[2].startsWith('r'), true)
check('the range decodes back', decodeCode(runCode.code).items.map((i) => i.id), wideCatalogue.slice(0, 5).map((p) => p.id))

/* Repeats keep their exact order, so they use the explicit sequence mode. */
const repeatCode = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 2, specs: { Colour: 'Black', Size: 'M' } },
  { productId: 'p001', qty: 1, specs: { Colour: 'White', Size: 'L' } },
])
check('a repeated id uses the sequence mode', repeatCode.code.split('.')[2].startsWith('s'), true)
check(
  'the two variants keep their order',
  decodeCode(repeatCode.code).items.map((i) => i.specText),
  ['Black / M', 'White / L'],
)

/* ── 20. the option lists move under an issued code ── */
console.log('\n[20] Option lists edited after the code was issued')
const issuedCode = generateCodeFromLines('luna', [
  { productId: 'p001', qty: 2, specs: { Colour: 'Oatmeal', Size: 'L' } },
]).code
check('nothing flagged while the catalogue is unchanged', decodeCode(issuedCode).optionsChanged, false)

setProducts(
  wideCatalogue.map((p) =>
    p.id === 'p001' ? { ...p, specs: { Colour: ['Black', 'White', 'Grey'], Size: ['S', 'M', 'L'] } } : p,
  ),
)
const changedResult = decodeCode(issuedCode)
check('a changed option list is flagged', changedResult.optionsChanged, true)
check('and it comes with a warning', changedResult.warnings.some((w) => /changed/.test(w)), true)

/* Shrinking the list can push the stored index out of range. The line must be
   reported without a colour rather than pointing at a wrong one. */
setProducts(
  wideCatalogue.map((p) => (p.id === 'p001' ? { ...p, specs: { Colour: ['Black'], Size: ['S'] } } : p)),
)
const shrunkResult = decodeCode(issuedCode)
check('an out-of-range index does not guess', shrunkResult.items[0].specs, {})
check('and the line is marked uncertain', shrunkResult.items[0].variantUncertain, true)
check('no ASIN is invented for it', shrunkResult.items[0].asin, '')

/* ── 21. one style deleted from a 50-style code ──
   This is the property the stored radix buys: line 24 disappearing must not
   shift lines 25-49, which is exactly what a per-product radix would do. */
console.log('\n[21] Deleting one style out of fifty')
setProducts(wideCatalogue)
const midCode = generateCodeFromLines('luna', pickWide(50)).code
setProducts(wideCatalogue.filter((p) => p.id !== 'p025'))
const midResult = decodeCode(midCode)
check('the code still decodes', midResult.ok, true)
check('exactly one line is reported missing', midResult.missing, ['p025'])
check('the line after it keeps its id', midResult.items[49].id, 'p050')
check(
  'and its options',
  midResult.items[49].specText,
  `${wideCatalogue[49].specs.Colour[49 % 5]} / ${wideCatalogue[49].specs.Size[(49 * 3) % 5]}`,
)
check('every other line still resolves', midResult.items.filter((i) => i.missing).length, 1)
check('the missing line keeps its product name slot', midResult.items[24].name, '已下架商品（p025）')
check('and its quantity', midResult.items[24].qty, 1)

setAsins({})
setProducts(original)

/* ── summary ── */
console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)

/* ───────────────── helpers ───────────────── */

/** Wrap a raw payload string in the current brand's base64url envelope */
function buildRaw(payload) {
  const b64 = Buffer.from(payload, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${CODE_PREFIX}-${b64}`
}
