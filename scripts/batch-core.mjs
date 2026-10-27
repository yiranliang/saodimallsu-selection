/**
 * Batch script helpers — pure, no I/O
 * ════════════════════════════════════
 * `scripts/test-batch-core.mjs` runs these under Node with no database, because
 * the parts worth testing are the ones that decide what gets deleted.
 *
 * The whole reason this is separate from the CLI: a delete list is a destructive
 * input, and "did we match the right 货号" has to be answerable without pointing
 * the script at production.
 */

/** Case/whitespace-insensitive identity for a 货号. */
export function skuKey(value) {
  return String(value ?? '')
    .replace(/[\ufeff\u00a0\u3000\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const HEADER = /^(货号|款号|sku|item\s*code|item|style\s*code)$/i

/**
 * Read a list of 货号 out of a spreadsheet grid or a one-column text file.
 *
 * Only the first non-empty cell of each row is used, so an exported sheet with
 * 货号 + ASIN columns still works: the list is about which STYLES go, not which
 * listings. Blank rows are counted, not treated as errors — Excel keeps the used
 * range long after the data ends.
 *
 * Duplicates collapse (case-insensitively) but are reported: a repeated 货号 is
 * usually a copy-paste slip, and deleting once is the right behaviour.
 */
export function parseSkuList(grid) {
  const rows = Array.isArray(grid) ? grid : []
  const skus = []
  const seen = new Set()
  let duplicates = 0
  let blanks = 0
  let headerSkipped = false

  for (let i = 0; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [rows[i]]
    const first = row.find((cell) => String(cell ?? '').trim() !== '')
    const value = String(first ?? '').trim()

    if (!value) {
      blanks++
      continue
    }
    if (i === 0 && !headerSkipped && HEADER.test(value)) {
      headerSkipped = true
      continue
    }

    const key = skuKey(value)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    skus.push(value)
  }

  return { skus, duplicates, blanks, headerSkipped }
}

/**
 * Work out what the delete list actually hits.
 *
 * Three outcomes per input:
 *   matched    a product row exists → it and its ASIN row go
 *   asinsOnly  no product, but an ASIN row does → delete the orphan map only
 *   missing    neither → report it, never guess
 *
 * Nothing is ever matched by position or by "close enough". A typo in the sheet
 * lands in `missing`, where a human can see it.
 */
export function planDeletion({ products = [], asinRows = [], skus = [] } = {}) {
  const productBySku = new Map()
  for (const product of products) {
    const key = skuKey(product.sku)
    if (key) productBySku.set(key, product)
  }

  const asinBySku = new Map()
  for (const row of asinRows) {
    const key = skuKey(row.sku)
    if (key) asinBySku.set(key, row)
  }

  const matched = []
  const asinsOnly = []
  const missing = []
  const asinsToDelete = []

  for (const input of skus) {
    const key = skuKey(input)
    const product = productBySku.get(key)
    const asin = asinBySku.get(key)

    if (product) {
      matched.push({
        id: product.id,
        sku: product.sku,
        name: product.name || '',
        hasAsins: Boolean(asin),
      })
    } else if (asin) {
      asinsOnly.push(asin.sku)
    } else {
      missing.push(input)
    }

    // Exact stored spelling — `.in('sku', …)` is case-sensitive.
    if (asin) asinsToDelete.push(asin.sku)
  }

  const ids = matched.map((row) => row.id)

  return {
    matched,
    asinsOnly,
    missing,
    asinsToDelete,
    ids,
    variantKeys: asinRows
      .filter((row) => asinsToDelete.includes(row.sku))
      .reduce((sum, row) => sum + Object.keys(row.variants || {}).length, 0),
  }
}

/**
 * Post-flight check: the survivors must be exactly "before minus the deleted
 * 货号", with their ids untouched.
 *
 * This is the assertion behind the red line "deleting must never renumber the
 * catalogue". Ids are what old selection codes store; if a delete ever shifted
 * them, every code in a creator's inbox would silently point at another piece.
 */
export function verifyDeletion({ before = [], after = [], deletedSkus = [] } = {}) {
  const deleted = new Set(deletedSkus.map((sku) => skuKey(sku)))
  const afterBySku = new Map()
  for (const product of after) {
    const key = skuKey(product.sku)
    if (key) afterBySku.set(key, product)
  }

  const stillThere = []
  const vanished = []
  const renumbered = []
  let survivors = 0

  for (const product of before) {
    const key = skuKey(product.sku)

    if (deleted.has(key)) {
      if (afterBySku.has(key)) stillThere.push(product.sku)
      continue
    }

    const match = afterBySku.get(key)
    if (!match) {
      vanished.push(product.sku)
      continue
    }
    if (String(match.id) !== String(product.id)) {
      renumbered.push(`${product.sku}: ${product.id} → ${match.id}`)
      continue
    }
    survivors++
  }

  return {
    survivors,
    stillThere,
    vanished,
    renumbered,
    ok: !stillThere.length && !vanished.length && !renumbered.length,
  }
}
