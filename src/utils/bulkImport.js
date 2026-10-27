/**
 * 网页端批量导入 — 规划与执行
 * ══════════════════════════════
 *
 * The browser twin of `npm run batch:upsert`. Same sheet, same four columns,
 * same guarantees — the point of the web version is that ops does not have to
 * open a terminal at 11pm, not that it gets its own rules.
 *
 * Everything here is pure except `executeImport`, which takes its writers as
 * arguments so `scripts/test-bulk-import.mjs` can drive the whole flow with
 * fakes and assert on the payloads. No Supabase import lives in this file.
 *
 * THE ONE DIFFERENCE FROM THE CLI
 * ───────────────────────────────
 * The CLI rejects a row with an empty ASIN. This module does not: 货号 + 颜色 +
 * 尺寸 is enough to build a variant, and an ASIN can be filled in later from
 * the editor's ASIN panel. Ops routinely gets sheets where the ASIN column is
 * still being copied in — dropping those rows would mean re-running the whole
 * import for a column that arrives tomorrow.
 *
 * WHAT IS NEVER TRUE OF AN EXISTING PRODUCT
 * ───────────────────────────────────────
 * name / image / category / badge / hidden / sort_order are not in the update
 * payload. The payload is literally `{ specs }`, passed to a writer that only
 * touches that one column, so "绝不覆盖" is a property of the shape and not a
 * promise in this comment.
 */

import {
  fold,
  aggregate,
  dedupeExact,
  resolveConflicts,
  mergeVariants,
  planProducts,
  splitVariantKey,
  variantKey,
  HEADER_HINTS,
} from './asinsImportCore.js'

/** Same shape as `ASIN_PATTERN` in amazon.js, inlined so this module stays
 *  importable by Node with nothing but the pure core behind it. */
const ASIN_SHAPE = /^[A-Z0-9]{10}$/

/**
 * The header words that only survive the RIGHT decoding.
 *
 * 货号 / 颜色 / 尺寸 are two bytes in GBK and three in UTF-8, so a wrong
 * decoding turns them into replacement characters. `asin` / `sku` / `size` are
 * ASCII and survive every decoding there is — which is why the CSV probe must
 * not accept them: a GBK file decoded as UTF-8 still contains a perfectly
 * readable "ASIN", and that is exactly the file the probe has to catch.
 */
const DECODING_PROBES = ['货号', '款号', '颜色', '尺寸']

/* ── reading the sheet ─────────────────────────────────────────────────── */

/**
 * Grid → records. Like the core's `readTable`, except an empty ASIN is
 * information ("this combination has no listing yet") rather than a reason to
 * throw the row away.
 *
 * A row is only ever rejected for something that makes the VARIANT impossible:
 * no 货号, no 颜色 or no 尺寸. Those get a row number, because "第 47 行缺颜色"
 * is the difference between a ten-second fix and a re-export.
 *
 * An ASIN that is present but malformed (9 characters, a dash, a lowercase
 * with symbols) is also not fatal — the variant is built and the bad value is
 * skipped rather than stored. Writing it would poison `asins.variants`, and
 * `saveVariantAsins` only filters empties, not garbage.
 */
export function parseSheetGrid(rows) {
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
    if (!colour) missing.push('颜色')
    if (!size) missing.push('尺寸')

    if (missing.length) {
      rejected.push({ row: rowNumber, reason: `空字段：${missing.join('、')}`, cells })
      continue
    }

    const asin = rawAsin ? rawAsin.toUpperCase() : ''
    const asinValid = !asin || ASIN_SHAPE.test(asin)
    records.push({
      row: rowNumber,
      sku,
      asin: asinValid ? asin : '',
      asinRaw: rawAsin,
      asinValid,
      colour,
      size,
    })
  }

  return { records, rejected, blankRows, headerLooksRight, header }
}

/**
 * Rewrite each record's 货号 onto the spelling the database already uses.
 *
 * Matching is case/whitespace-insensitive because ops types 货号 by hand and
 * "g7f906" in a sheet means the product whose 货号 is "G7F906". Without this,
 * the merge would see a brand-new 货号 and create a second product for the
 * same item — the exact failure the whole feature exists to prevent.
 *
 * The core's `planProducts` matches on the exact string, so the rewrite has to
 * happen here, before anything is aggregated.
 */
export function alignSkus(records, dbProducts) {
  const byKey = new Map()
  for (const product of Array.isArray(dbProducts) ? dbProducts : []) {
    const key = fold(product?.sku).toLowerCase()
    if (key && !byKey.has(key)) byKey.set(key, String(product.sku).trim())
  }

  const fixes = []
  const out = (Array.isArray(records) ? records : []).map((record) => {
    const typed = fold(record.sku)
    const dbSku = byKey.get(typed.toLowerCase())
    if (!dbSku || dbSku === typed) return record
    fixes.push({ row: record.row, from: typed, to: dbSku })
    return { ...record, sku: dbSku }
  })

  return { records: out, fixes }
}

/**
 * Same 货号 + 颜色 + 尺寸 appearing twice, once with an ASIN and once without.
 *
 * The empty row is dropped before conflict resolution. Left in, it becomes a
 * conflict whose "first" row may be the empty one — which silently discards
 * the ASIN the sheet did provide. An empty cell carries no information, so
 * there is nothing to preserve by keeping it.
 */
export function preferFilledAsin(records) {
  const filled = new Set()
  for (const record of Array.isArray(records) ? records : []) {
    if (record.asin) filled.add(`${record.sku}||${variantKey(record)}`)
  }

  const kept = []
  let dropped = 0
  for (const record of Array.isArray(records) ? records : []) {
    if (!record.asin && filled.has(`${record.sku}||${variantKey(record)}`)) {
      dropped++
      continue
    }
    kept.push(record)
  }
  return { records: kept, dropped }
}

/* ── CSV encoding ──────────────────────────────────────────────────────── */

/**
 * Does this text's first line contain one of the decoding-sensitive header
 * words? Deliberately narrower than the core's `headerLooksRight`: this one is
 * answering "is this the right character set", not "is this our table", and
 * only a CJK word can tell the two apart.
 */
function decodingProbeHits(text) {
  const firstLine = String(text ?? '').split(/\r?\n/)[0] || ''
  const cells = firstLine
    .split(',')
    .map((cell) => fold(cell.replace(/^"+|"+$/g, '')))
  return cells.some((cell) => DECODING_PROBES.includes(cell))
}

/**
 * Pick the decoding of a CSV that actually contains the header.
 *
 * Excel on a Chinese Windows exports 货号 as GBK, not UTF-8. Decoding those
 * bytes as UTF-8 yields replacement characters where 货号 was, and the import
 * then reports "第一行不像表头" on a perfectly good file. So: try UTF-8, and if
 * the first line does not carry a decoding-sensitive header word, try GBK and
 * take whichever does.
 *
 * A sheet whose header is English-only is pure ASCII, decodes the same either
 * way, and lands on UTF-8 — which is what it is. `decodable` is a parameter so
 * the test can run the decision without a real TextDecoder, and so a browser
 * without GBK support (all of them have it, but a future one might not) degrades
 * to UTF-8 instead of throwing.
 */
export function pickCsvText(bytes, decodable = ['utf-8', 'gbk']) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  let first = null

  for (const encoding of decodable) {
    let text
    try {
      text = new TextDecoder(encoding).decode(buffer)
    } catch {
      continue
    }
    if (first === null) first = text
    if (decodingProbeHits(text)) return { text, encoding }
  }

  return { text: first ?? '', encoding: decodable[0] || 'utf-8' }
}

/* ── the plan ──────────────────────────────────────────────────────────── */

/**
 * Everything the preview modal needs to show and `executeImport` needs to do.
 *
 * `create` / `update` come straight from the core's `planProducts`, so the
 * "new rows only" semantics of `hideNew` are the ones the CLI is tested on.
 * `asinWrites` are pre-merged with what the database already holds, which is
 * what makes the merge additive: `saveVariantAsins` replaces a row's map, so
 * it is handed the union and never the sheet's slice of it.
 */
export function planImport({
  grid,
  dbProducts = [],
  existingAsins = {},
  hideNew = true,
  conflictPolicy = 'first',
} = {}) {
  const parsed = parseSheetGrid(grid)
  const aligned = alignSkus(parsed.records, dbProducts)
  const { records: deduped, dropped: droppedDuplicates } = dedupeExact(aligned.records)
  const preferred = preferFilledAsin(deduped)
  const { records: resolved, conflicts } = resolveConflicts(preferred.records, conflictPolicy)
  const bySku = aggregate(resolved)

  const { create, update } = planProducts(dbProducts, bySku, { hideNew })

  /* ASIN writes: the union, per 货号. Keys the sheet never mentions are not in
   * the payload at all, which is the "绝不准删除原有键值" guarantee expressed
   * as arithmetic — `mergeVariants` counts them as `kept`. */
  const asinWrites = []
  for (const [sku, variants] of Object.entries(bySku)) {
    const incoming = {}
    for (const [key, asin] of Object.entries(variants)) {
      if (asin) incoming[key] = asin
    }
    if (!Object.keys(incoming).length) continue

    const current = (existingAsins && existingAsins[sku]) || {}
    const merged = mergeVariants(current, incoming)
    asinWrites.push({ sku, variants: merged.merged, ...merged })
  }

  /* Per-货号 detail for the preview: what each row will get, so the operator
   * can catch "wait, that 货号 already existed" before clicking. */
  const createdSkus = new Set(create.map((row) => row.sku))
  const details = Object.entries(bySku).map(([sku, variants]) => {
    const keys = Object.keys(variants)
    const matched = update.find((entry) => entry.product?.sku === sku)
    const added = matched?.added || {}
    const pairs = keys.map(splitVariantKey)
    return {
      sku,
      kind: createdSkus.has(sku) ? 'new' : 'merge',
      variants: keys.length,
      colours: [...new Set(pairs.map((pair) => pair.colour).filter(Boolean))],
      sizes: [...new Set(pairs.map((pair) => pair.size).filter(Boolean))],
      asins: keys.filter((key) => variants[key]).length,
      newColours: added.Colour?.length || 0,
      newSizes: added.Size?.length || 0,
    }
  })

  const missingAsinRows = resolved.filter((record) => !record.asin).length
  const invalidAsinRows = resolved.filter((record) => !record.asinValid).length
  const variantsWithoutAsin = Object.values(bySku).reduce(
    (sum, variants) => sum + Object.values(variants).filter((asin) => !asin).length,
    0,
  )

  return {
    parse: parsed,
    spellingFixes: aligned.fixes,
    droppedDuplicates: droppedDuplicates + preferred.dropped,
    conflicts,
    create,
    update,
    asinWrites,
    bySku,
    details,
    variantsWithoutAsin,
    summary: {
      totalRows: parsed.records.length + parsed.rejected.length,
      newSkus: create.length,
      mergedSkus: update.length,
      errorRows: parsed.rejected.length,
      missingAsinRows,
      invalidAsinRows,
      newVariants: create.reduce((sum, row) => sum + row.variantCount, 0),
      asinsToWrite: asinWrites.reduce((sum, write) => sum + write.added + write.updated, 0),
    },
  }
}

/** True when there is nothing to write — an empty sheet, or one where every
 *  row was rejected. The modal uses it to disable "确认导入" instead of
 *  letting the operator find out from a toast. */
export function planIsEmpty(plan) {
  if (!plan) return true
  return !plan.create.length && !plan.update.length && !plan.asinWrites.length
}

/* ── execution ─────────────────────────────────────────────────────────── */

/**
 * Write the plan. Every writer is injected:
 *
 *   createProduct(row)          → the store's creator; the database assigns the id
 *   updateProductSpecs(id, spec)→ writes the `specs` column and nothing else
 *   saveVariantAsins(sku, map)  → upserts one asins row (map is already merged)
 *
 * Order is deliberate. Products first, because an ASIN row for a 货号 that
 * failed to insert is an orphan nothing can see. ASINs last, because a product
 * that exists with a colour but no ASIN is recoverable from the editor, while
 * the reverse is not recoverable at all.
 *
 * A failure never aborts the run: one bad 货号 (a duplicate id race, a dropped
 * connection) must not cost the other 40 rows. It lands in `skipped` and the
 * result modal says so by name.
 */
export async function executeImport(plan, deps = {}) {
  const {
    isAdmin = true,
    createProduct,
    updateProductSpecs,
    saveVariantAsins,
    onProgress,
  } = deps

  if (!isAdmin) {
    throw new Error('Not signed in as an administrator — nothing was written.')
  }
  for (const [name, fn] of [
    ['createProduct', createProduct],
    ['updateProductSpecs', updateProductSpecs],
    ['saveVariantAsins', saveVariantAsins],
  ]) {
    if (typeof fn !== 'function') throw new Error(`Import needs a ${name} writer`)
  }

  const stats = {
    created: 0,
    merged: 0,
    asinsAdded: 0,
    asinsUpdated: 0,
    skipped: [],
  }
  const written = new Set()

  const total = plan.create.length + plan.update.length + plan.asinWrites.length
  let done = 0
  const step = (phase) => {
    done++
    onProgress?.({ phase, done, total })
  }

  for (const row of plan.create) {
    try {
      await createProduct(row)
      stats.created++
      written.add(row.sku)
    } catch (error) {
      stats.skipped.push({ sku: row.sku, error: error?.message || String(error) })
    }
    step('create')
  }

  for (const entry of plan.update) {
    try {
      await updateProductSpecs(entry.product.id, entry.specs)
      stats.merged++
      written.add(entry.product.sku)
    } catch (error) {
      stats.skipped.push({ sku: entry.product.sku, error: error?.message || String(error) })
    }
    step('update')
  }

  for (const write of plan.asinWrites) {
    /* An ASIN row for a 货号 whose product write just failed is an orphan:
     * searchable, exported, and pointing at nothing. Skip it. */
    if (!written.has(write.sku)) continue
    try {
      await saveVariantAsins(write.sku, write.variants)
      stats.asinsAdded += write.added
      stats.asinsUpdated += write.updated
    } catch (error) {
      stats.skipped.push({ sku: write.sku, error: error?.message || String(error) })
    }
    step('asins')
  }

  stats.variantsWithoutAsin = plan.variantsWithoutAsin
  return stats
}
