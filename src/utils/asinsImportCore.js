/**
 * Incremental ASIN import — pure helpers
 * ═════════════════════════════════════════
 *
 * No I/O, no Supabase, no XLSX. Everything here takes plain values and returns
 * plain values, so `scripts/test-asins-import.mjs` can prove the behaviour
 * without a network or a spreadsheet. The CLI wrapper is
 * `scripts/import-asins.mjs`.
 *
 * LIVES IN src/ ON PURPOSE
 * ───────────────────────
 * The browser import ("Import (CSV/XLSX)" in /#/admin/products) needs exactly
 * these rules — append-only specs, key-by-key variant merge, `--hide-new`
 * asymmetry — and a second copy in `src/utils/bulkImport.js` would be a second
 * place for them to drift. So the module lives here, and
 * `scripts/asins-import-core.mjs` is a one-line re-export shim so the CLI and
 * its tests keep importing the same path they always did.
 *
 * WHY THIS IS SEPARATE FROM push-supabase.mjs
 * ───────────────────────────────────────────
 * `push-supabase.mjs` is a full mirror: it upserts whole product rows taken from
 * `src/data/products.js`, so re-running it overwrites name / category / image
 * with whatever the shipped file says. That is right for a first import and
 * wrong for "add ASINs to a live catalogue": ops has spent weeks filling in
 * names and photos through /#/admin, and none of that lives in the file.
 *
 * So this importer is additive by construction, not by convention:
 *   · asins.variants  → merged key by key; a key the sheet does not mention is
 *                       never touched, and nothing is ever deleted
 *   · products        → existing rows get `specs` updated and NOTHING else;
 *                       new rows are inserted with placeholder name/category
 *                       and, when asked, `hidden: true` so a half-finished
 *                       seasonal drop is invisible on the storefront
 *
 * WHY SPECS MAY ONLY EVER BE APPENDED
 * ───────────────────────────────────
 * A v4 selection code stores option *indexes* into `product.specs[type]`, and a
 * legacy code stores the product's position in the catalogue. Reordering or
 * removing an option silently re-points every code already in a creator's
 * inbox at a different colour. Appending is the only safe mutation, which is
 * why `mergeSpecs` never sorts, never dedupes by rewriting, and never drops.
 */

/** A 2XL is an XXL. The catalogue has always spelled it XXL (and 3XL/4XL/5XL
 *  with the digit first), so the sheet's `2XL` would otherwise create a second
 *  size that looks identical to a creator.
 *
 *  Same table handles colour drift — add a line here when the sheet and the
 *  catalogue disagree on something the importer cannot infer, e.g.
 *      'black and white': 'Black&white',
 *  Left empty by default on purpose: a wrong colour merge attaches the wrong
 *  ASIN to a colour, which is worse than an extra chip a human can fix. */
export const VALUE_ALIASES = {
  // US size notation → the spelling the catalogue already uses.
  '2xl': 'XXL',
  // IB-SKU sheets say `Navy`, the catalogue has said `Navy Blue` for 18
  // products since the first import. Same colour; without this the storefront
  // would show two chips that mean one thing.
  navy: 'Navy Blue',
}

/** @deprecated kept so older call sites keep working */
export const SIZE_ALIASES = VALUE_ALIASES

export const DEFAULT_SPEC_ORDER = ['Colour', 'Size']

/* ── text normalisation ─────────────────────────────────────────────────── */

/** Trim the edges and collapse runs of whitespace — including the ones that
 *  copy/paste out of Excel likes to smuggle in (nbsp, tabs, full-width space),
 *  plus the byte-order mark Excel puts in front of a CSV's first header cell. */
export function fold(value) {
  return String(value ?? '')
    .replace(/[\ufeff\u00a0\u3000\u200b\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Letters and digits only, lowercased. `Blue&green`, `Blue Green` and
 *  `blue-green` all collapse to `bluegreen` — that is the point: it lets the
 *  importer recognise a spelling drift without pretending to understand
 *  colour names. */
export function slug(value) {
  return fold(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/* ── reading the sheet ──────────────────────────────────────────────────── */

/** Exported so the browser-side CSV reader can recognise a header without
 *  parsing the whole sheet first (see `pickCsvText` in bulkImport.js). */
export const HEADER_HINTS = ['货号', 'asin', '颜色', '尺寸', 'sku', 'colour', 'color', 'size']

/**
 * Turn the raw 2-D grid from the spreadsheet into records.
 *
 * Two things are deliberately lossy-but-reported:
 *   · fully blank rows are dropped and counted. Excel keeps the used-range
 *     dimensions long after the data ends, so a 3 295-row export routinely
 *     reports a `!ref` of 3 773 rows; importing those 477 blanks would create
 *     477 empty variants.
 *   · rows missing any of the four fields are rejected with a reason rather
 *     than guessed at.
 *
 * `allowMissingAsin` (default false) changes the ASIN column from "required"
 * to "optional": a row with a 货号 + colour + size but no ASIN is kept with
 * `asin: ''` instead of rejected. This is how the batch importer records a
 * variant that exists but has no listing yet — on the storefront such a
 * combination is treated as Sold Out. The ASIN-only importers keep the default,
 * because a row with no ASIN has nothing to import there.
 */
export function readTable(rows, { allowMissingAsin = false } = {}) {
  const grid = Array.isArray(rows) ? rows : []
  const header = (grid[0] || []).map((cell) => fold(cell).toLowerCase())
  const headerLooksRight = header.some((cell) => HEADER_HINTS.includes(cell))

  const records = []
  const rejected = []
  let blankRows = 0

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i] || []
    const cells = [row[0], row[1], row[2], row[3]].map(fold)
    const rowNumber = i + 1

    if (cells.every((cell) => cell === '')) {
      blankRows++
      continue
    }

    const [sku, rawAsin, colour, size] = cells
    const missing = []
    if (!sku) missing.push('货号')
    if (!allowMissingAsin && !rawAsin) missing.push('ASIN')
    if (!colour) missing.push('颜色')
    if (!size) missing.push('尺寸')

    if (missing.length) {
      rejected.push({ row: rowNumber, reason: `空字段：${missing.join('、')}`, cells })
      continue
    }

    /* No ASIN → keep the row, but with an empty ASIN. It still contributes its
     * colour+size to the product's specs, just not to the ASIN map. */
    if (!rawAsin) {
      records.push({ row: rowNumber, sku, asin: '', colour, size, asinCased: false })
      continue
    }

    const asin = rawAsin.toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      rejected.push({ row: rowNumber, reason: `ASIN 格式不对（${asin.length} 位）`, cells })
      continue
    }

    records.push({ row: rowNumber, sku, asin, colour, size, asinCased: asin !== rawAsin })
  }

  return { records, rejected, blankRows, headerLooksRight, header }
}

/* ── deduplication ──────────────────────────────────────────────────────── */

export const rowKey = (r) => `${r.sku}|${r.colour}|${r.size}|${r.asin}`
export const variantKey = (r) => `${r.colour}|${r.size}`

/** Rows identical in all four columns. Keep the first, count the rest. */
export function dedupeExact(records) {
  const seen = new Set()
  const kept = []
  let dropped = 0
  for (const record of records) {
    const key = rowKey(record)
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    kept.push(record)
  }
  return { records: kept, dropped }
}

/* ── vocabulary alignment ───────────────────────────────────────────────── */

/**
 * Build a lookup from the values the catalogue already uses.
 *
 * `list` keeps the original spellings in first-seen order (used for reporting
 * and for near-miss suggestions). `lower` and `bySlug` are the two matching
 * strategies, tried in that order — exact spelling beats punctuation-blind
 * matching, so a real `Black&white` is never rewritten into `Black and White`.
 */
export function buildVocabulary(values) {
  const list = []
  const lower = new Map()
  const bySlug = new Map()

  for (const raw of Array.isArray(values) ? values : []) {
    const value = fold(raw)
    if (!value) continue
    if (!lower.has(value.toLowerCase())) {
      lower.set(value.toLowerCase(), value)
      list.push(value)
    }
    const key = slug(value)
    if (key && !bySlug.has(key)) bySlug.set(key, value)
  }

  return { list, lower, bySlug }
}

/**
 * Map one spreadsheet value onto the catalogue's own spelling.
 *
 * Returns `how` so the CLI can tell the operator *why* a value changed:
 *   exact       already spelled that way
 *   case        differed only in case
 *   punctuation differed only in spaces / `&` / `-`
 *   alias       hit the size alias table (2XL → XXL)
 *   new         no match — kept verbatim, needs a human decision
 */
export function alignValue(raw, vocabulary, aliases = VALUE_ALIASES) {
  const value = fold(raw)
  if (!value) return { value: '', how: 'empty' }

  const direct = vocabulary.lower.get(value.toLowerCase())
  if (direct !== undefined) {
    return { value: direct, how: direct === value ? 'exact' : 'case' }
  }

  const bySlug = vocabulary.bySlug.get(slug(value))
  if (bySlug !== undefined) return { value: bySlug, how: 'punctuation' }

  const alias = aliases[value.toLowerCase()]
  if (alias) {
    const resolved = vocabulary.lower.get(alias.toLowerCase())
    return { value: resolved ?? alias, how: 'alias' }
  }

  return { value, how: 'new' }
}

/** Rewrite every record's colour and size onto catalogue spellings. */
export function alignRecords(records, { colours, sizes }, aliases = VALUE_ALIASES) {
  const changes = []
  const out = records.map((record) => {
    const colour = alignValue(record.colour, colours, aliases)
    const size = alignValue(record.size, sizes, aliases)
    if (colour.how !== 'exact') {
      changes.push({ field: '颜色', from: record.colour, to: colour.value, how: colour.how })
    }
    if (size.how !== 'exact') {
      changes.push({ field: '尺寸', from: record.size, to: size.value, how: size.how })
    }
    return { ...record, colour: colour.value, size: size.value }
  })

  // Collapse the report: one line per distinct (field, from, to), with a count
  const seen = new Map()
  for (const change of changes) {
    const key = `${change.field}|${change.from}|${change.to}|${change.how}`
    const hit = seen.get(key)
    if (hit) hit.count++
    else seen.set(key, { ...change, count: 1 })
  }

  return { records: out, changes: [...seen.values()] }
}

/* ── near-miss suggestions ──────────────────────────────────────────────── */

/** Plain Levenshtein, capped — only used to suggest, never to decide. */
export function editDistance(a, b, cap = 3) {
  const s = String(a)
  const t = String(b)
  if (Math.abs(s.length - t.length) > cap) return cap + 1
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[t.length]
}

/**
 * Values that matched nothing but are one character away from something the
 * catalogue already has.
 *
 * Reported, never applied. `Dust Pink` is almost certainly a typo for
 * `Dusty Pink`, but "almost certainly" is not a basis for rewriting a variant
 * key — a wrong merge silently attaches the wrong ASIN to a colour.
 *
 * Deliberately narrow: one edit, and only for words long enough that the
 * difference is meaningful. Loosening this to two edits turns the report into
 * noise — `Light Green ≈ Light Grey`, `Mint ≈ Pink`, `8 ≈ S` — and a warning
 * nobody reads is worse than no warning.
 */
export function nearMisses(values, vocabulary, { maxDistance = 1, minLength = 5 } = {}) {
  const out = []
  for (const value of values) {
    const key = slug(value)
    if (key.length < minLength) continue
    let best = null
    for (const candidate of vocabulary.list) {
      const other = slug(candidate)
      if (other.length < minLength) continue
      const distance = editDistance(key, other, maxDistance)
      if (distance <= maxDistance && distance > 0 && (!best || distance < best.distance)) {
        best = { candidate, distance }
      }
    }
    if (best) out.push({ value, candidate: best.candidate, distance: best.distance })
  }
  return out
}

/* ── conflict detection ─────────────────────────────────────────────────── */

/**
 * Same 货号 + 颜色 + 尺寸, two different ASINs.
 *
 * There is no correct answer here — one of the two listings is the one ops
 * actually wants, and only a human knows which. So the default policy is
 * `first` (deterministic, and in practice the new batch sits at the top of the
 * export) but every conflict is printed with both values so it can be
 * overruled before a single row is written.
 *
 *   first  keep the first row seen
 *   last   keep the last row seen
 *   skip   write neither — leaves the key exactly as the database has it
 */
export function resolveConflicts(records, policy = 'first') {
  const groups = new Map()
  for (const record of records) {
    const key = `${record.sku}||${variantKey(record)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }

  const kept = []
  const conflicts = []

  for (const [, group] of groups) {
    const distinct = [...new Set(group.map((r) => r.asin))]
    if (distinct.length === 1) {
      kept.push(group[0])
      continue
    }

    conflicts.push({
      sku: group[0].sku,
      variant: variantKey(group[0]),
      rows: group.map((r) => r.row),
      asins: group.map((r) => r.asin),
    })

    if (policy === 'skip') continue
    kept.push(policy === 'last' ? group[group.length - 1] : group[0])
  }

  return { records: kept, conflicts }
}

/* ── aggregation ────────────────────────────────────────────────────────── */

/**
 * { 货号: { "颜色|尺寸": "ASIN" } }
 *
 * Key order inside each product follows the sheet, because a stable order makes
 * the generated JSON diffable — a re-export that only adds rows shows up as
 * additions, not as a reshuffled blob.
 */
export function aggregate(records) {
  const bySku = {}
  for (const record of records) {
    if (!bySku[record.sku]) bySku[record.sku] = {}
    bySku[record.sku][variantKey(record)] = record.asin
  }
  return bySku
}

/** Split `"Black|M"` back into its two halves. Splits on the LAST pipe so a
 *  colour that contains one (`White|Blue|M`) still parses. */
export function splitVariantKey(key) {
  const text = String(key ?? '')
  const at = text.lastIndexOf('|')
  if (at === -1) return { colour: text, size: '' }
  return { colour: text.slice(0, at), size: text.slice(at + 1) }
}

/** Collect the option lists a product needs, in spec-key order. */
export function specsFromVariants(variantKeys, order = DEFAULT_SPEC_ORDER) {
  const specs = {}
  for (const type of order) specs[type] = []
  for (const key of variantKeys) {
    const { colour, size } = splitVariantKey(key)
    if (colour && !specs.Colour.includes(colour)) specs.Colour.push(colour)
    if (size && !specs.Size.includes(size)) specs.Size.push(size)
  }
  return specs
}

/**
 * Union of the current option list and the incoming one — append only.
 *
 * Never sorts, never rewrites an existing spelling, never removes, and never
 * introduces a spec *type* the product does not already have.
 *
 * That last rule is not cosmetic. A selection code writes one character per
 * spec type, and `specTypes = Object.keys(product.specs)` is what decides how
 * many characters a code has. Giving a one-size product a `Size: []` key would
 * lengthen every code ever issued for it and shift the quantity slot — the code
 * would still decode, to the wrong numbers.
 */
export function mergeSpecs(current, incoming, order = DEFAULT_SPEC_ORDER) {
  const specs = {}
  const added = {}
  const ignored = {}

  const existingTypes = Object.keys(current || {})
  // A brand-new product has no shape yet, so it gets the canonical one.
  // An existing product keeps exactly the shape it has.
  const types = existingTypes.length ? existingTypes : [...order]

  for (const type of types) {
    const before = Array.isArray(current?.[type]) ? current[type] : current?.[type] ? [current[type]] : []
    const list = [...before]
    const seen = new Set(list.map((value) => slug(value)))
    const fresh = []

    for (const raw of Array.isArray(incoming?.[type]) ? incoming[type] : []) {
      const value = fold(raw)
      if (!value) continue
      const key = slug(value)
      if (!key || seen.has(key)) continue
      seen.add(key)
      list.push(value)
      fresh.push(value)
    }

    specs[type] = list
    if (fresh.length) added[type] = fresh
  }

  // Incoming types the product has no slot for — reported so ops can add the
  // spec type by hand in /#/admin if the product really did grow a new axis.
  for (const type of Object.keys(incoming || {})) {
    if (types.includes(type)) continue
    const values = (Array.isArray(incoming[type]) ? incoming[type] : []).map(fold).filter(Boolean)
    if (values.length) ignored[type] = values
  }

  return { specs, added, ignored }
}

/* ── merging into what the database already has ─────────────────────────── */

/**
 * Additive merge of one 货号's variant map.
 *
 * `kept` counts the keys the sheet said nothing about — they are not in the
 * payload at all, so they stay exactly as they are. This is the "绝不删除原有
 * 变体" guarantee expressed as arithmetic, so the CLI can print it instead of
 * just promising it.
 */
export function mergeVariants(current, incoming) {
  const merged = { ...(current || {}) }
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const [key, asin] of Object.entries(incoming || {})) {
    if (!(key in merged)) {
      merged[key] = asin
      added++
    } else if (merged[key] !== asin) {
      merged[key] = asin
      updated++
    } else {
      unchanged++
    }
  }

  const kept = Object.keys(current || {}).filter((key) => !(key in (incoming || {}))).length
  return { merged, added, updated, unchanged, kept }
}

/* ── product planning ───────────────────────────────────────────────────── */

/** `p007` → 7; anything else → 0. */
export function idNumber(id) {
  const match = /^p(\d+)$/.exec(String(id ?? ''))
  return match ? Number(match[1]) : 0
}

export function formatId(n) {
  return `p${String(n).padStart(3, '0')}`
}

/**
 * Decide which 货号 need a new product row.
 *
 * Existing 货号 are matched on `sku`, not on name — ops is free to rename a
 * product without breaking the import. Ids are handed out from
 * `max(existing) + 1` and the sequence is re-synced by the CLI afterwards, so
 * the next product created through /#/admin cannot collide.
 *
 * `hideNew` sets `hidden` on the rows this call CREATES and on nothing else.
 * It is a one-way door by design: the option is only read while building a
 * brand-new row, so an existing product can never be hidden by a batch run —
 * the `update` branch has no `hidden` in it at all, and the CLI's payload for
 * an existing 货号 is literally `{ specs }`. That asymmetry is the whole
 * guarantee: "上新时先藏起来" must never become "跑一次批量就把在卖的老货藏了".
 */
export function planProducts(dbProducts, bySku, { order = DEFAULT_SPEC_ORDER, hideNew = false } = {}) {
  const list = Array.isArray(dbProducts) ? dbProducts : []
  const bySkuIndex = new Map()
  let maxId = 0
  let maxSort = -1

  for (const product of list) {
    if (product.sku) bySkuIndex.set(product.sku, product)
    maxId = Math.max(maxId, idNumber(product.id))
    maxSort = Math.max(maxSort, Number(product.sort_order) || 0)
  }

  const create = []
  const update = []
  let nextId = maxId + 1

  for (const [sku, variants] of Object.entries(bySku)) {
    const existing = bySkuIndex.get(sku)
    const incoming = specsFromVariants(Object.keys(variants), order)

    if (existing) {
      const { specs, added, ignored } = mergeSpecs(existing.specs, incoming, order)
      /* `ignored` rides along so a caller can say "this product spells the
         axis `Color`, so your 颜色 column went nowhere" instead of writing a
         spec type the product does not have. */
      update.push({ product: existing, specs, added, ignored })
      continue
    }

    create.push({
      id: formatId(nextId++),
      sku,
      name: sku,
      category: 'Uncategorised',
      image: './placeholders/placeholder.svg',
      specs: incoming,
      variant_images: {},
      hidden: Boolean(hideNew),
      tag: '',
      sort_order: maxSort + create.length + 1,
      variantCount: Object.keys(variants).length,
    })
  }

  return { create, update, nextId }
}
