#!/usr/bin/env node
/**
 * 批量导入 货号 / ASIN / 颜色 / 尺寸
 * ═══════════════════════════════════
 *
 *   npm run catalog -- path/to/sheet.csv
 *   npm run catalog -- path/to/sheet.csv --dry-run
 *   npm run catalog -- path/to/sheet.csv --merge-rows
 *   npm run catalog -- path/to/sheet.csv --fresh
 *
 * Input: .csv / .tsv / .json. Columns are matched by header name, in any order:
 *   货号 (sku)   required
 *   ASIN         optional — several per cell, comma separated
 *   颜色          optional — becomes specs.Colour
 *   尺寸          optional — becomes specs.Size, omitted entirely when blank
 *
 * Output (three files, all overwritten):
 *   src/data/products.js   one product per 货号
 *   src/data/asins.js      { [货号]: { 'Colour|Size': 'ASIN' } }
 *   scripts/out/import.js  browser console script (local ops only, never served)
 *
 * RULES
 *  · id is the internal stable key (p001, p002, …), assigned once and reused
 *    on every later run for the same 货号. Selection codes store the id, so a
 *    re-import never invalidates codes that are already out there.
 *  · sku holds the 货号 exactly as written in the sheet.
 *  · Colours are deduped and keep first-appearance order — never sorted,
 *    because "Black, Brown, White" reads fine and any sort would be arbitrary.
 *  · Sizes are deduped and sorted into canonical order (XS → S → M → L → XL →
 *    XXL → 3XL, numbers ascending, unknown values last). The sheet is ordered
 *    by ASIN, so first-appearance would give "S, XS, XL, XXL, M, L".
 *    Pass --no-sort-sizes to keep sheet order.
 *  · Size spellings are unified (2XL → XXL, XXXL → 3XL) because the sheet was
 *    filled in by batch and mixes both. Pass --keep-size-spellings to disable.
 *  · A 货号 that appears on more than one row stops the run and is reported.
 *    Nothing is written until the sheet is clean (or you pass --merge-rows).
 *  · One ASIN per "Colour|Size". If two rows claim the same combination with
 *    different ASINs, the first row wins and the drop is reported — it is
 *    never merged into a list.
 *  · Re-running keeps your edits to name / category / image / tag. --fresh
 *    resets them to the placeholders below.
 *
 * PLACEHOLDERS (first import only)
 *   name     = 货号
 *   category = Uncategorised
 *   image    = ./placeholders/placeholder.svg
 *   tag      = ''
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, extname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PRODUCTS_PATH = resolve(ROOT, 'src/data/products.js')
const ASINS_PATH = resolve(ROOT, 'src/data/asins.js')
/* Deliberately NOT under public/. Anything in public/ is copied verbatim into
 * dist/ and is fetchable by anyone, so the console script would hand out all
 * 4509 ASINs to a single curl. It is a local ops artifact now, kept for the
 * spreadsheet workflow only. */
const IMPORT_PATH = resolve(ROOT, 'scripts/out/import.js')

const PLACEHOLDER_IMAGE = './placeholders/placeholder.svg'
const DEFAULT_CATEGORY = 'Uncategorised'
const DEFAULT_CATEGORIES = [
  'Tops',
  'Knitwear',
  'Dresses',
  'Bottoms',
  'Outerwear',
  'Shoes',
  'Accessories',
]
const BRAND_CONFIG = {
  name: 'Saodimallsu',
  welcome: 'Casual & Stylish, Inclusive & Diverse',
  tagline:
    'Knitwear made for real life: comfortable, flattering, and easy to make your own.',
  mission: 'Inclusive knitwear that helps women feel comfortable, confident, and seen.',
  logoText: 'S',
}

/* ───────────────── args ───────────────── */

const argv = process.argv.slice(2)
const inputPath = argv.find((a) => !a.startsWith('--'))
const dryRun = argv.includes('--dry-run')
const mergeRows = argv.includes('--merge-rows')
const fresh = argv.includes('--fresh')
const sortSizesEnabled = !argv.includes('--no-sort-sizes')
const unifySizes = !argv.includes('--keep-size-spellings')

if (!inputPath) {
  console.error(`
Usage: npm run catalog -- <sheet.csv|sheet.tsv|sheet.json> [options]

Options
  --dry-run              report what would change, write nothing
  --merge-rows           combine duplicate 货号 rows instead of stopping
  --fresh                reset name / category / image / tag to the placeholders
  --no-sort-sizes        keep sizes in sheet order instead of canonical order
  --keep-size-spellings  do not merge XXL / 2XL, 3XL / XXXL
`)
  process.exit(2)
}

/* ───────────────── read + parse ───────────────── */

let raw
try {
  raw = readFileSync(resolve(process.cwd(), inputPath), 'utf8')
} catch (err) {
  console.error(`\n✗ Could not read ${inputPath}\n  ${err.message}\n`)
  process.exit(1)
}

const ext = extname(inputPath).toLowerCase()
const rows = ext === '.json' ? fromJson(raw) : fromDelimited(raw)

if (!rows.length) {
  console.error('\n✗ No data rows found. Is the sheet empty?\n')
  process.exit(1)
}

/** JSON input: [{ "货号": "...", "ASIN": "...", "颜色": "...", "尺寸": "..." }] */
function fromJson(text) {
  let parsed
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (err) {
    console.error(`\n✗ Input is not valid JSON: ${err.message}\n`)
    process.exit(1)
  }
  if (!Array.isArray(parsed)) {
    console.error('\n✗ JSON input must be an array of objects\n')
    process.exit(1)
  }
  return parsed.map((entry, i) => ({ __line: i + 1, ...entry }))
}

/** CSV / TSV → [{ __line, 货号, ASIN, 颜色, 尺寸 }] */
function fromDelimited(text) {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.slice(0, clean.search(/\r?\n/) === -1 ? undefined : clean.search(/\r?\n/))
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ','

  const grid = splitDelimited(clean, delimiter)
  if (grid.length < 2) return []

  const header = grid[0].map((cell) => String(cell).trim())
  const columns = detectColumns(header)

  if (columns.sku === undefined) {
    console.error(`
✗ Could not find a 货号 column.

  Found these headers: ${header.map((h) => `"${h}"`).join(', ')}
  Expected one of:     货号 / SKU / item code / 款号 / 编号
`)
    process.exit(1)
  }

  const out = []
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i]
    if (cells.every((c) => String(c).trim() === '')) continue
    const pick = (field) => (columns[field] === undefined ? '' : String(cells[columns[field]] ?? '').trim())
    out.push({
      __line: i + 1,
      sku: pick('sku'),
      asin: pick('asin'),
      colour: pick('colour'),
      size: pick('size'),
    })
  }
  return out
}

/** RFC4180-ish splitter — handles quotes, doubled quotes and CRLF */
function splitDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      quoted = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }

    field += ch
    i++
  }

  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

/* ───────────────── column mapping ───────────────── */

// Declared as functions (not consts) so they are hoisted above the parsing
// calls that run at module scope.
function fieldAliases() {
  return {
    sku: ['货号', 'sku', 'itemcode', 'item', 'code', 'productcode', 'stylecode', '款号', '编号', '商品编码', '商品编号'],
    asin: ['asin', 'asins', 'amazonasin'],
    colour: ['颜色', 'colour', 'color', '色', '颜色colour'],
    size: ['尺寸', 'size', 'sizes', '尺码', '规格'],
  }
}

function normHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-/\\()（）:：.]/g, '')
}

function detectColumns(header) {
  const columns = {}
  const aliases = fieldAliases()
  header.forEach((name, index) => {
    const normalized = normHeader(name)
    for (const [field, list] of Object.entries(aliases)) {
      if (columns[field] !== undefined) continue
      if (list.some((alias) => normHeader(alias) === normalized)) columns[field] = index
    }
  })
  return columns
}

/* ───────────────── value splitting ───────────────── */

/**
 * Colours split on commas only — "Cream/Tan" is one colour, not two.
 * Sizes also split on "/" because "S/M/L" is the normal way to write them.
 */
function splitColours(raw) {
  return dedupe(splitOn(raw, /[,，、;；\n\r]+/))
}

function splitSizes(raw) {
  return dedupe(splitOn(raw, /[,，、;；\/\n\r]+/).map(canonicalSize))
}

/**
 * One size, one spelling.
 *
 * The sheet was filled in by batch: older ASINs say "XXL", newer ones say
 * "2XL" for the same size. Without this, a single product ends up with both
 * as separate options and the creator sees six sizes where there are five.
 *
 * Only true aliases are merged — nothing is invented, and 3XL / 4XL keep their
 * own names. Pass --keep-size-spellings to disable.
 */
const SIZE_ALIASES = new Map([
  ['xxl', 'XXL'],
  ['2xl', 'XXL'],
  ['3xl', '3XL'],
  ['xxxl', '3XL'],
  ['4xl', '4XL'],
  ['xxxxl', '4XL'],
])

function canonicalSize(value) {
  const trimmed = String(value).trim()
  if (!unifySizes) return trimmed
  return SIZE_ALIASES.get(trimmed.toLowerCase().replace(/\s+/g, ' ')) || trimmed
}

function splitAsins(raw) {
  return dedupe(splitOn(raw, /[,，、;；\s]+/))
}

/**
 * Canonical size order. First-appearance order is meaningless for sizes — the
 * sheet is sorted by ASIN, so you get "S, XS, XL, XXL, M, L", which looks
 * broken to anyone picking a size.
 *
 * Letters get a fixed rank, pure numbers sort numerically after them, and
 * anything unrecognised keeps its first-appearance order at the end. Spellings
 * are never rewritten: "2XL" stays "2XL", it just ranks alongside "XXL".
 */
const SIZE_RANK = new Map([
  ['xxs', 10],
  ['2xs', 10],
  ['xs', 20],
  ['s', 30],
  ['small', 30],
  ['m', 40],
  ['medium', 40],
  ['l', 50],
  ['large', 50],
  ['xl', 60],
  ['xxl', 70],
  ['2xl', 70],
  ['3xl', 80],
  ['xxxl', 80],
  ['4xl', 90],
  ['xxxxl', 90],
  ['5xl', 100],
  ['one size', 900],
  ['onesize', 900],
  ['free size', 900],
  ['均码', 900],
])

function sizeRank(value) {
  const key = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
  if (SIZE_RANK.has(key)) return SIZE_RANK.get(key)
  if (key !== '' && !Number.isNaN(Number(key))) return 1000 + Number(key)
  return Infinity
}

/** Stable sort — unknown values keep their first-appearance order */
function sortSizes(values) {
  return [...values].sort((a, b) => {
    const ra = sizeRank(a)
    const rb = sizeRank(b)
    if (!Number.isFinite(ra) && !Number.isFinite(rb)) return 0
    if (!Number.isFinite(ra)) return 1
    if (!Number.isFinite(rb)) return -1
    return ra - rb
  })
}

function splitOn(raw, pattern) {
  if (raw === undefined || raw === null) return []
  return String(raw)
    .split(pattern)
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

/** Dedupe case-insensitively, keep first spelling and first position */
function dedupe(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/* ───────────────── group by 货号 ───────────────── */

const groups = new Map()
const blankRows = []

for (const row of rows) {
  const sku = String(row.sku ?? '').trim()
  if (!sku) {
    blankRows.push(row.__line)
    continue
  }
  let group = groups.get(sku)
  if (!group) {
    group = { sku, entries: [], colours: [], sizes: [], lines: [] }
    groups.set(sku, group)
  }

  const colours = splitColours(row.colour)
  const sizes = splitSizes(row.size)
  const asinList = splitAsins(row.asin)

  group.lines.push(row.__line)
  group.colours.push(...colours)
  group.sizes.push(...sizes)
  // Kept per row so the ASIN can be pinned to one colour+size combination
  group.entries.push({ line: row.__line, asins: asinList, colours, sizes })
}

if (blankRows.length) {
  console.error(`
✗ ${blankRows.length} row(s) have no 货号 — nothing was written.

  Rows: ${blankRows.join(', ')}
`)
  process.exit(1)
}

if (!groups.size) {
  console.error('\n✗ No usable rows — every 货号 was empty.\n')
  process.exit(1)
}

/* ── duplicate 货号: stop and report, never guess ── */
const duplicates = [...groups.values()].filter((group) => group.lines.length > 1)

if (duplicates.length && !mergeRows) {
  const maxRows = duplicates.reduce((max, group) => Math.max(max, group.lines.length), 0)
  const heaviest = [...duplicates]
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, 5)
    .map((group) => `${group.sku} (${group.lines.length} rows)`)
    .join(', ')

  console.error(`
✗ Duplicate 货号 found — nothing was written.

  ${rows.length} rows · ${groups.size} distinct 货号
  ${duplicates.length} 货号 appear on more than one row (max ${maxRows})

  A sheet shaped like this usually lists one row per ASIN variant.
  Re-run with --merge-rows to combine them:
    · ASINs are concatenated and deduped
    · colours and sizes are unioned, first-appearance order kept
    · one product per 货号

  If the duplication is a mistake, fix the sheet instead.

  Heaviest: ${heaviest}
`)
  process.exit(1)
}

/* ───────────────── reuse ids from the previous catalogue ───────────────── */

const existing = await loadExistingProducts()
const bySku = new Map()
for (const product of existing) {
  if (product?.sku && !bySku.has(product.sku)) bySku.set(product.sku, product)
}

const idReuse = bySku.size > 0

/**
 * Ids that are already taken. Only meaningful when we are updating a previous
 * import — a fresh catalogue replaces the file wholesale, so the old ids
 * (p001…p016 from the demo data) must not push the new ones forward.
 */
const usedIds = new Set()
let nextNumber = 1

if (idReuse) {
  for (const product of existing) {
    if (!product?.id) continue
    usedIds.add(product.id)
    const match = /^p(\d+)$/.exec(product.id)
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1)
  }
}

async function loadExistingProducts() {
  try {
    const module = await import(`${pathToFileURL(PRODUCTS_PATH).href}?v=${Date.now()}`)
    return Array.isArray(module.products) ? module.products : []
  } catch {
    return []
  }
}

/* ───────────────── build ───────────────── */

const products = []
const asinMap = {}
const placeholders = []
const conflicts = []
const unattributed = []
const asinSet = new Set()
let reused = 0

for (const group of groups.values()) {
  const previous = bySku.get(group.sku)
  const keep = previous && !fresh

  let id = previous?.id
  if (!id) {
    while (usedIds.has(formatId(nextNumber))) nextNumber++
    id = formatId(nextNumber)
    nextNumber++
  } else {
    reused++
  }
  usedIds.add(id)

  const colours = dedupe(group.colours)
  const rawSizes = dedupe(group.sizes)
  const sizes = sortSizesEnabled ? sortSizes(rawSizes) : rawSizes
  const specs = {}
  if (colours.length) specs.Colour = colours
  if (sizes.length) specs.Size = sizes

  /* Variant map: one ASIN per "Colour|Size".
     A row that carries several colours or several sizes cannot be pinned to a
     single variant, so it is left out and reported instead of guessed. */
  const variants = {}
  for (const entry of group.entries) {
    for (const asin of entry.asins) asinSet.add(asin)

    if (entry.colours.length !== 1 || entry.sizes.length > 1) {
      unattributed.push({ sku: group.sku, line: entry.line })
      continue
    }

    const key = `${entry.colours[0]}|${entry.sizes[0] || ''}`
    const asin = entry.asins[0] || ''

    if (!(key in variants)) {
      variants[key] = asin
      continue
    }
    if (!variants[key] && asin) {
      variants[key] = asin
      continue
    }
    if (asin && variants[key] !== asin) {
      conflicts.push({ sku: group.sku, key, kept: variants[key], dropped: asin, line: entry.line })
    }
  }
  asinMap[group.sku] = variants

  const product = {
    id,
    sku: group.sku,
    name: keep ? previous.name : group.sku,
    category: keep ? previous.category : DEFAULT_CATEGORY,
    image: keep ? previous.image : PLACEHOLDER_IMAGE,
    tag: keep ? previous.tag || '' : '',
    specs,
  }

  /* Per-colour photos live only in the editor, never in the sheet — carry them
     across a re-import, restricted to options that still exist. Without this,
     re-running the importer would silently wipe every variant image. */
  if (keep) {
    const keptImages = {}
    for (const [type, byOption] of Object.entries(previous.variantImages || {})) {
      const options = specs[type]
      if (!Array.isArray(options) || !byOption || typeof byOption !== 'object') continue
      const entry = {}
      for (const option of options) {
        const url = typeof byOption[option] === 'string' ? byOption[option].trim() : ''
        if (url) entry[option] = url
      }
      if (Object.keys(entry).length) keptImages[type] = entry
    }
    if (Object.keys(keptImages).length) product.variantImages = keptImages
  }

  if (!keep) placeholders.push(group.sku)
  products.push(product)
}

function formatId(n) {
  return `p${String(n).padStart(3, '0')}`
}

/* ───────────────── report ───────────────── */

const withColour = products.filter((p) => p.specs.Colour).length
const withSize = products.filter((p) => p.specs.Size).length
const noSpecs = products.filter((p) => !Object.keys(p.specs).length).length
const asinCount = asinSet.size
const variantCount = Object.values(asinMap).reduce(
  (sum, variants) => sum + Object.values(variants).filter(Boolean).length,
  0,
)

console.log('')
console.log(`  Source      ${basename(inputPath)}  ·  ${rows.length} rows`)
console.log(`  Products    ${products.length}  (one per 货号)`)
console.log(`  Colours     ${withColour} products`)
console.log(`  Sizes       ${withSize} products${noSpecs ? `  ·  ${noSpecs} with no options` : ''}`)
console.log(`  ASINs       ${asinCount} unique  ·  ${variantCount} mapped to a colour+size`)
console.log(`  Ids         ${reused ? `${reused} reused from the previous catalogue` : 'fresh from p001'}`)
if (duplicates.length) {
  console.log(`  Merged      ${duplicates.length} duplicate 货号 (--merge-rows)`)
}

if (conflicts.length) {
  console.log('')
  console.log(`  ! ${conflicts.length} colour+size combination(s) had a second ASIN — the first was kept:`)
  for (const conflict of conflicts.slice(0, 8)) {
    console.log(`      ${conflict.sku}  ${conflict.key}  kept ${conflict.kept}  dropped ${conflict.dropped}`)
  }
  if (conflicts.length > 8) console.log(`      … +${conflicts.length - 8} more`)
}

if (unattributed.length) {
  console.log('')
  console.log(`  ! ${unattributed.length} row(s) had several colours or sizes in one cell and could not be`)
  console.log('    pinned to a single variant — no ASIN was recorded for them:')
  for (const row of unattributed.slice(0, 8)) {
    console.log(`      ${row.sku}  line ${row.line}`)
  }
  if (unattributed.length > 8) console.log(`      … +${unattributed.length - 8} more`)
}

if (placeholders.length) {
  console.log('')
  console.log('  Placeholders to fill in later (/#/admin/products):')
  console.log(`    name     = 货号`)
  console.log(`    category = ${DEFAULT_CATEGORY}`)
  console.log(`    image    = ${PLACEHOLDER_IMAGE}`)
  console.log(`    tag      = ''`)
  console.log(`    ${placeholders.length} product(s): ${preview(placeholders)}`)
}

if (dryRun) {
  console.log('\n  --dry-run — nothing written.\n')
  process.exit(0)
}

/* ───────────────── write ───────────────── */

writeFileSync(PRODUCTS_PATH, renderProductsFile(products), 'utf8')
writeFileSync(ASINS_PATH, renderAsinsFile(asinMap), 'utf8')
mkdirSync(dirname(IMPORT_PATH), { recursive: true })
writeFileSync(IMPORT_PATH, renderImportScript(products, asinMap), 'utf8')

console.log('')
console.log(`  ✓ src/data/products.js`)
console.log(`  ✓ src/data/asins.js`)
console.log(`  ✓ scripts/out/import.js   (local only — never served)`)
console.log('')
console.log('  Next:')
console.log('    1. npm run push           — load products + asins into Supabase')
console.log('    2. open /#/admin/products — fill in names, categories, images')
console.log('')
process.exit(0)

function preview(list, max = 6) {
  if (list.length <= max) return list.join(', ')
  return `${list.slice(0, max).join(', ')} … +${list.length - max} more`
}

/* ───────────────── renderers ───────────────── */

function renderProductsFile(list) {
  /* Keep categories the sheet's products actually use, so a re-import does not
     drop a category that was renamed in the admin. */
  const usedCategories = [...new Set(list.map((p) => p.category).filter(Boolean))]
  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories])]

  const body = list
    .map((product) => {
      const lines = [
        `    id: ${quote(product.id)},`,
        `    sku: ${quote(product.sku)},`,
        `    name: ${quote(product.name)},`,
        `    category: ${quote(product.category)},`,
        `    image: ${quote(product.image)},`,
      ]

      const specEntries = Object.entries(product.specs)
      if (specEntries.length) {
        lines.push('    specs: {')
        for (const [type, options] of specEntries) {
          lines.push(`      ${key(type)}: [${options.map(quote).join(', ')}],`)
        }
        lines.push('    },')
      } else {
        lines.push('    specs: {},')
      }

      if (product.variantImages && Object.keys(product.variantImages).length) {
        lines.push('    variantImages: {')
        for (const [type, byOption] of Object.entries(product.variantImages)) {
          lines.push(`      ${key(type)}: {`)
          for (const [option, url] of Object.entries(byOption)) {
            lines.push(`        ${key(option)}: ${quote(url)},`)
          }
          lines.push('      },')
        }
        lines.push('    },')
      }

      lines.push(`    tag: ${quote(product.tag || '')},`)
      return `  {\n${lines.join('\n')}\n  },`
    })
    .join('\n')

  return `/**
 * Product catalogue — default data
 * ══════════════════════════════════════════════════════════
 *
 * GENERATED by scripts/build-catalog.mjs from a spreadsheet.
 * Re-running the importer overwrites this file — edit products through
 * /#/admin/products instead, and re-run with --fresh only when you really
 * want to reset.
 *
 * Field reference
 *   id        Internal, stable, opaque (p001, p002, …). Assigned once and
 *             reused on re-import. Selection codes store this, so reordering
 *             or deleting products never corrupts an existing code.
 *   sku       The 货号 exactly as it appears in the source sheet. This is what
 *             ops recognises and what data/asins.js is keyed by.
 *   name      Display name — starts as the 货号
 *   category  Drives the storefront filter
 *   image     './placeholders/placeholder.svg' or any absolute URL
 *   specs     { Colour: ['Black', 'Oatmeal'], Size: ['S', 'M'] }
 *             Option order is the order creators see; keep it stable.
 *             Omit Size entirely for one-size products.
 *   variantImages  { Colour: { Black: 'https://…' } } — optional per-option
 *             photos. The storefront swaps to the matching one when a creator
 *             picks that colour; missing entries fall back to the main image.
 *             URLs only — no base64, so the file stays small.
 *   tag       Optional badge on the image
 *
 * There is deliberately no price / tagline / long description:
 * this is a selection sheet, pricing is agreed separately with the buyer.
 *
 * Limits: 35 units per style.
 */

/** Categories used by the storefront nav and the editor dropdown */
export const categories = [
${allCategories.map((category) => `  ${quote(category)},`).join('\n')}
]

export const products = [
${body}
]

/** Brand strings shown across the site */
export const brandConfig = {
  name: ${quote(BRAND_CONFIG.name)},
  welcome: ${quote(BRAND_CONFIG.welcome)},
  tagline: ${quote(BRAND_CONFIG.tagline)},
  logoText: ${quote(BRAND_CONFIG.logoText)},
}
`
}

function renderAsinsFile(map) {
  const entries = Object.entries(map).filter(([, variants]) => Object.keys(variants).length)
  const body = entries.length
    ? entries
        .map(([sku, variants]) => {
          const lines = Object.entries(variants)
            .map(([variant, asin]) => `    ${quote(variant)}: ${quote(asin)},`)
            .join('\n')
          return `  ${quote(sku)}: {\n${lines}\n  },`
        })
        .join('\n')
    : '  // (empty)'

  return `/**
 * ASIN map — 货号 → { "颜色|尺寸": ASIN }
 * ═══════════════════════════════════════
 *
 * GENERATED by scripts/build-catalog.mjs from a spreadsheet.
 *
 * One ASIN per colour+size combination, so the admin lookup can show the exact
 * listing the creator picked instead of a wall of ASINs.
 *
 *  · key   "Colour|Size" — the same literal values stored on the product's
 *          specs. A product without a Size gets "Black|", without a Colour
 *          "|M", without either "|".
 *  · value the ASIN, or "" when the sheet had none for that combination.
 *
 * A combination that is not in the map simply has no ASIN — the admin shows
 * "No ASIN" rather than guessing.
 *
 * Kept out of the product object on purpose: ASINs never enter a selection
 * code, so this file can be regenerated without invalidating codes. Deleting a
 * product does not delete its ASINs.
 */

export const asins = {
${body}
}

/** The variant map for one 货号, always an object */
export function asinsOf(sku) {
  const variants = asins[sku]
  return variants && typeof variants === 'object' ? variants : {}
}

/** ASIN for one colour+size combination, or '' when there is none */
export function asinFor(sku, colour, size) {
  const variants = asinsOf(sku)
  const key = \`\${colour || ''}|\${size || ''}\`
  if (variants[key] !== undefined) return variants[key] || ''

  // Tolerate case drift between the catalogue and the sheet
  const lower = key.toLowerCase()
  for (const [variant, asin] of Object.entries(variants)) {
    if (variant.toLowerCase() === lower) return asin || ''
  }
  return ''
}

/** Every ASIN in the map — used for search and for export headers */
export function allAsins() {
  return Object.values(asins).flatMap((variants) => Object.values(variants || {}))
}
`
}

function renderImportScript(list, map) {
  return `/* ══════════════════════════════════════════════════════════════
 * import.js — seed this browser's catalogue from the spreadsheet
 * ══════════════════════════════════════════════════════════════
 *
 * GENERATED by scripts/build-catalog.mjs — do not hand-edit, re-run the
 * importer instead.
 *
 * HOW TO USE
 *   1. Open the site (any page).
 *   2. DevTools → Console.
 *   3. Paste this whole file, press Enter.
 *   4. Reload the page.
 *
 * WHAT IT DOES
 *   Writes two localStorage keys, which the app reads in preference to the
 *   shipped defaults:
 *     mako_products_v1   the catalogue
 *     mako_asins_v1      the 货号 → { 'Colour|Size': ASIN } map
 *
 * SAFE TO RUN TWICE
 *   Products are matched by 货号, never appended blindly. An existing product
 *   with the same 货号 keeps its own id, so selection codes generated before
 *   the import still resolve to the right product. Running this again changes
 *   nothing the second time.
 *
 * This only affects the browser you paste it into. To change the site for
 * everyone, commit the regenerated src/data/*.js and redeploy.
 */
(function () {
  'use strict'

  var PRODUCTS_KEY = 'mako_products_v1'
  var ASINS_KEY = 'mako_asins_v1'

  var INCOMING = ${JSON.stringify(list, null, 2)}

  var INCOMING_ASINS = ${JSON.stringify(map, null, 2)}

  function readArray(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      return []
    }
  }

  function readObject(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (err) {
      return {}
    }
  }

  function pad(n) {
    return 'p' + String(n).padStart(3, '0')
  }

  var stored = readArray(PRODUCTS_KEY)
  var usedIds = {}
  var bySku = {}

  for (var i = 0; i < stored.length; i++) {
    var entry = stored[i]
    if (!entry) continue
    if (entry.id) usedIds[entry.id] = true
    if (entry.sku && !bySku[entry.sku]) bySku[entry.sku] = entry
  }

  var nextNumber = 1
  for (var id in usedIds) {
    var match = /^p(\\d+)$/.exec(id)
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1)
  }

  var added = 0
  var updated = 0

  for (var k = 0; k < INCOMING.length; k++) {
    var incoming = INCOMING[k]
    var existing = bySku[incoming.sku]

    if (existing) {
      // Keep the id already in use — codes point at it.
      var keepId = existing.id
      for (var field in incoming) existing[field] = incoming[field]
      if (keepId) existing.id = keepId
      updated++
      continue
    }

    var copy = JSON.parse(JSON.stringify(incoming))
    if (!copy.id || usedIds[copy.id]) {
      while (usedIds[pad(nextNumber)]) nextNumber++
      copy.id = pad(nextNumber)
      nextNumber++
    }
    usedIds[copy.id] = true
    bySku[copy.sku] = copy
    stored.push(copy)
    added++
  }

  var asinMap = readObject(ASINS_KEY)
  var asinKeys = 0
  for (var sku in INCOMING_ASINS) {
    asinMap[sku] = INCOMING_ASINS[sku]
    asinKeys++
  }

  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(stored))
    localStorage.setItem(ASINS_KEY, JSON.stringify(asinMap))
  } catch (err) {
    console.error('[import] Could not save — browser storage is full.', err)
    return
  }

  console.log(
    '[import] ' +
      added +
      ' added, ' +
      updated +
      ' updated, ' +
      stored.length +
      ' products total, ' +
      asinKeys +
      ' 货号 mapped to ASINs.',
  )
  console.log('[import] Reload the page to see the changes.')
})()
`
}

/** JSON.stringify with single quotes — keeps the generated file readable */
function quote(value) {
  const json = JSON.stringify(String(value))
  if (!json.includes("'")) return `'${json.slice(1, -1)}'`
  return json
}

/** Object key: bare when it is a valid identifier, quoted otherwise */
function key(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name)
}
