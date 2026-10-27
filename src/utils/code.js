/**
 * Selection code — encode / decode
 * ══════════════════════════════════════════════════════════
 *
 * WHY THE CODE IS SELF-CONTAINED
 * The creator generates a code on her phone; ops pastes it into /#/admin on a
 * different machine. There is no server in between, so every piece of
 * information has to live inside the code itself. localStorage would not work
 * because it does not cross browsers.
 *
 * FORMAT   {brand}-{payload}   →   `sdm-7.luna…`
 *
 * BRAND PREFIX
 * ────────────
 * `{brand}` 不是装饰性的前缀，它回答的是"这份清单由哪个品牌生成"。
 * 两个品牌各有一份部署、各自的 Supabase 项目和各自的 catalogue，但 `p034`
 * 在两边都存在且指向不同的衣服 —— 一个跨品牌粘贴过来的码，不报错的话会
 * 解析出**看似合理但完全错误**的订单。所以前缀既是格式，也是品牌边界。
 *
 *   CODE_PREFIX          当前品牌，**只写这一个常量**换品牌
 *   LEGACY_CODE_PREFIXES 历史前缀，解码接受、编码不再使用
 *
 * 见下方常量定义与 decodeCode 里的前缀校验。
 *
 * v7 is PLAIN TEXT, not base64. Base64 costs a flat +33% and buys nothing: the
 * payload is already restricted to `0-9A-Za-z` plus four delimiters, all of
 * which survive chat apps, SMS and QR codes unchanged. Dropping the envelope is
 * the single biggest saving in this format — it is why 50 styles fit in ~150
 * characters instead of ~1000.
 *
 * PAYLOAD v7 — dot separated, 8 segments
 *   {ver}.{ref}.{ids}.{radix}.{specs}.{qty}.{ts}.{fp}
 *
 *   ver     "7"
 *   ref     creator handle, lowercase alphanumeric, max 12 chars
 *   ids     the selected products, as numbers (no "p", base62). Four modes,
 *           first character says which:
 *             r{W}{a,b-c,…}   ranges, ascending — consecutive ids collapse
 *             b{W}{max}-{bits} bitmap over 1..max, base62 of one big integer
 *             s{W}{a,b,…}      explicit sequence, ids may repeat (v5's job)
 *             t{W}{id,id,…}    literal ids, for anything not p<n>
 *           {W} is one base62 digit: the zero-padded width of the numeric part
 *           (0 = none). p001…p273 need W=3 or a deleted product would come back
 *           as "p1" instead of "p001". The encoder emits whichever of r/b is
 *           shorter — bitmap for scattered picks, ranges for runs.
 *   radix   one number: 1 + the largest option-combination count in this code.
 *           Stored, not derived, so a selection keeps decoding even after the
 *           option lists change.
 *   specs   every line's (colour, size) collapsed into ONE big integer, in
 *           mixed radix `radix`, written base62. A line's digit is its index in
 *           the product's own cartesian product; digit == combo count means
 *           "no options chosen". Because the radix is global, a product deleted
 *           or edited later cannot shift the other lines — they still decode.
 *           "_" means every line is digit 0.
 *   qty     "_" when every line is 1 unit; otherwise sparse "i:q" pairs in
 *           base62 — "0:a,3:2" is line 0 ×10 and line 3 ×2.
 *   ts      generation time, seconds since epoch, base62
 *   fp      4-char fingerprint of the option lists this code was built from.
 *           Decode compares it with the live catalogue: a mismatch means the
 *           colour/size lists changed, so the indexes may point at a different
 *           variant. Ops gets an explicit warning instead of a silent mislabel.
 *
 * NOTHING BUT IDS, OPTION INDEXES, QUANTITY AND TIME
 * Everything human-readable — name, 货号, ASIN — is looked up in the catalogue
 * at decode time. That keeps the code short and always current: rename a
 * product, fix a 货号 or remap an ASIN and every existing code reflects it
 * immediately, with no reissue. v7 goes one step further and stores option
 * *indexes* rather than the values, which is what removes the repeated
 * "Army%20Green|XXL" from every line.
 *
 * The cost of indexes: if ops edits a product's colour list after a code was
 * issued, that line's variant can no longer be resolved. The fingerprint above
 * turns that into a visible warning; the line is reported with its product name
 * and quantity, and the rest of the code is unaffected. A deleted product is
 * reported as 已下架商品（id） with its quantity — the option indexes cannot be
 * resolved without the product.
 *
 * WHY IDS INSTEAD OF POSITIONS
 * v1/v2 stored a bitmask of array positions. Reordering or deleting a product
 * silently changed what an old code meant. v3+ store the ids themselves, so the
 * catalogue can be reordered, extended or pruned without corrupting codes that
 * are already out in the wild.
 *
 * OLDER CODES (still decoded, never emitted)
 *   v1  no qty              decoded by position, `legacy: true`
 *   v2  qty, bitmask        decoded by position, `legacy: true`
 *   v3  ids + name snapshot base64, literal values
 *   v4  ids + options       base64, one variant per product
 *   v5  ids + options       base64, one entry per variant, ids may repeat
 *   v6  ids + dict + refs   base64, literal values stored once
 * A v4 spec group written as "Colour=Black,Size=M" (an early build) is still
 * understood — see parseSpecGroup.
 *
 * EXAMPLE
 *   7.luna.b062-1mezynpjw0ndcr1i6dg0rih2ah7ay73unz73mhs2unpc0.a.173ui….tnckek.g6x3
 *   (see npm run test:code for live output)
 *
 * LENGTH
 * 50 styles ≈ 150 characters, 70 ≈ 185. A short code (`sdm-XXXXXX`) would
 * need a server-side key/value store — see README.
 */

import { getProducts } from '../store/productStore.js'
import { getAsinFor } from './asinStore.js'
import { specPair } from './sku.js'
import { resolveProductImage } from './variantImage.js'
import { MAX_QTY, clampQty, sanitizeSpecs, isComplete } from './lines.js'

/**
 * BRAND PREFIX —— 换品牌只需要改这一处
 * ══════════════════════════════════════════════════════════════════
 *
 * 上线第二个品牌（B 品牌）时，把这个常量改成它的简称（例如 `'ngb'`），
 * 之后生成的**每一个**码都会自动变成 `ngb-7…`。UI 占位符、开发工具的
 * 示例、CLI 提示都从这里取值，所以不存在"改了编码器忘了改文案"的漏洞。
 *
 * 要求：小写字母 / 数字，不带分隔符（`-` 由编码器补上）。
 *
 * 当前品牌 B（Saodimallsu）→ `sdm`。
 */
export const CODE_PREFIX = 'sdm'

/**
 * 历史前缀 —— 已经发出去的码必须继续能用
 * ══════════════════════════════════════════════════════════════════
 *
 * 品牌改名之前红人手里那些码不会因为后台换前缀就作废：`decodeCode` 一律
 * 接受这里列出的前缀。**编码只用 `CODE_PREFIX`** —— 老前缀只进不出，
 * 否则新码会同时有两副面孔，运营没法一眼看出是哪一批。
 */
export const LEGACY_CODE_PREFIXES = ['zby']

/** 本系统接受（解码时）的全部前缀：当前品牌在前，历史在后。 */
export const ACCEPTED_CODE_PREFIXES = [CODE_PREFIX, ...LEGACY_CODE_PREFIXES]

const VERSION_COMPACT = '7'

/** Digits used by v7. Order matters only for uniqueness, not for sorting. */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Max units per style — one base36 digit. Lives in lines.js, re-exported here
 *  because every caller already imports it from this module. */
export { MAX_QTY }

/** Shown when a code references a product that has since been deleted */
const MISSING_IMAGE = './placeholders/placeholder.svg'

/* ───────────────── primitives ───────────────── */

/* base64url lives on for DECODING v1–v6 only. v7 never encodes with it — the
 * envelope cost 33% and bought nothing, see the header. */
/** URL-safe base64 → string */
function fromBase64Url(b64) {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/* v1–v6 read their quantities and timestamps in base36 — see readQty and the
 * parseInt(…, 36) calls in the legacy decoders. Nothing writes base36 now. */

/* ── base62 ──────────────────────────────────────────────────────────────
 * BigInt in, BigInt out. `toString(radix)` tops out at 36, and v7 routinely
 * needs to print a 300-bit integer, so the conversion is done by hand.
 * 62 = 5.954 bits per character — 15% denser than base36, 0 penalty versus
 * base64 because nothing here needs a byte representation.
 */

/** BigInt|number → base62 ("0" for zero, never empty) */
function b62(value) {
  let n = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.floor(Number(value) || 0)))
  if (n < 0n) n = 0n
  if (n === 0n) return '0'
  let out = ''
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out
    n /= 62n
  }
  return out
}

/** base62 → BigInt, or null when the string contains anything else */
function from62(str) {
  if (!str) return null
  let n = 0n
  for (const ch of String(str)) {
    const digit = B62.indexOf(ch)
    if (digit < 0) return null
    n = n * 62n + BigInt(digit)
  }
  return n
}


/**
 * Escape a value so it can sit inside a segment without being read as a
 * delimiter. encodeURIComponent already handles %, comma and equals — only
 * "." and "~" need extra work because it leaves them alone.
 */
function esc(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/\./g, '%2E')
    .replace(/~/g, '%7E')
}

/** Reverse of esc(). Malformed sequences are shown raw rather than throwing. */
function unesc(value) {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return String(value)
  }
}

/** Creator handle → safe slug */
export function slugifyRef(ref) {
  const clean = String(ref || 'guest')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
  return clean || 'guest'
}

/** "Black / M" — what ops actually reads */
function specTextOf(specs) {
  const values = Object.values(specs || {}).filter(Boolean)
  return values.length ? values.join(' / ') : '—'
}

/**
 * ASINs are resolved from the catalogue at decode time — see asinStore.js.
 * The code itself never carries one.
 */

/* ───────────────── encode ───────────────── */

/**
 * Build a selection code from lines — the real entry point.
 *
 * A line is one variant combination: `{ productId, qty, specs }`. The same
 * product may appear on several lines (Black/M and White/L), which is what v5
 * exists for. Lines are emitted in catalogue order so the same selection always
 * produces the same code; repeats of one product keep their pick order.
 *
 * @param {string} ref    creator handle (from ?ref=)
 * @param {Array}  lines  [{ productId, qty, specs }]
 * @returns {{ code: string, payload: Object }}
 */
export function generateCodeFromLines(ref, lines = []) {
  const products = getProducts()
  const byId = new Map(products.map((product) => [product.id, product]))
  const catalogueOrder = new Map(products.map((product, index) => [product.id, index]))
  const timestampSec = Math.floor(Date.now() / 1000)

  /* 1. normalise — clamp, drop empty, and re-validate the options against the
   *    live catalogue. A colour deleted while the tab was open must not travel
   *    into the code. */
  const prepared = []
  for (const line of Array.isArray(lines) ? lines : []) {
    const qty = clampQty(line?.qty)
    if (!qty) continue

    const id = String(line.productId ?? '')
    if (!id) continue

    const product = byId.get(id)
    const specs = product ? sanitizeSpecs(product, line.specs) : { ...(line.specs || {}) }

    /* A line whose colour was deleted from the catalogue sanitises down to
     * "Size only" — a *different* variant, not the one the creator picked.
     * Dropping it is the honest outcome; encoding the remainder would order
     * something nobody chose.
     *
     * Only when options were actually given, though: a one-size product, or a
     * caller that passes no specs at all, legitimately encodes an empty spec
     * group. Lines for products that are gone entirely cannot be validated, so
     * they travel as-is and decode as "removed product". */
    const hadOptions = Object.values(line.specs || {}).some(Boolean)
    if (product && hadOptions && !isComplete(product, specs)) continue

    prepared.push({ id, qty, specs, product })
  }

  /* 2. catalogue order, then pick order for repeats. Products that no longer
   *    exist are appended rather than dropped — the creator did pick them. */
  const ordered = prepared
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const rankA = catalogueOrder.has(a.line.id) ? catalogueOrder.get(a.line.id) : Number.MAX_SAFE_INTEGER
      const rankB = catalogueOrder.has(b.line.id) ? catalogueOrder.get(b.line.id) : Number.MAX_SAFE_INTEGER
      return rankA === rankB ? a.index - b.index : rankA - rankB
    })
    .map((entry) => entry.line)

  /* 3. line order. `r`/`b` modes carry numbers in ascending order, so the
   *    specs and quantities are laid out in that same order — otherwise the
   *    digits would not line up with the ids they belong to. Repeats (one
   *    product in two colourways) keep pick order and fall back to `s`. */
  const numeric = ordered.every((line) => /^p\d+$/.test(line.id))
  const unique = new Set(ordered.map((line) => line.id)).size === ordered.length
  const sequence =
    numeric && unique
      ? [...ordered].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
      : ordered

  const refSlug = slugifyRef(ref)
  const idSegment = encodeIdSegment(sequence)

  /* 4. options → one integer. Every line contributes one digit: its index in
   *    the product's own cartesian product (colour × size). The digits are
   *    packed in a single global radix so the decoder never needs to know a
   *    product's layout to find where the next line starts — that is what keeps
   *    the rest of the code readable when one product is deleted or edited. */
  const coords = sequence.map((line) => comboDigitOf(line))
  const radix = coords.reduce((max, coord) => Math.max(max, coord.count + 1), 1)
  let packed = 0n
  for (const coord of coords) packed = packed * BigInt(radix) + BigInt(coord.digit)
  const specSegment = packed === 0n ? '_' : b62(packed)

  /* 5. quantities — one "line:qty" pair per line that is not 1 unit */
  const sparseQty = sequence
    .map((line, index) => (line.qty === 1 ? '' : `${b62(index)}:${b62(line.qty)}`))
    .filter(Boolean)
  const qtySegment = sparseQty.length ? sparseQty.join(',') : '_'

  const tsSegment = b62(timestampSec)
  const fpSegment = fingerprintOf(sequence)

  return {
    /* 前缀恒为 CODE_PREFIX：发出的码永远带**当前**品牌名。 */
    code: `${CODE_PREFIX}-${[VERSION_COMPACT, refSlug, idSegment, b62(radix), specSegment, qtySegment, tsSegment, fpSegment].join('.')}`,
    payload: {
      version: Number(VERSION_COMPACT),
      ref: refSlug,
      items: sequence.map((line) => ({
        id: line.id,
        name: line.product?.name || line.id,
        qty: line.qty,
        specs: line.specs,
      })),
      ts: timestampSec * 1000,
    },
  }
}

/* ── v7 building blocks ── */

/** Declared option list for one spec type; always an array */
function listOf(product, type) {
  const raw = product?.specs?.[type]
  if (raw === undefined || raw === null) return []
  return Array.isArray(raw) ? raw : [raw]
}

/** How many variant combinations the product declares (min 1) */
function comboCountOf(product) {
  const axes = Object.keys(product?.specs || {})
  if (!axes.length) return 1
  return axes.reduce((total, type) => total * Math.max(1, listOf(product, type).length), 1)
}

/**
 * One line → one digit.
 *
 * `digit === count` is the "no options chosen" sentinel: a product that does
 * have colour/size axes but a line without values must not come back as "first
 * colour, first size". The sentinel is why the radix is `max(count) + 1`.
 */
function comboDigitOf(line) {
  const product = line.product
  if (!product) return { digit: 0, count: 1 }

  const axes = Object.keys(product.specs || {})
  const count = comboCountOf(product)
  if (!axes.length) return { digit: 0, count }

  const hasAny = axes.some((type) => String(line.specs?.[type] ?? '') !== '')
  if (!hasAny) return { digit: count, count }

  let digit = 0
  for (const type of axes) {
    const options = listOf(product, type)
    const index = options.indexOf(String(line.specs[type] ?? ''))
    /* sanitizeSpecs already dropped anything the product no longer offers, so
     * this is only reachable for a hand-built line. Encoding the sentinel
     * loses the option instead of shifting every following line. */
    if (index < 0) return { digit: count, count }
    digit = digit * Math.max(1, options.length) + index
  }
  return { digit, count }
}

/** Ascending unique numbers → "a", "a-b,c" tokens */
function rangeTokens(sorted) {
  const tokens = []
  for (let i = 0; i < sorted.length; ) {
    let end = i
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    tokens.push(i === end ? b62(sorted[i]) : `${b62(sorted[i])}-${b62(sorted[end])}`)
    i = end + 1
  }
  return tokens
}

/**
 * Ids → the shortest of the four modes. Ranges win on runs, the bitmap wins on
 * scattered picks — a 50-of-285 selection is ~50 characters as a bitmap and
 * ~140 as ranges, which is why both exist instead of picking one.
 */
function encodeIdSegment(lines) {
  const ids = lines.map((line) => line.id)
  if (!ids.length) return '_'

  if (!ids.every((id) => /^p\d+$/.test(id))) return `t0${ids.map(esc).join(',')}`

  const numbers = ids.map((id) => Number(id.slice(1)))
  /* Zero padding is part of the id: p001 must come back as p001, not p1. */
  const widths = new Set(ids.map((id) => id.length - 1))
  const width = widths.size === 1 ? [...widths][0] : 0

  if (new Set(numbers).size !== numbers.length) {
    return `s${b62(width)}${numbers.map((n) => b62(n)).join(',')}`
  }

  const sorted = [...numbers].sort((a, b) => a - b)
  const ranges = `r${b62(width)}${rangeTokens(sorted).join(',')}`

  const max = sorted[sorted.length - 1]
  /* BigInt bit n === "id p<n> is selected". Built with a shift per id rather
   * than through a byte array: the byte route needs a fixed endianness on both
   * sides, and getting that wrong silently drops ids. */
  let bits = 0n
  for (const n of sorted) if (n > 0) bits |= 1n << BigInt(n)
  const bitmap = `b${b62(width)}${b62(max)}-${b62(bits)}`

  return bitmap.length < ranges.length ? bitmap : ranges
}

/**
 * Fingerprint of the option lists this code was built from.
 *
 * FNV-1a over `id + type + options` for every selected product. Decoding
 * recomputes it: a mismatch means someone edited a colour/size list after the
 * code was issued, so the indexes in `specs` may resolve to a different
 * variant. Ops needs to be told that explicitly — a silently wrong colour is
 * exactly the kind of mistake this whole format has to avoid.
 */
function fingerprintOf(lines) {
  let hash = 2166136261
  const feed = (text) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
  }

  for (const line of lines) {
    const product = line.product
    if (!product) {
      feed(`?${line.id};`)
      continue
    }
    feed(`${line.id}`)
    for (const type of Object.keys(product.specs || {})) {
      feed(`|${type}=${listOf(product, type).join('\u001f')}`)
    }
    feed(';')
  }

  const text = b62(BigInt(hash >>> 0))
  return text.length >= 4 ? text.slice(-4) : text.padStart(4, '0')
}

/**
 * Legacy entry point — `{ [productId]: qty }` plus `{ [productId]: specs }`.
 * Kept because the Node suites and any external caller use it; the app itself
 * goes through generateCodeFromLines. One variant per product by definition.
 *
 * @param {string} ref
 * @param {Object} selection  { [productId]: qty }
 * @param {Object} specs      { [productId]: { Colour: 'Oatmeal', Size: 'M' } }
 * @returns {{ code: string, payload: Object }}
 */
export function generateCode(ref, selection = {}, specs = {}) {
  const products = getProducts()
  const byId = new Map(products.map((product) => [product.id, product]))

  const ids = []
  for (const product of products) {
    if ((Number(selection[product.id]) || 0) > 0) ids.push(product.id)
  }
  for (const id of Object.keys(selection)) {
    if (!byId.has(id) && (Number(selection[id]) || 0) > 0) ids.push(id)
  }

  return generateCodeFromLines(
    ref,
    ids.map((id) => ({
      productId: id,
      qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(selection[id]) || 1))),
      specs: specs[id] || {},
    })),
  )
}

/* ───────────────── brand prefix ───────────────── */

/**
 * 这段代码的前缀是不是本系统接受的？（当前品牌或历史品牌之一）
 *
 * 返回**匹配到的那个前置串本身**而不是布尔值：不同前缀长度不同，调用方
 * 要按顺序切掉它才能取到 payload（`zby-` 和 `sdm-` 差 2 个字符）。
 *
 * @param {string} trimmed
 * @returns {string|null} 例如 `'sdm'` / `'zby'`，未匹配返回 null
 */
export function matchAcceptedPrefix(trimmed) {
  for (const prefix of ACCEPTED_CODE_PREFIXES) {
    const head = trimmed.slice(0, prefix.length + 1).toUpperCase()
    /* 长度恒定，所以这里用相等而非 startsWith —— 语义上一样，但不给
     * "前缀后面还跟着东西"留下误会空间。 */
    if (head === `${prefix.toUpperCase()}-`) return prefix
  }
  return null
}

/**
 * 它看起来像**别人家的码**吗？
 *
 * 判断依据：开头是一个短的名字（字母开头，最多 16 位字母数字）紧跟一个
 * 连字符 —— 也就是选款码的形状，只是前缀不属于本品牌。
 *
 * 用它把两种失败分开：
 *   `ngb-7.x…`（另一个品牌）→ "Invalid brand prefix"，意思是"粘错地方了"
 *   `hello …`（没前缀）    → 提示正确格式
 *
 * @param {string} trimmed
 * @returns {boolean}
 */
export function looksForeignPrefix(trimmed) {
  const match = /^([A-Za-z][A-Za-z0-9]{0,15})-/.exec(trimmed)
  if (!match) return false
  /* 已经在本品牌的接受列表里的话不是"外来的" —— 那种情况会先被
   * matchAcceptedPrefix 接住，走到这里说明前缀确实不认识。 */
  return !matchAcceptedPrefix(trimmed)
}

/* ───────────────── decode ───────────────── */

/**
 * Decode a selection code into a plain, serialisable object.
 * This is the function to call from your own code / backend / scripts.
 *
 * @param {string} code
 * @returns {{
 *   ok: true,
 *   version: number,
 *   legacy: boolean,
 *   ref: string,
 *   createdAt: string,
 *   createdAtMs: number,
 *   totalStyles: number,
 *   distinctProducts: number,
 *   totalUnits: number,
 *   missing: string[],
 *   optionsChanged: boolean,
 *   warnings: string[],
 *   items: Array<{
 *     index: number, catalogueIndex: number, id: string, sku: string,
 *     asin: string, name: string, category: string, image: string,
 *     qty: number, specs: Object, specText: string,
 *     found: boolean, missing: boolean
 *   }>
 * } | { ok: false, error: string }}
 */
export function decodeCode(code) {
  const fail = (error) => ({ ok: false, error })

  if (!code || typeof code !== 'string') return fail('Empty code')
  const trimmed = code.trim()

  /* ── 品牌边界 ──
     前缀不是可选项：把 B 品牌的码粘进本品牌的后台，必须在这里被拦下。
     强行"就近解析"的产物是一份看起来完全正常的订单 —— 名字、货号、
     颜色都在，只是属于另一个品牌的另一件衣服。所以宁可报错。

     大小写不敏感（两侧都 upper-case 后比较）：红人粘贴时可能被聊天软件
     改了大小写，而过去的教训正是"比对了 upper 的码和 lower 的前缀，
     结果每一条合法码都被拒"（当时前缀是全大写的 MAKO，改名后才暴露）。
     下面的 slice 用的仍是原始 `trimmed`，所以 body 不受影响。 */
  const prefix = matchAcceptedPrefix(trimmed)
  if (!prefix) {
    /* 带着别家前缀 vs 压根没有前缀，是两种错误，措辞也该不同：
       前者要让人立刻明白"粘错地方了"，后者只需要给出正确格式。 */
    return fail(
      looksForeignPrefix(trimmed)
        ? 'Invalid brand prefix'
        : `Code must start with "${CODE_PREFIX}-"`,
    )
  }

  const body = trimmed.slice(prefix.length + 1)

  /* v7 is plain text; v1–v6 are base64url. A base64url body can never contain
   * a dot, so one look decides which envelope this is. */
  let raw
  if (body.includes('.')) {
    raw = body
  } else {
    try {
      raw = fromBase64Url(body)
    } catch {
      return fail('Code is not valid base64 — it may have been truncated')
    }
  }

  const parts = raw.split('.')
  const version = parts[0]

  if (version === VERSION_COMPACT) return decodeCompact(parts)
  if (version === '6') return decodeDictionary(parts)
  if (version === '5') return decodeIdBased(parts, { version: 5, hasNames: false })
  if (version === '4') return decodeIdBased(parts, { version: 4, hasNames: false })
  if (version === '3') return decodeIdBased(parts, { version: 3, hasNames: true })
  if (version === '1' || version === '2') return decodeLegacy(version, parts)
  return fail(`Unknown code version "${version}"`)
}

/* ── v7: packed option indexes, base62, no envelope ──
   Layout: 7.{ref}.{ids}.{radix}.{specs}.{qty}.{ts}.{fp}

   Everything here is defensive about *other* lines: a deleted product, or one
   whose option list was edited after the code was issued, costs that line only
   — the packed integer is read in a global radix, so line N+1 still decodes.
   That property is why the radix is stored instead of being recomputed. */

/** Ids → array of "p…" strings, or null when the segment is malformed */
function decodeIdSegment(segment) {
  if (!segment || segment === '_') return null

  const mode = segment[0]
  const width = from62(segment.charAt(1))
  if (width === null) return null
  const body = segment.slice(2)
  const pad = (n) => `p${width > 0n ? String(n).padStart(Number(width), '0') : n}`

  const LIMIT = 5000
  const ids = []

  if (mode === 'r') {
    for (const token of body.split(',')) {
      if (!token) continue
      const dash = token.indexOf('-')
      if (dash < 0) {
        const n = from62(token)
        if (n === null || n <= 0n) return null
        ids.push(pad(n))
        continue
      }
      const from = from62(token.slice(0, dash))
      const to = from62(token.slice(dash + 1))
      if (from === null || to === null || to < from || from <= 0n) return null
      if (to - from > BigInt(LIMIT)) return null
      for (let n = from; n <= to; n++) ids.push(pad(n))
    }
    return ids.length && ids.length <= LIMIT ? ids : null
  }

  if (mode === 'b') {
    const dash = body.indexOf('-')
    if (dash < 0) return null
    const max = from62(body.slice(0, dash))
    const bits = from62(body.slice(dash + 1))
    if (max === null || bits === null || max <= 0n || max > BigInt(LIMIT)) return null
    for (let n = 1n; n <= max; n++) {
      if ((bits >> n) & 1n) ids.push(pad(n))
    }
    return ids.length && ids.length <= LIMIT ? ids : null
  }

  if (mode === 's') {
    for (const token of body.split(',')) {
      const n = from62(token)
      if (n === null || n <= 0n) return null
      ids.push(pad(n))
    }
    return ids.length && ids.length <= LIMIT ? ids : null
  }

  if (mode === 't') {
    for (const token of body.split(',')) {
      const id = unesc(token)
      if (id) ids.push(id)
    }
    return ids.length && ids.length <= LIMIT ? ids : null
  }

  return null
}

/** Sparse "i:q" pairs → one quantity per line, or null when malformed */
function decodeQtySegment(segment, count) {
  const quantities = new Array(count).fill(1)
  if (!segment || segment === '_') return quantities

  for (const pair of segment.split(',')) {
    if (!pair) continue
    const colon = pair.indexOf(':')
    if (colon <= 0) return null
    const index = from62(pair.slice(0, colon))
    const qty = from62(pair.slice(colon + 1))
    if (index === null || qty === null || qty < 1n) return null
    if (index >= BigInt(count)) return null
    quantities[Number(index)] = Math.min(MAX_QTY, Number(qty))
  }
  return quantities
}

/** Digit → { Colour, Size } for one product; null when the digit is out of range */
function specsFromDigit(product, digit) {
  const axes = Object.keys(product.specs || {})
  if (!axes.length) return {}

  const lengths = axes.map((type) => Math.max(1, listOf(product, type).length))
  const picked = new Array(axes.length)
  let rest = digit
  for (let i = axes.length - 1; i >= 0; i--) {
    picked[i] = rest % lengths[i]
    rest = Math.floor(rest / lengths[i])
  }
  if (rest !== 0) return null

  const specs = {}
  axes.forEach((type, i) => {
    const options = listOf(product, type)
    if (options[picked[i]] !== undefined) specs[type] = options[picked[i]]
  })
  return specs
}

function decodeCompact(parts) {
  const fail = (error) => ({ ok: false, error })
  if (parts.length !== 8) return fail('Malformed v7 code')
  /* The fingerprint is always exactly 4 characters, so a code with a chewed-off
   * tail is rejected here instead of decoding to a plausible-looking order. */
  if (!/^[0-9A-Za-z]{4}$/.test(parts[7])) return fail('Code looks truncated — check the last characters')

  const ref = parts[1]
  const ids = decodeIdSegment(parts[2])
  if (!ids || !ids.length) return fail('This code contains no selected items')

  const radix = from62(parts[3])
  if (radix === null || radix < 1n || radix > 10000000n) return fail('Malformed v7 radix')
  const base = Number(radix)

  let packed = parts[4] === '_' ? 0n : from62(parts[4])
  if (packed === null) return fail('Code is not valid base62 — it may have been truncated')

  const digits = new Array(ids.length).fill(0)
  for (let i = ids.length - 1; i >= 0; i--) {
    digits[i] = Number(packed % radix)
    packed /= radix
  }
  if (packed !== 0n) return fail('Malformed v7 payload')

  const quantities = decodeQtySegment(parts[5], ids.length)
  if (!quantities) return fail('Malformed v7 quantities')

  const products = getProducts()
  const lookup = new Map(products.map((product, index) => [product.id, { product, index }]))
  /* Belt to the padding brace: an id stored without its width (mixed widths,
   * or a v7 code edited by hand) still finds its product by number. */
  const byNumber = new Map()
  for (const product of products) {
    const match = /^p(\d+)$/.exec(product.id)
    if (match) byNumber.set(Number(match[1]), product.id)
  }

  const items = []
  const missing = []
  const uncertain = []

  ids.forEach((rawId, order) => {
    const direct = lookup.get(rawId)
    const match = /^p(\d+)$/.exec(rawId)
    const fallback = direct ? null : byNumber.get(Number(match?.[1]))
    const hit = direct || (fallback ? lookup.get(fallback) : null)
    const id = hit ? hit.product.id : rawId
    const qty = quantities[order]
    const digit = digits[order]

    if (!hit) {
      missing.push(id)
      items.push({
        index: order,
        catalogueIndex: -1,
        id,
        sku: '',
        asin: '',
        name: `已下架商品（${id}）`,
        category: '',
        image: MISSING_IMAGE,
        qty,
        specs: {},
        specText: specTextOf({}),
        hidden: false,
        found: false,
        missing: true,
      })
      return
    }

    const count = comboCountOf(hit.product)
    let specs = {}
    let variantLost = false
    if (digit < count) {
      specs = specsFromDigit(hit.product, digit) || {}
      if (!Object.keys(specs).length && Object.keys(hit.product.specs || {}).length) variantLost = true
    } else if (digit > count) {
      /* The option list shrank after this code was issued: the index no longer
       * points anywhere. Report the line without guessing a colour. */
      variantLost = true
    }
    if (variantLost) uncertain.push(id)

    const sku = hit.product.sku || ''
    const { colour, size } = specPair(specs)
    items.push({
      index: order,
      catalogueIndex: hit.index,
      id,
      sku,
      asin: variantLost ? '' : getAsinFor(sku, colour, size),
      name: hit.product.name,
      category: hit.product.category,
      image: resolveProductImage(hit.product, specs),
      qty,
      specs,
      specText: specTextOf(specs),
      hidden: Boolean(hit.product.hidden),
      found: true,
      missing: false,
      variantUncertain: variantLost,
    })
  })

  /* The fingerprint can only be checked when every product is still here: a
   * deleted product contributes to it at encode time and cannot at decode
   * time, which would raise a false "options changed". */
  const fpComparable = missing.length === 0
  const fpMatches = !fpComparable || fingerprintOf(items.map((item) => ({ id: item.id, product: lookup.get(item.id)?.product }))) === parts[7]
  const optionsChanged = fpComparable ? !fpMatches : uncertain.length > 0

  const warnings = []
  if (missing.length) {
    warnings.push(
      `${missing.length} of ${ids.length} item(s) are no longer in the catalogue: ${missing.join(', ')}. ` +
        'Their quantity is kept; the colour and size cannot be recovered from a v7 code.',
    )
  }
  if (optionsChanged) {
    warnings.push(
      `The colour/size list of ${uncertain.length || ids.length} style(s) changed after this code was generated. ` +
        'Check the variant on those lines before ordering — the code stores option positions, not names.',
    )
  }

  return buildResult({
    version: 7,
    legacy: false,
    ref: ref || 'guest',
    tsMs: (Number(from62(parts[6]) || 0n) || 0) * 1000,
    items,
    missing,
    warnings,
    optionsChanged,
  })
}

/* ── v3 / v4 / v5: ids, literal options, tolerant of deleted products ──
   v3 carried a name snapshot as a 6th segment; v4 and v5 dropped it.
   v5 differs from v4 in one way only: `ids` may repeat, one entry per variant
   of the same product. The layout is identical, so one parser covers both.
   Two identical lines in one code are kept as two lines rather than merged —
   that only happens in a hand-built code, and summing quantities there would
   silently invent a number nobody typed. */

function decodeIdBased(parts, { version, hasNames }) {
  const fail = (error) => ({ ok: false, error })
  if (parts.length !== (hasNames ? 7 : 6)) return fail(`Malformed v${version} code`)

  const ref = parts[1]
  const idSegment = parts[2]
  const specSegment = parts[3]
  const qtySegment = parts[4]
  const nameSegment = hasNames ? parts[5] : ''
  const tsB36 = hasNames ? parts[6] : parts[5]

  const ids = idSegment && idSegment !== '_' ? idSegment.split('~').map(unesc) : []
  if (!ids.length) return fail('This code contains no selected items')

  const specGroups = specSegment && specSegment !== '_' ? specSegment.split('~') : []
  const nameGroups = nameSegment && nameSegment !== '_' ? nameSegment.split('~') : []

  const products = getProducts()
  const lookup = new Map(products.map((product, index) => [product.id, { product, index }]))

  const items = []
  const missing = []

  ids.forEach((id, order) => {
    const hit = lookup.get(id)
    const qty = readQty(qtySegment, order)
    const specs = parseSpecGroup(specGroups[order], hit?.product)
    const nameSnapshot = unesc(nameGroups[order] || '')

    if (hit) {
      const sku = hit.product.sku || ''
      const { colour, size } = specPair(specs)
      items.push({
        index: order,
        catalogueIndex: hit.index,
        id,
        sku,
        asin: getAsinFor(sku, colour, size),
        name: hit.product.name,
        category: hit.product.category,
        // The photo for the colour that was actually picked, so ops can eyeball
        // the line without opening the catalogue
        image: resolveProductImage(hit.product, specs),
        qty,
        specs,
        specText: specTextOf(specs),
        // Still a valid line — the product just isn't on the storefront right
        // now. Ops sees a muted badge rather than an error.
        hidden: Boolean(hit.product.hidden),
        found: true,
        missing: false,
      })
      return
    }

    // Deleted product — report it by id, keep the options and quantity
    missing.push(id)
    items.push({
      index: order,
      catalogueIndex: -1,
      id,
      sku: '',
      asin: '',
      name: nameSnapshot
        ? `已下架商品（${id}）· ${nameSnapshot}`
        : `已下架商品（${id}）`,
      category: '',
      image: MISSING_IMAGE,
      qty,
      specs,
      specText: specTextOf(specs),
      hidden: false,
      found: false,
      missing: true,
    })
  })

  const warnings = []
  if (missing.length) {
    warnings.push(
      `${missing.length} of ${ids.length} item(s) are no longer in the catalogue: ${missing.join(', ')}. ` +
        'They are still counted — the colour and size come from the code itself.',
    )
  }

  return buildResult({
    version,
    legacy: false,
    ref: ref || 'guest',
    tsMs: (parseInt(tsB36, 36) || 0) * 1000,
    items,
    missing,
    warnings,
  })
}

/* ── v6: ids + per-code value dictionary + per-line indexes ──
   Layout: 6.{ref}.{ids}.{dict}.{refs}.{qty}.{ts}

   `dict` holds every distinct colour/size string once, `~`-joined. `refs`
   holds one group per line, each a "|"-joined list of base36 indexes into
   `dict`, aligned to the product's declared spec types. An empty slot is an
   empty string, so the position still says which type a value belongs to.
   Literal values live in the code, so a code issued before an option-list edit
   still decodes to the values it was made with. */

function decodeDictionary(parts) {
  const fail = (error) => ({ ok: false, error })
  if (parts.length !== 7) return fail('Malformed v6 code')

  const ref = parts[1]
  const idSegment = parts[2]
  const dictSegment = parts[3]
  const refSegment = parts[4]
  const qtySegment = parts[5]
  const tsB36 = parts[6]

  const ids = idSegment && idSegment !== '_' ? idSegment.split('~').map(unesc) : []
  if (!ids.length) return fail('This code contains no selected items')

  const dict = dictSegment && dictSegment !== '_' ? dictSegment.split('~').map(unesc) : []
  const refGroups = refSegment && refSegment !== '_' ? refSegment.split('~') : []

  const products = getProducts()
  const lookup = new Map(products.map((product, index) => [product.id, { product, index }]))

  const items = []
  const missing = []

  ids.forEach((id, order) => {
    const hit = lookup.get(id)
    const qty = readQty(qtySegment, order)
    const group = refGroups[order] === undefined ? '' : refGroups[order]
    const values = group.split('|').map((token) => {
      if (!token) return ''
      const index = parseInt(token, 36)
      return Number.isNaN(index) ? '' : dict[index] || ''
    })

    /* One slot per declared type, in the encoder's order. If the type list has
     * changed since the code was issued, label the values by position instead
     * of attaching them to the wrong type. */
    const specs = {}
    const types = hit ? Object.keys(hit.product.specs || {}) : []
    if (hit && types.length === values.length) {
      types.forEach((type, i) => {
        if (values[i]) specs[type] = values[i]
      })
    } else {
      values.forEach((value, i) => {
        if (value) specs[`Option ${i + 1}`] = value
      })
    }

    if (hit) {
      const sku = hit.product.sku || ''
      const { colour, size } = specPair(specs)
      items.push({
        index: order,
        catalogueIndex: hit.index,
        id,
        sku,
        asin: getAsinFor(sku, colour, size),
        name: hit.product.name,
        category: hit.product.category,
        image: resolveProductImage(hit.product, specs),
        qty,
        specs,
        specText: specTextOf(specs),
        hidden: Boolean(hit.product.hidden),
        found: true,
        missing: false,
      })
      return
    }

    missing.push(id)
    items.push({
      index: order,
      catalogueIndex: -1,
      id,
      sku: '',
      asin: '',
      name: `已下架商品（${id}）`,
      category: '',
      image: MISSING_IMAGE,
      qty,
      specs,
      specText: specTextOf(specs),
      hidden: false,
      found: false,
      missing: true,
    })
  })

  const warnings = []
  if (missing.length) {
    warnings.push(
      `${missing.length} of ${ids.length} item(s) are no longer in the catalogue: ${missing.join(', ')}. ` +
        'They are still counted — the colour and size come from the code itself.',
    )
  }

  return buildResult({
    version: 6,
    legacy: false,
    ref: ref || 'guest',
    tsMs: (parseInt(tsB36, 36) || 0) * 1000,
    items,
    missing,
    warnings,
  })
}

/* ── v1 / v2: bitmask of positions, best-effort resolution ── */

function decodeLegacy(version, parts) {
  const fail = (error) => ({ ok: false, error })
  const expected = version === '1' ? 5 : 6
  if (parts.length !== expected) return fail(`Malformed v${version} code`)

  const ref = parts[1] || 'guest'
  const mask = parseInt(parts[2], 36)
  if (Number.isNaN(mask)) return fail('Malformed item mask')

  const specStr = parts[3]
  const qtyStr = version === '2' ? parts[4] : '_'
  const tsB36 = version === '2' ? parts[5] : parts[4]

  // Division-based bit test: JS bitwise ops are 32-bit signed and would
  // overflow past 31 products.
  const bit = (i) => Math.floor(mask / Math.pow(2, i)) % 2 === 1

  const products = getProducts()
  const positions = []
  for (let i = 0; i < products.length; i++) {
    if (bit(i)) positions.push(i)
  }

  // Bits beyond the current catalogue length = products that used to exist.
  // They are reported rather than ignored, so a shrunk catalogue can never
  // silently misalign a legacy code.
  const orphanPositions = []
  const highestBit = mask > 0 ? Math.floor(Math.log2(mask)) : -1
  for (let i = products.length; i <= highestBit; i++) {
    if (bit(i)) orphanPositions.push(i)
  }

  const specGroups = specStr && specStr !== '_' ? specStr.split('-') : []

  const items = positions.map((index, order) => {
    const product = products[index]
    const chars = specGroups[order] || ''
    const specTypes = Object.keys(product.specs || {})

    // Legacy codes store option *indexes*, so they can only be resolved
    // against the option list as it is right now.
    const specs = {}
    specTypes.forEach((type, typePos) => {
      const ch = chars[typePos]
      if (!ch || ch === 'x') return
      const optionIndex = parseInt(ch, 36)
      const options = Array.isArray(product.specs[type])
        ? product.specs[type]
        : [product.specs[type]]
      if (!Number.isNaN(optionIndex) && options[optionIndex] !== undefined) {
        specs[type] = options[optionIndex]
      }
    })

    const sku = product.sku || ''
    const { colour, size } = specPair(specs)

    return {
      index: order,
      catalogueIndex: index,
      id: product.id,
      sku,
      asin: getAsinFor(sku, colour, size),
      name: product.name,
      category: product.category,
      image: resolveProductImage(product, specs),
      qty: readQty(qtyStr, order),
      specs,
      specText: specTextOf(specs),
      hidden: Boolean(product.hidden),
      found: true,
      missing: false,
    }
  })

  const orphanItems = orphanPositions.map((index, i) => ({
    index: positions.length + i,
    catalogueIndex: -1,
    id: `#${index}`,
    sku: '',
    asin: '',
    name: `Unknown product (was position ${index + 1})`,
    category: '',
    image: MISSING_IMAGE,
    qty: 1,
    specs: {},
    specText: '—',
    hidden: false,
    found: false,
    missing: true,
  }))

  const allItems = [...items, ...orphanItems]
  if (!allItems.length) return fail('This code contains no selected items')

  const missing = orphanItems.map((item) => item.id)
  const warnings = [
    `This is a v${version} code. It stores catalogue positions, not product ids, so ` +
      'items are matched by their current position — if the catalogue was reordered, ' +
      'the wrong products may be shown.',
  ]
  if (missing.length) {
    warnings.push(
      `${missing.length} position(s) no longer exist in the catalogue (${missing.join(', ')}). ` +
        'The catalogue has shrunk since this code was generated.',
    )
  }

  return buildResult({
    version: Number(version),
    legacy: true,
    ref,
    tsMs: (parseInt(tsB36, 36) || 0) * 1000,
    items: allItems,
    missing,
    warnings,
  })
}

/* ── shared ── */

/** One base36 quantity digit at `order`, clamped to 1..MAX_QTY */
function readQty(qtySegment, order) {
  if (!qtySegment || qtySegment === '_') return 1
  const parsed = parseInt(qtySegment[order] || '1', 36)
  if (Number.isNaN(parsed) || parsed <= 0) return 1
  return Math.min(MAX_QTY, parsed)
}

/**
 * One spec group → { Type: value }.
 *
 * v4 writes values only, "Black|M", aligned to the product's declared spec
 * types — that is what the encoder produces. Two fallbacks keep older codes
 * readable:
 *   · "Colour=Black,Size=M" — an early v4 build, or a v3 code
 *   · a value count that no longer matches the product's type list — the
 *     product's options were edited after the code was issued, so the values
 *     are shown in order rather than mislabelled.
 */
function parseSpecGroup(group, product) {
  const specs = {}
  if (!group) return specs

  if (group.includes('=')) {
    for (const pair of group.split(',')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const type = unesc(pair.slice(0, eq))
      const value = unesc(pair.slice(eq + 1))
      if (type && value) specs[type] = value
    }
    return specs
  }

  const types = product ? Object.keys(product.specs || {}) : []
  const values = group.split('|')

  if (types.length === values.length) {
    types.forEach((type, i) => {
      if (values[i]) specs[type] = unesc(values[i])
    })
    return specs
  }

  values.forEach((value, i) => {
    if (value) specs[`Option ${i + 1}`] = unesc(value)
  })
  return specs
}

function buildResult({ version, legacy, ref, tsMs, items, missing, warnings, optionsChanged = false }) {
  return {
    ok: true,
    version,
    legacy,
    ref,
    createdAtMs: tsMs,
    createdAt: tsMs ? new Date(tsMs).toISOString() : '',
    /* v7 stores option *positions*; this flag says the catalogue moved under
     * an already-issued code. Only v7 can raise it. */
    optionsChanged,
    /* Lines vs styles: a v5 code can carry one product twice (Black/M and
     * White/L), so `totalStyles` counts lines and `distinctProducts` counts
     * pieces. Ops needs both — "2 variants of 1 style" is a different order
     * from "2 styles". */
    totalStyles: items.length,
    distinctProducts: new Set(items.map((item) => item.id)).size,
    totalUnits: items.reduce((sum, item) => sum + item.qty, 0),
    missing,
    warnings,
    items,
  }
}

/* ───────────────── local history (convenience only) ───────────────── */

const RECORDS_KEY = 'mako_selection_records'

/** Keep a local record of generated codes — never used for decoding */
export function saveRecord(record) {
  try {
    const list = getStoredRecords()
    list.unshift(record)
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list.slice(0, 100)))
  } catch {
    /* storage full — non-critical */
  }
}

export function getStoredRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
