#!/usr/bin/env node
/**
 * Decode a selection code from the command line
 * ═══════════════════════════════════════════════
 *
 *   node scripts/decode.mjs sdm-xxxxx
 *   node scripts/decode.mjs sdm-xxxxx --json    # raw JSON, pipe-friendly
 *   node scripts/decode.mjs sdm-xxxxx --table   # compact table
 *   node scripts/decode.mjs sdm-xxxxx --csv     # CSV to stdout
 *
 * Exit codes: 0 ok, 1 bad code, 2 no argument.
 *
 * 前缀是品牌名（`CODE_PREFIX` in src/utils/code.js）：这个 CLI 只认当前品牌
 * 及其历史前缀。别的品牌的码会报 Invalid brand prefix —— 两个库的商品 id
 * 是各自编号的，硬解出来的清单看着正常、实际是错的。
 *
 * v4 codes carry product ids, options, quantity and a timestamp — no names.
 * Everything human-readable is read from src/data/products.js and
 * src/data/asins.js at decode time, so keep those files in sync with whatever
 * is live in the browser (Admin → Products → Export JSON).
 *
 * v1/v2 codes are positional. They still decode, but `legacy: true` is set and
 * a warning is printed: the catalogue may have moved since they were generated.
 */

import { decodeCode, CODE_PREFIX } from '../src/utils/code.js'

const args = process.argv.slice(2)
const code = args.find((a) => !a.startsWith('--'))
const asJson = args.includes('--json')
const asTable = args.includes('--table')
const asCsv = args.includes('--csv')

if (!code) {
  console.error(`Usage: node scripts/decode.mjs <${CODE_PREFIX}-code> [--json|--table|--csv]`)
  process.exit(2)
}

const result = decodeCode(code)

if (!result.ok) {
  console.error(`Could not decode: ${result.error}`)
  process.exit(1)
}

/** 货号 shown to a human — deleted items have none, so the name placeholder shows */
const skuLabel = (item) => item.sku || (item.missing ? item.name : '—')

if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exit(0)
}

if (asCsv) {
  const header = ['No', '货号', 'ASIN', 'Product', 'Category', 'Options', 'Qty', 'Product ID', 'Status']
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(cell).join(',')]
  for (const [i, item] of result.items.entries()) {
    lines.push(
      [
        i + 1,
        skuLabel(item),
        item.asin || '',
        item.name,
        item.category,
        item.specText,
        item.qty,
        item.id,
        item.missing ? '已下架商品' : '',
      ]
        .map(cell)
        .join(','),
    )
  }
  process.stdout.write('\uFEFF' + lines.join('\r\n') + '\r\n')
  process.exit(0)
}

if (asTable) {
  const rows = result.items.map((item, i) => ({
    '#': i + 1,
    货号: skuLabel(item),
    ASIN: item.asin || '',
    Product: item.name,
    Options: item.specText,
    Qty: item.qty,
    ID: item.id,
    Status: item.missing ? 'REMOVED' : '',
  }))
  console.table(rows)
  console.log(
    `\n${result.ref} · ${result.totalStyles} styles · ${result.totalUnits} items · ${result.createdAt}`,
  )
  printWarnings(result)
  process.exit(0)
}

// Default: human-readable summary
console.log('')
console.log(`  Code       ${code}`)
console.log(`  Creator    ${result.ref}`)
console.log(`  Generated  ${result.createdAt}`)
console.log(`  Format     v${result.version}${result.legacy ? ' (legacy — positional)' : ''}`)
console.log(`  Total      ${result.totalStyles} styles · ${result.totalUnits} items`)
console.log('')
for (const [i, item] of result.items.entries()) {
  const options = item.specText !== '—' ? `  (${item.specText})` : ''
  const gone = item.missing ? '   [REMOVED FROM CATALOGUE]' : ''
  console.log(`  ${String(i + 1).padStart(2)}. ${skuLabel(item)}  ${item.name}${options}${gone}`)
  console.log(`      × ${item.qty}   ${item.category || '—'}   ${item.id}   ASIN: ${item.asin || '—'}`)
}
printWarnings(result)
console.log('')

function printWarnings(res) {
  if (!res.warnings?.length) return
  console.log('')
  for (const warning of res.warnings) console.log(`  ! ${warning}`)
}
