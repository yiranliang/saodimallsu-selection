/**
 * 秒杀（Limited Deal）批量导入 — 规划
 * ════════════════════════════════════
 *
 * The bulk-import twin for flash sales. One sheet, matched by 货号 (sku) — the
 * same identifier every other import and the CLI key on. Purely a planner: it
 * turns a grid into a list of per-product writes and a list of "why this row
 * was skipped". `productStore.setProductsDeals` is the only thing that talks to
 * Supabase, and it writes the five `sale_*` columns and nothing else (same
 * isolation argument as `setProductsBadge`).
 *
 * Columns (order-insensitive, matched by header word):
 *   主卖货号 / 货号 | 原价(可选) | 秒杀价/折后价 | 折扣率(可选) | 开始日期 | 结束日期
 *
 * TWO SHEETS, ONE PARSER
 * ──────────────────────
 * Ops exports two different shapes and both must import:
 *
 *   A. 货号 | 原价 | 折后价 | 开始日期 | 结束日期      ← the original brief
 *   B. 主卖货号 | 秒杀价 | 折扣率 | 开始日期 | 结束日期  ← what the ops sheet
 *                                                        actually looks like
 *
 * B has no 原价 and carries the discount as a percentage instead. So:
 *   - `originalPrice` is **optional**. No column (or an empty cell) → the column
 *     is written as NULL, and the storefront drops the strikethrough (it already
 *     guards `priceInfo.was`); the sale price is what the card shows.
 *   - `折扣率` is folded into `discount_label` as `30% OFF`. That column is also
 *     what `discountOf()` reads first, so the badge and the 30–40% bucket follow
 *     the operator's number rather than guessing from two prices — which is the
 *     only thing that CAN be done when there is no 原价 to divide by.
 *
 * Date columns are `YYYY-MM-DD`. The window is completed to the full day in
 * LOCAL time — `2026-11-27` becomes `2026-11-27T00:00` and `2026-11-30` becomes
 * `2026-11-30T23:59:59` — because a deal sheet says "starts Friday, ends
 * Monday", never "at 16:03:41". Same local-time rule as the rest of deal.js:
 * the string is stored without an offset, and the storefront counts down on the
 * creator's own clock.
 *
 * Pure: no React, no Supabase. `scripts/test-deal-import.mjs` drives it with
 * fakes.
 */

/**
 * The header words that identify each column. The first match wins; a header
 * like "原价 (USD)" still lands on `originalPrice` because `fold` strips the
 * noise and `includes` is checked against these lowercase keys.
 */
const HEADER_KEYS = {
  /* `主卖货号` first: it is the longest form, and a header of exactly `货号`
   * still matches via the second entry. (Matching is `includes`, so `主卖货号`
   * would also hit `货号` — listing it explicitly makes the intent readable and
   * keeps working if matching ever becomes exact.) */
  sku: ['主卖货号', '货号', '款号', 'sku', 'style', 'style number'],
  originalPrice: ['原价', 'original', 'original price', '原价格'],
  salePrice: ['折后价', '折后', 'sale price', '秒杀价', '折扣价', 'deal price', '折后价格'],
  /* The discount-rate column. Deliberately NOT `折扣` alone: a header of
   * `折扣价` belongs to `salePrice`, and a bare substring match would make the
   * two columns fight over the same index depending on order. */
  discountLabel: ['折扣率', 'discount rate', 'discount', 'off rate'],
  saleStart: ['开始日期', '开始', 'start', 'start date', '开始时间'],
  saleEnd: ['结束日期', '结束', 'end', 'end date', '结束时间'],
}

/** Columns a sheet must have. `originalPrice` and `discountLabel` are not on
 *  this list — shape B has neither `原价` nor a fallback for it. */
const REQUIRED_COLUMNS = ['sku', 'salePrice', 'saleStart', 'saleEnd']

/** Human labels for the "表头缺列" message. */
const COLUMN_LABELS = {
  sku: '主卖货号 / 货号',
  originalPrice: '原价',
  salePrice: '秒杀价',
  discountLabel: '折扣率',
  saleStart: '开始日期',
  saleEnd: '结束日期',
}

/** A valid date is `YYYY-MM-DD` (strict, so `11/27/2026` and `2026-11` are
 *  rejected rather than silently rolled forward by `new Date`). */
const DATE_ONLY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

/** 货号 的合法形状：非空、无空白、无逗号（逗号会打断 CSV 里的匹配键）。 */
const SKU_SHAPE = /^[^\s,]+$/

function fold(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[()（）【】\[\]：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse `YYYY-MM-DD` into a local-midnight timestamp, or null.
 * Strict: the calendar date must survive a round trip (`2026-02-31` → null).
 *
 * Also accepts an Excel date serial. `readSheetGrid` reads the sheet with
 * `raw: true`, so a CSV cell written as `2026-11-27` comes back as a *number* —
 * SheetJS parses it into a serial like `46353.3333...` (the `.3333` is a
 * time-zone offset baked in by the parser, ~8 hours). We take the integer part
 * as the day and ignore the fraction: the source cell was a date, not a
 * datetime, so "which hour" is noise.
 */
function parseDateOnly(value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null

  /* A numeric value (integer or serial-with-fraction) is unambiguously an Excel
   * serial, not a year: 2026-11-27 can't look like `46353.33`. Take the floor
   * to drop the time fraction, then convert 1899-12-30 + n days. */
  const asNumber = Number(text)
  if (Number.isFinite(asNumber) && /^\d+(?:\.\d+)?$/.test(text) && asNumber > 400 && asNumber < 60000) {
    const daySerial = Math.floor(asNumber)
    const ms = (daySerial - 25569) * 86400000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    }
  }

  const match = DATE_ONLY.exec(text)
  if (!match) return null

  const y = Number(match[1])
  const mo = Number(match[2]) - 1
  const d = Number(match[3])
  const date = new Date(y, mo, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null
  return date.getTime()
}

/** Local-midnight (00:00:00) of the given day, as the ISO-ish local string the
 *  rest of the app stores. */
function localStart(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`
}

/** Local end-of-day (23:59:59) of the given day. */
function localEnd(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59`
}

/** Strip a currency symbol and thousands separators; keep the decimal point.
 *  "US$49.99" → 49.99, "1,299" → 1299, "49.99 USD" → 49.99. */
function parsePrice(value) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  const match = text.replace(/[^0-9.,-]/g, '').match(/-?\d[\d,]*(?:\.\d+)?/)
  if (!match) return null
  const num = Number(match[0].replace(/,/g, ''))
  return Number.isFinite(num) ? num : null
}

/**
 * `折扣率` → the label the storefront prints.
 *
 *   "30%"      → "30% OFF"
 *   "30"       → "30% OFF"
 *   0.3        → "30% OFF"   ← a percentage-formatted Excel cell arrives as a
 *                             FRACTION when the sheet is read with `raw:true`,
 *                             the same reason dates arrive as serials
 *   "30% off"  → "30% OFF"   ← already a label, just normalised
 *   ""         → ""          ← no label: `deal.js` will compute one from the
 *                             prices, and if there is no 原价 it shows nothing
 *
 * Values that cannot be read as a percentage are kept verbatim rather than
 * dropped: the operator typed something, and a label they can see in the editor
 * is easier to fix than one that vanished during import.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseDiscountLabel(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''

  /* Already reads as a label ("30% OFF", "50% off"). Upper-case the suffix so
   * the badge does not print "30% off" next to "⚡ 25% OFF" elsewhere. */
  if (/off\b/i.test(raw)) return raw.replace(/\boff\b/gi, 'OFF')

  const numeric = Number(raw.replace(/%/g, '').trim())
  if (Number.isFinite(numeric) && raw.replace(/%/g, '').trim() !== '') {
    /* 0 < n < 1 is an Excel fraction, not "0.3 percent". */
    const percent = numeric > 0 && numeric < 1 ? numeric * 100 : numeric
    const rounded = Math.round(percent)
    if (rounded > 0 && rounded < 100) return `${rounded}% OFF`
    /* 0 / 100 / negative are not discounts. Returning '' lets the price-based
     * calculation take over instead of printing "0% OFF". */
    return ''
  }

  return raw
}

/**
 * Grid → `{ plan, problems }`.
 *
 * `plan` is an array of `{ sku, saleStart, saleEnd, salePrice, originalPrice }`
 * where every value is the normalised string form ready to write. `problems` is
 * an array of `{ row, reason }` for rows that could not be turned into a write
 * — a row number so ops can fix the sheet, not re-derive which line was bad.
 *
 * @param {Array<Array<unknown>>} rows  raw grid from `readSheetGrid`
 * @returns {{ plan: Array<object>, problems: Array<{row:number, reason:string}> }}
 */
export function planDealImport(rows) {
  const grid = Array.isArray(rows) ? rows : []
  const header = (grid[0] || []).map((cell) => fold(cell))

  /* Map each logical column to its grid index. */
  const colIndex = {}
  for (const [key, words] of Object.entries(HEADER_KEYS)) {
    const idx = header.findIndex((cell) => words.some((w) => cell === w || cell.includes(w)))
    if (idx >= 0) colIndex[key] = idx
  }

  const problems = []
  /* Only the four that cannot be derived. `原价` has no fallback (shape B has
   * none) and `折扣率` is optional too, so requiring either would reject the
   * ops sheet outright. */
  const missing = REQUIRED_COLUMNS.filter((k) => colIndex[k] === undefined)
  if (missing.length) {
    problems.push({
      row: 0,
      reason: `表头缺列：${missing.map((k) => COLUMN_LABELS[k]).join('、')}（需要 主卖货号 / 秒杀价 / 开始日期 / 结束日期，原价与折扣率可选）`,
    })
  }

  const plan = []
  const seen = new Set()

  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r] || []
    const cell = (key) => (colIndex[key] === undefined ? '' : row[colIndex[key]])
    const sku = String(cell('sku') ?? '').trim()

    /* A fully blank row is a tailing artefact, not an error. */
    if (!sku && row.every((v) => String(v ?? '').trim() === '')) continue

    if (!sku) {
      problems.push({ row: r + 1, reason: '缺货号' })
      continue
    }
    if (!SKU_SHAPE.test(sku)) {
      problems.push({ row: r + 1, reason: `货号含空白或逗号（"${sku}"）` })
      continue
    }
    if (seen.has(sku)) {
      problems.push({ row: r + 1, reason: `货号重复（${sku}）` })
      continue
    }
    seen.add(sku)

    const startTs = parseDateOnly(cell('saleStart'))
    const endTs = parseDateOnly(cell('saleEnd'))
    if (!startTs) {
      problems.push({ row: r + 1, reason: `开始日期无法解析（"${String(cell('saleStart')).trim()}"）` })
      continue
    }
    if (!endTs) {
      problems.push({ row: r + 1, reason: `结束日期无法解析（"${String(cell('saleEnd')).trim()}"）` })
      continue
    }
    if (endTs < startTs) {
      problems.push({ row: r + 1, reason: '结束日期早于开始日期' })
      continue
    }

    const salePrice = parsePrice(cell('salePrice'))
    if (salePrice === null || salePrice < 0) {
      problems.push({ row: r + 1, reason: `秒杀价无法解析（"${String(cell('salePrice')).trim()}"）` })
      continue
    }

    /* 原价是可选的：列不存在、或者这一格是空的，都写 NULL。
     *
     * 但"有这一列、写了东西、却读不出来"仍然是错误 —— 那是打错字（`4O.99`），
     * 静默丢掉会让运营以为导进去了，而卡片上只是少了一条划线价。 */
    const hasOriginalColumn = colIndex.originalPrice !== undefined
    const rawOriginal = String(cell('originalPrice') ?? '').trim()
    const originalPrice = parsePrice(rawOriginal)
    if (hasOriginalColumn && rawOriginal && (originalPrice === null || originalPrice < 0)) {
      problems.push({ row: r + 1, reason: `原价无法解析（"${rawOriginal}"）` })
      continue
    }
    if (originalPrice !== null && originalPrice < salePrice) {
      /* 折后价比原价还贵 —— 这不是秒杀，是打错了一位。 */
      problems.push({ row: r + 1, reason: '秒杀价高于原价' })
      continue
    }

    plan.push({
      sku,
      saleStart: localStart(startTs),
      saleEnd: localEnd(endTs),
      salePrice: String(salePrice),
      originalPrice: originalPrice === null ? null : String(originalPrice),
      /* 折扣率优先：没有原价时，这是唯一能说明"便宜了多少"的来源。 */
      discountLabel: normaliseDiscountLabel(cell('discountLabel')),
    })
  }

  return { plan, problems }
}

/**
 * Split the plan against the catalogue: which skus match a product id, which
 * do not. `bySku` is a `Map<string, string>` (sku → product id) built from the
 * current cache, so "未找到" is about THIS catalogue, not a stale snapshot.
 *
 * @param {Array<object>} plan  from `planDealImport`
 * @param {Map<string,string>} bySku
 * @returns {{ matched: Array<{id:string, deal:object, sku:string}>, missing: Array<string> }}
 */
export function resolveDealTargets(plan, bySku) {
  const matched = []
  const missing = []
  for (const deal of plan) {
    const id = bySku?.get?.(deal.sku)
    if (id) matched.push({ id, deal, sku: deal.sku })
    else missing.push(deal.sku)
  }
  return { matched, missing }
}
