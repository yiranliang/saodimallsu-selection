/**
 * Spreadsheet → grid, in the browser
 * ═════════════════════════════════
 *
 * `bulkImport.js` is pure and takes a grid; this is the one place that touches
 * a `File`. It exists as its own module so the import button can be lazy about
 * SheetJS: `import('xlsx')` is a dynamic import, which Vite turns into a
 * separate chunk that is only fetched when a file is actually chosen. The
 * admin bundle stays the size it was.
 *
 * WHY XLSX AND NOT PAPAPARSE
 * ──────────────────────────
 * One parser for both formats instead of two. `xlsx` is already a dependency
 * (the CLI imports use it), so this adds no install step and no second
 * behaviour to keep in step — a quoted field containing a comma parses the
 * same way whether the file is .csv or .xlsx.
 *
 * Note the trade-off that comes with SheetJS 0.18.5 (the last version on npm):
 * CVE-2023-30533, a prototype-pollution issue reachable from a crafted file.
 * It does not apply here in any meaningful way — the only person who can reach
 * this code path is a signed-in admin choosing a file from their own disk —
 * but it is the reason not to expose this upload anywhere a creator can reach.
 */

import { pickCsvText } from './bulkImport.js'

/** `.csv` / `.txt` go through the text path; everything else is treated as a
 *  spreadsheet binary. Decided on the name, not on sniffing the bytes: an .xlsx
 *  is a zip and starts with `PK`, but a file called .csv that is actually a
 *  spreadsheet is a mislabelling the operator should hear about. */
function isTextTable(name) {
  return /\.(csv|txt)$/i.test(String(name || ''))
}

/**
 * File → 2-D grid of strings, first sheet, first four columns meaningful.
 *
 * CSV is decoded twice at most: UTF-8, then GBK if the header did not
 * recognise itself (see `pickCsvText`). Excel on Chinese Windows writes GBK,
 * and a mojibake header would otherwise fail the "表头必须包含货号" check on a
 * perfectly good file.
 */
export async function readSheetGrid(file) {
  const buffer = await file.arrayBuffer()

  if (isTextTable(file.name)) {
    const { text } = pickCsvText(new Uint8Array(buffer))
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(text, { type: 'string' })
    return gridOf(workbook, XLSX)
  }

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  return gridOf(workbook, XLSX)
}

function gridOf(workbook, XLSX) {
  const name = workbook.SheetNames[0]
  const sheet = workbook.Sheets[name]
  if (!sheet) {
    throw new Error(
      workbook.SheetNames.length
        ? `The workbook's first sheet could not be read`
        : `The file has no sheets`,
    )
  }
  /* `header: 1` gives raw rows (arrays), `defval: ''` fills the ragged tail so
   * `row[3]` is never undefined for a short row. */
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
}
