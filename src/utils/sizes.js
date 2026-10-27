/**
 * Size order
 * ══════════
 * One canonical order for sizes, used everywhere a size is *shown*.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `specs.Size` is whatever order the spreadsheet had. 70-odd of the 195 live
 * products store `["XXL","S","L","M","XL"]`, and `["2","12","14","6","4","8","10"]`
 * is not a typo either — the importer preserves column order, and the source
 * sheets were filled in by different people. Both the storefront sheet and the
 * admin stock grid rendered that array straight (plus one place that fell back
 * to `.sort()`, i.e. alphabetical: L, M, S, XL, XXL). Sizes are ordinal, so
 * every one of those orders is wrong in the same way: it makes a creator read
 * the row twice, and it makes a stock grid hard to scan.
 *
 * THREE RULES
 * ───────────
 *   1. Letter sizes follow `SIZE_ORDER`, smallest → largest. `2XL` is `XXL`,
 *      `XXXL` is `3XL`, `Small`/`Medium`/`Large` are `S`/`M`/`L`.
 *   2. Anything numeric sorts numerically (`2, 4, 6, 8, 10, 12, 14`, and kids'
 *      `120, 130, 140, 150, 160`) — never as text, where `10` comes before `2`.
 *   3. Anything unrecognised (`One Size`, `Petite`, an empty row being typed)
 *      stays after the recognised ones and keeps its original relative order.
 *      Sorting cannot invent a rank it does not know, and reordering unknowns
 *      alphabetically would be a second, silent opinion.
 *
 * WHY IT SORTS ON READ, NOT ON WRITE
 * ──────────────────────────────────
 * `specs` key order is load-bearing (see HANDOVER red line 2), and the option
 * array is what a *legacy v1/v2 selection code* resolves against — those codes
 * store option indexes, not values (utils/code.js, `decodeLegacy`). Rewriting
 * the stored array to canonical order would silently re-point every v1/v2 code
 * ever issued. So this is a render-time function and nothing here writes:
 * `specs.Size` keeps its import order forever, and every surface sorts a copy.
 * v3/v4/v5 codes are unaffected either way — they carry literal values.
 *
 * Nothing in this module mutates its input. `sortSizes` returns the SAME array
 * reference when it is already in order, so a memoised caller and a React
 * re-render both stay cheap.
 *
 * Pure functions only — imported by the Node suites and by utils/soldOut.js.
 */

/**
 * The ladder. Index is the rank, so inserting a size is a one-line change and
 * every comparison follows automatically.
 */
export const SIZE_ORDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL']

const RANK = new Map(SIZE_ORDER.map((size, index) => [size, index]))

/**
 * Spellings that mean one of the ladder entries. A product that says "Small"
 * and a product that says "S" are the same size, and a mixed group
 * (`["Small","M","Large"]`) has to interleave correctly rather than end up
 * half-sorted with the long words parked at the end.
 */
const ALIASES = new Map([
  ['XXXS', 'XXXS'],
  ['3XS', 'XXXS'],
  ['XXS', 'XXS'],
  ['2XS', 'XXS'],
  ['XS', 'XS'],
  ['EXTRASMALL', 'XS'],
  ['S', 'S'],
  ['SMALL', 'S'],
  ['M', 'M'],
  ['MEDIUM', 'M'],
  ['L', 'L'],
  ['LARGE', 'L'],
  ['XL', 'XL'],
  ['XXL', 'XXL'],
  ['2XL', 'XXL'],
  ['XXXL', '3XL'],
  ['3XL', '3XL'],
  ['XXXXL', '4XL'],
  ['4XL', '4XL'],
  ['5XL', '5XL'],
  ['6XL', '6XL'],
])

/* Numeric sizes, plus the forms the sheets actually use: `6`, `2.5`, `18M`
 * (months), `2T` (toddler). The unit suffix is only there to be ignored —
 * within one product the unit never varies, so the number alone orders them. */
const NUMERIC = /^(\d+(?:[.,]\d+)?)[A-Z]{0,3}$/

const UNKNOWN = 2
const LETTERS = 0
const NUMBERS = 1

/**
 * Rank for a letter size, or `null` when the token is not one.
 * Handles any run of X (`XXXS`, `XXXXL`) so a new size does not need a new
 * alias — the arithmetic stays correct past the end of the ladder.
 */
function letterRank(token) {
  const alias = ALIASES.get(token)
  if (alias !== undefined) return RANK.get(alias)

  /* 2XL / 3XL / 2XS — the digit form */
  const digit = /^(\d+)X(S|L)$/.exec(token)
  if (digit) {
    const n = Number(digit[1])
    return digit[2] === 'L' ? RANK.get('L') + n : RANK.get('S') - n
  }

  /* S / XS / XXS / XXXS, and L / XL / XXL / XXXL */
  const run = /^(X*)(S|M|L)$/.exec(token)
  if (run) {
    const count = run[1].length
    if (run[2] === 'S') return RANK.get('S') - count
    if (run[2] === 'L') return count ? RANK.get('L') + count : RANK.get('L')
    return RANK.get('M')
  }

  return null
}

/**
 * `{ bucket, rank }` for one value. Buckets keep letters and numbers from
 * claiming the same rank: letters first, then numbers, then everything else.
 */
function rankOf(value) {
  const token = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

  if (!token) return { bucket: UNKNOWN, rank: 0 }

  const letter = letterRank(token)
  if (letter !== null) return { bucket: LETTERS, rank: letter }

  const numeric = NUMERIC.exec(token)
  if (numeric) return { bucket: NUMBERS, rank: Number(numeric[1].replace(',', '.')) }

  return { bucket: UNKNOWN, rank: 0 }
}

/**
 * Ascending comparison of two size values. Unknown values compare equal, so a
 * caller sorting an array keeps them in their original order (the sort in
 * `sizeOrder` is index-tiebroken).
 */
export function compareSizes(a, b) {
  const left = rankOf(a)
  const right = rankOf(b)
  return left.bucket - right.bucket || left.rank - right.rank
}

/**
 * The permutation that puts `list` in size order: `[2, 0, 1]` means "start with
 * the third value, then the first, then the second".
 *
 * Returned as indexes rather than values because the editor renders inputs that
 * are keyed to their position in the draft — sorting indexes lets the display
 * move without the edit targets moving with it.
 */
export function sizeOrder(list) {
  const items = Array.isArray(list) ? list : []
  const decorated = items.map((value, index) => ({ index, ...rankOf(value) }))
  decorated.sort((a, b) => a.bucket - b.bucket || a.rank - b.rank || a.index - b.index)
  return decorated.map((entry) => entry.index)
}

/**
 * `list` in canonical size order.
 *
 * Returns the input array itself when it is already ordered (the common case
 * once a catalogue is clean), so this can sit in a render path without making
 * every parent re-render — a new array every call would defeat `useMemo` and
 * React's own bail-outs.
 */
export function sortSizes(list) {
  const items = Array.isArray(list) ? list : []
  if (items.length < 2) return items
  const order = sizeOrder(items)
  for (let i = 0; i < order.length; i++) if (order[i] !== i) return order.map((index) => items[index])
  return items
}

/** Already canonical? Used by the tests and by the editor's "sorted" hint. */
export function isSortedSizes(list) {
  const order = sizeOrder(list)
  return order.every((value, index) => value === index)
}

/**
 * Does this spec TYPE hold sizes?
 *
 * Deliberately a predicate and not an equality against a set of names: the
 * sheets say `Size`, `尺码`, `尺寸`, and one day `Shoe Size`. `Oversize` must
 * not match, which is what the leading word boundary is for.
 */
const SIZE_TYPES = new Set(['尺码', '尺寸', '尺码大小', '号码', 'size', 'sizes', 'sizing'])
const SIZE_PATTERN = /(^|[^a-z])(size|sizes|sizing)([^a-z]|$)/i

export function isSizeType(type) {
  const name = String(type ?? '').trim()
  if (!name) return false
  return SIZE_TYPES.has(name.toLowerCase()) || SIZE_PATTERN.test(name)
}
