#!/usr/bin/env node
/**
 * Seasonal batch delete — retire styles by 货号, in the safe order
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   npm run batch:delete -- "D:/Desktop/retired.xlsx"            # 干跑（默认）
 *   npm run batch:delete -- "D:/Desktop/retired.xlsx" --dry-run   # 同上，写清楚而已
 *   npm run batch:delete -- "D:/Desktop/retired.xlsx" --force     # 真的删
 *
 *   --force     真正执行。没有它，任何情况都只打印计划。
 *   --sheet=    读哪一个 sheet
 *
 * INPUT
 * ─────
 * `.xlsx` / `.xls` / `.csv`（取每行第一个非空单元格，所以「货号 | ASIN」两列
 * 的导出表也能直接用），或者 `.txt`（一行一个货号）。第一行是「货号 / SKU」
 * 这类表头会被跳过。
 *
 * DELETE ORDER
 * ────────────
 * `asins` first, then `products`. The other way round would leave ASIN rows for
 * styles that no longer exist — they then show up in the admin ASIN search
 * pointing at nothing, and nobody can tell whether that means "deleted" or
 * "something went wrong".
 *
 * THE RED LINE: IDS
 * ─────────────────
 * Deleting must never renumber the survivors. `products.id` is what every
 * selection code in a creator's inbox stores; shifting ids by one would silently
 * re-point a hundred codes at the wrong piece. So this script:
 *   · deletes by 货号 (`sku`), never by position
 *   · never writes `sort_order`
 *   · never calls `reorder_products` or `sync_product_id_seq`
 *   · reads everything back afterwards and asserts every surviving id is
 *     unchanged, printing the result
 *
 * A deleted id is retired permanently — the sequence only moves forward, so the
 * id is never handed out again.
 */

import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import XLSX from 'xlsx'
import {
  loadEnv,
  readArgs,
  die,
  out,
  pad,
  connectAdmin,
  chunks,
  printTarget,
  brandGuard,
} from './cli-common.mjs'
import { parseSkuList, planDeletion, verifyDeletion, skuKey } from './batch-core.mjs'

const args = readArgs()
const ENV_PATH = loadEnv(args.get('env'))
/* Deletion is the one operation that cannot be undone by re-running an import. */
brandGuard(args)
const FILE = args.positional[0]
const FORCE = args.has('force')
const DRY_RUN_FLAG = args.has('dry-run')
const SHEET = args.get('sheet', '')

/* 两个都写 = 自相矛盾，按安全的那一个执行 */
const WRITE = FORCE && !DRY_RUN_FLAG

if (!FILE) {
  die(
    '用法：npm run batch:delete -- "<文件路径>" [--dry-run] [--force]\n' +
      '                             [--env=.env.brandb] [--expect-brand=brandb]\n' +
      '     文件可以是 xlsx / csv / txt，第一列或每行一个货号',
  )
}
if (!existsSync(FILE)) die(`找不到文件：${FILE}`)
if (FORCE && DRY_RUN_FLAG) out('\n  ⚠ 同时给了 --force 和 --dry-run，按干跑执行。')

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 读清单
 * ══════════════════════════════════════════════════════════════════════════ */
const ext = extname(FILE).toLowerCase()
let grid

if (ext === '.txt') {
  grid = readFileSync(FILE, 'utf8')
    .split(/\r?\n/)
    .map((line) => [line])
} else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
  const workbook = XLSX.readFile(FILE)
  const sheetName = SHEET || workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) die(`工作簿里没有名为 ${sheetName} 的 sheet（有：${workbook.SheetNames.join('、')}）`)
  grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
} else {
  die(`不认识的扩展名 ${ext} —— 支持 .xlsx / .xls / .csv / .txt`)
}

const parsedList = parseSkuList(grid)
if (!parsedList.skus.length) die('清单里一个货号都没读到')

out('')
out(`  ${process.env.BRAND_NAME || 'Catalogue'} → 批量删除（换季下架）`)
printTarget(ENV_PATH)
out(`  文件     ${FILE}`)
out(`  模式     ${WRITE ? '删除 —— 会真的删行' : '干跑 —— 只打印计划，一个字节都不删（加 --force 才执行）'}`)
out('')
out('  清单')
out(`    货号                ${parsedList.skus.length}`)
out(`    重复（已合并）      ${parsedList.duplicates}`)
out(`    空行                ${parsedList.blanks}`)
out(`    表头                ${parsedList.headerSkipped ? '已跳过' : '未检测到'}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 连库，读现状
 * ══════════════════════════════════════════════════════════════════════════ */
const { supabase, url, mode } = await connectAdmin()
out('')
out(`  project  ${url}`)
out(`  身份     ${mode}`)

const { data: dbProducts, error: productsError } = await supabase
  .from('products')
  .select('id, sku, name, sort_order')
  .order('sort_order', { ascending: true })
if (productsError) die(`读不到 products —— ${productsError.message}`)

const { data: dbAsins, error: asinsError } = await supabase.from('asins').select('sku, variants')
if (asinsError) die(`读不到 asins —— ${asinsError.message}`)

out('')
out('  线上现状')
out(`    products            ${dbProducts.length}`)
out(`    asins 货号           ${dbAsins.length}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 计划
 * ══════════════════════════════════════════════════════════════════════════ */
const plan = planDeletion({ products: dbProducts, asinRows: dbAsins, skus: parsedList.skus })

out('')
out('  计划')
out(`    products 命中        ${plan.matched.length}`)
out(`    asins 行命中         ${plan.asinsToDelete.length}（含 ${plan.asinsOnly.length} 个只剩 ASIN、商品已不在的孤儿货号）`)
out(`    要删的变体键         ${plan.variantKeys}`)
out(`    清单里查不到的货号    ${plan.missing.length}`)

if (plan.matched.length) {
  out('')
  out('    将被删除的商品')
  for (const row of plan.matched.slice(0, 40)) {
    out(`      ${pad(row.id, 6)} ${pad(row.sku, 14)} ${row.name.slice(0, 52)}`)
  }
  if (plan.matched.length > 40) out(`      …还有 ${plan.matched.length - 40} 个`)
}

if (plan.asinsOnly.length) {
  out('')
  out('    只有 ASIN、没有商品行的货号（一并清掉）')
  for (const sku of plan.asinsOnly.slice(0, 20)) out(`      ${sku}`)
}

if (plan.missing.length) {
  out('')
  out('    ⚠ 清单里这些货号在线上不存在 —— 不会猜，也不会删任何东西')
  for (const sku of plan.missing.slice(0, 30)) out(`      ${sku}`)
  if (plan.missing.length > 30) out(`      …还有 ${plan.missing.length - 30} 个`)
}

/* 一次删掉三分之一以上的目录，多半是文件选错了 */
const ratio = dbProducts.length ? plan.matched.length / dbProducts.length : 0
if (ratio >= 0.3) {
  out('')
  out(`    ⚠ 这次会删掉全目录的 ${Math.round(ratio * 100)}%（${plan.matched.length} / ${dbProducts.length}）`)
  out('      确认文件没选错、清单不是整季全清。')
}

if (!plan.matched.length && !plan.asinsToDelete.length) {
  out('')
  out('  没有任何可删的东西 —— 结束（没有发出任何写请求）。')
  out('')
  process.exit(0)
}

if (!WRITE) {
  out('')
  out('  干跑结束 —— 一个字节都没删。确认上面的数字后加 --force 再跑一次。')
  out('')
  process.exit(0)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 删除：先 asins，再 products
 * ══════════════════════════════════════════════════════════════════════════ */
const beforeProducts = dbProducts.map((row) => ({ id: row.id, sku: row.sku }))
const matchedSkus = plan.matched.map((row) => row.sku)

out('')
out('  删除')

for (const slice of chunks(plan.asinsToDelete)) {
  const { error } = await supabase.from('asins').delete().in('sku', slice)
  if (error) die(`删 asins 失败（${slice.length} 行）—— ${error.message}`)
}
out(`    asins 已删           ${plan.asinsToDelete.length} 行`)

for (const slice of chunks(matchedSkus)) {
  const { error } = await supabase.from('products').delete().in('sku', slice)
  if (error) die(`删 products 失败（${slice.length} 行）—— ${error.message}`)
}
out(`    products 已删        ${matchedSkus.length} 行`)

/* ══════════════════════════════════════════════════════════════════════════
 * 5. 验收 —— 用读回来的数据证明「id 没有被重新编号」
 * ══════════════════════════════════════════════════════════════════════════ */
out('')
out('  验收')

const { data: afterProducts } = await supabase
  .from('products')
  .select('id, sku, name, sort_order')
  .order('sort_order', { ascending: true })
const { data: afterAsins } = await supabase.from('asins').select('sku')

out(`    products            ${dbProducts.length} → ${(afterProducts || []).length}`)
out(`    asins 货号           ${dbAsins.length} → ${(afterAsins || []).length}`)

const verdict = verifyDeletion({ before: beforeProducts, after: afterProducts || [], deletedSkus: matchedSkus })

if (verdict.stillThere.length) {
  out(`    ✗ 这些货号要求删除但仍然存在：${verdict.stillThere.slice(0, 10).join('、')}`)
}
if (verdict.vanished.length) {
  out(`    ✗ 这些货号没有要求删除却消失了：${verdict.vanished.slice(0, 10).join('、')}`)
}
if (verdict.renumbered.length) {
  out('    ✗ id 被重新编号了（这是红线）：')
  for (const line of verdict.renumbered.slice(0, 10)) out(`        ${line}`)
}

out(
  verdict.ok
    ? `    ✓ 剩余 ${verdict.survivors} 个商品的 id 一个都没变 —— 历史选款码不受影响`
    : '    ✗ 目录结构和预期不一致，先别继续操作，检查上面的行',
)

const leftover = (afterAsins || []).filter((row) =>
  plan.asinsToDelete.some((sku) => skuKey(sku) === skuKey(row.sku)),
)
out(
  leftover.length === 0
    ? '    ✓ 这些货号的 ASIN 行都清干净了'
    : `    ✗ 还剩 ${leftover.length} 行 ASIN 没删掉`,
)

out('')
out('  完成。被删掉的 id 永久作废（序列只增不减，不会再发出去）。')
out('')
