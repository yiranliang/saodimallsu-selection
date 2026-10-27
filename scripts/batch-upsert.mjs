#!/usr/bin/env node
/**
 * Seasonal batch upsert — add colours, sizes and ASINs without touching anything else
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 *   npm run batch:upsert -- "D:/Desktop/spring.xlsx"              # 干跑，只打印计划
 *   npm run batch:upsert -- "D:/Desktop/spring.xlsx" --write      # 真的写
 *   npm run batch:upsert -- "D:/Desktop/spring.xlsx" --write --hide-new
 *                                                       新商品先以 hidden=true 落库，
 *                                                       前台看不到，补完图再去后台 Unhide
 *
 *   --sheet=Sheet1       读哪一个 sheet（默认第一个）
 *   --conflict=first|last|skip   同键两个 ASIN 时怎么选（默认 first）
 *   --no-alias           关掉 2XL→XXL / navy→Navy Blue 的别名表
 *   --hide-new           （别名 --draft）只把**新建**的商品设为隐藏
 *
 * WHY "DRY BY DEFAULT"
 * ────────────────────
 * The command that gets typed from memory at 11pm is the one without flags. A
 * sheet that points at the wrong column must print numbers, not delete variants,
 * so writing is the thing you have to ask for (`--write`). `--dry-run` still
 * works and is simply the default.
 *
 * WHAT IT PROMISES (and the code enforces)
 * ────────────────────────────────────────
 * · existing products: the UPDATE payload is literally `{ specs }`. name /
 *   category / image / tag / hidden / sort_order are not in it, so they cannot
 *   be overwritten even by accident.
 * · `--hide-new` only ever reaches a row this run INSERTs. There is no code
 *   path where the flag can hide an existing 货号 — the guarantee is the shape
 *   of the payload, not a promise in this comment.
 * · specs: append only. `mergeSpecs` never sorts, never rewrites a spelling,
 *   never removes, never introduces a spec type the product does not have.
 * · asins.variants: merged key by key. A key the sheet never mentions is not in
 *   the payload — it cannot be deleted.
 * · ids: new products get `max + 1`; existing ids are never renumbered and
 *   `sort_order` of an existing product is never written. A post-flight check
 *   reads everything back and says so with numbers.
 * · conflicts are printed, never auto-resolved silently.
 *
 * The parsing/merging itself lives in `asins-import-core.mjs`, shared with
 * `npm run import:asins` — this file is the stricter, seasonal front door.
 */

import { existsSync } from 'node:fs'
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
import {
  VALUE_ALIASES,
  readTable,
  dedupeExact,
  buildVocabulary,
  alignRecords,
  resolveConflicts,
  aggregate,
  nearMisses,
  planProducts,
  mergeVariants,
  formatId,
} from './asins-import-core.mjs'

const args = readArgs()
const ENV_PATH = loadEnv(args.get('env'))
/* Before anything is read, let alone written: does this env file belong to the
 * brand the command names? Cheap when you pass the flag, priceless when you
 * don't notice you are pointed at the other project. */
brandGuard(args)

const FILE = args.positional[0]
const DRY = !args.has('write')
const SHEET = args.get('sheet', '')
const CONFLICT = args.get('conflict', 'first')
const NO_ALIAS = args.has('no-alias')
/* `--draft` is the word that comes to mind when you are uploading a season
 * early; it means the same thing. */
const HIDE_NEW = args.has('hide-new') || args.has('draft')

if (!FILE) {
  die(
    '用法：npm run batch:upsert -- "<文件路径>" [--write] [--hide-new]\n' +
      '                             [--env=.env.brandb] [--expect-brand=brandb]\n' +
      '     表头必须是：货号 | ASIN | 颜色 | 尺寸（每行一个变体）\n' +
      '     --hide-new：新建的货号先设成隐藏，前台看不到（老货号不受影响）\n' +
      '     --env：读哪一份 env（默认 .env）；--expect-brand：品牌对不上就拒绝执行',
  )
}
if (!['first', 'last', 'skip'].includes(CONFLICT)) {
  die(`--conflict=${CONFLICT} 不认识，只能是 first / last / skip`)
}
if (!existsSync(FILE)) die(`找不到文件：${FILE}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 读表
 * ══════════════════════════════════════════════════════════════════════════ */
const workbook = XLSX.readFile(FILE)
const sheetName = SHEET || workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
if (!sheet) die(`工作簿里没有名为 ${sheetName} 的 sheet（有：${workbook.SheetNames.join('、')}）`)

const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
const parsed = readTable(grid)

out('')
out(`  ${process.env.BRAND_NAME || 'Catalogue'} → 批量 upsert`)
printTarget(ENV_PATH)
out(`  文件     ${FILE}`)
out(`  sheet    ${sheetName}`)
out(`  模式     ${DRY ? '干跑 —— 只打印计划，一个字节都不写（加 --write 才落库）' : '写入'}`)
out(`  新商品   ${HIDE_NEW ? '先隐藏（hidden = true）—— 前台看不到，补完图去后台勾选 Unhide' : '直接可见（hidden = false）—— 落库那一刻红人就能看到'}`)
out('')
out('  读表')
out(`    总行数              ${Math.max(0, grid.length - 1)}`)
out(`    空行（已丢弃）      ${parsed.blankRows}`)
out(`    有效数据行          ${parsed.records.length}`)
out(`    被拒绝的行          ${parsed.rejected.length}`)

if (!parsed.headerLooksRight) {
  out('    ⚠ 第一行不像表头（期望：货号 | ASIN | 颜色 | 尺寸），按列序强行读取')
}
if (parsed.rejected.length) {
  out('')
  out('    ✗ 被拒绝的行（不写入）')
  for (const row of parsed.rejected.slice(0, 20)) {
    out(`      第 ${row.row} 行  ${row.reason}  ${JSON.stringify(row.cells)}`)
  }
  if (parsed.rejected.length > 20) out(`      …还有 ${parsed.rejected.length - 20} 行`)
}

const exact = dedupeExact(parsed.records)
out(`    完全重复的行        ${exact.dropped}${exact.dropped ? '（保留第一次出现）' : ''}`)

const asinCased = parsed.records.filter((r) => r.asinCased).length
if (asinCased) out(`    ASIN 小写已转大写    ${asinCased}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 连库，读现状
 * ══════════════════════════════════════════════════════════════════════════ */
const { supabase, url, mode } = await connectAdmin()
out('')
out(`  project  ${url}`)
out(`  身份     ${mode}`)

const { data: dbProducts, error: productsError } = await supabase
  .from('products')
  .select('id, sku, name, category, image, specs, hidden, sort_order')
  .order('sort_order', { ascending: true })
if (productsError) die(`读不到 products —— ${productsError.message}`)

const { data: dbAsins, error: asinsError } = await supabase.from('asins').select('sku, variants')
if (asinsError) die(`读不到 asins —— ${asinsError.message}`)

const currentVariants = new Map(dbAsins.map((row) => [row.sku, row.variants || {}]))
const currentVariantTotal = [...currentVariants.values()].reduce(
  (sum, variants) => sum + Object.keys(variants).length,
  0,
)

const hiddenNow = dbProducts.filter((product) => product.hidden).length
out('')
out('  线上现状')
out(`    products            ${dbProducts.length}${hiddenNow ? `（其中 ${hiddenNow} 个已隐藏）` : '（没有隐藏的）'}`)
out(`    asins 货号           ${dbAsins.length}`)
out(`    变体总数             ${currentVariantTotal}`)

/* 线上已有写法 —— 用来把表里的 `navy` / `2xl` 对齐成目录里的拼法 */
const dbColours = []
const dbSizes = []
for (const product of dbProducts) {
  for (const [type, values] of Object.entries(product.specs || {})) {
    const key = type.toLowerCase()
    const list = Array.isArray(values) ? values : [values]
    if (key.startsWith('col')) dbColours.push(...list)
    else if (key.startsWith('siz')) dbSizes.push(...list)
  }
}

const aliases = NO_ALIAS ? {} : VALUE_ALIASES
const aligned = alignRecords(
  exact.records,
  { colours: buildVocabulary(dbColours), sizes: buildVocabulary(dbSizes) },
  aliases,
)
const reDedupe = dedupeExact(aligned.records)
const resolved = resolveConflicts(reDedupe.records, CONFLICT)
const bySku = aggregate(resolved.records)
const skuList = Object.keys(bySku)
const variantTotal = Object.values(bySku).reduce(
  (sum, variants) => sum + Object.keys(variants).length,
  0,
)

const rewrites = aligned.changes.filter((change) => change.how !== 'new')
const brandNew = aligned.changes.filter((change) => change.how === 'new')

out('')
out('  写法对齐（以线上已有写法为准）')
out(`    颜色词汇 ${buildVocabulary(dbColours).list.length} 种 · 尺寸词汇 ${buildVocabulary(dbSizes).list.length} 种`)
if (rewrites.length) {
  for (const change of rewrites.sort((a, b) => b.count - a.count)) {
    out(`      ${pad(change.field, 4)} ${pad(change.from, 18)} → ${pad(change.to, 18)} ×${change.count}`)
  }
} else {
  out('    改写的写法           0')
}
if (brandNew.length) {
  out('    ⚠ 线上没有的取值（会原样新增）')
  for (const change of brandNew.sort((a, b) => b.count - a.count)) {
    out(`      ${pad(change.field, 4)} ${pad(change.from, 18)} ×${change.count}`)
  }
  const misses = nearMisses(
    brandNew.filter((c) => c.field === '颜色').map((c) => c.from),
    buildVocabulary(dbColours),
  )
  if (misses.length) {
    out('    · 疑似笔误（只提示，不会自动改）')
    for (const miss of misses) out(`      ${pad(miss.value, 18)} ≈ ${miss.candidate}（编辑距离 ${miss.distance}）`)
  }
}

out('')
out('  同键冲突（同一个 货号+颜色+尺寸 对应两个 ASIN）')
if (!resolved.conflicts.length) {
  out('    没有')
} else {
  out(`    ${resolved.conflicts.length} 组 · 策略 ${CONFLICT}`)
  for (const conflict of resolved.conflicts) {
    out(`      ${pad(`${conflict.sku} ${conflict.variant}`, 30)} ${conflict.asins.join(' vs ')}`)
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 计划
 * ══════════════════════════════════════════════════════════════════════════ */
const plan = planProducts(dbProducts, bySku, { hideNew: HIDE_NEW })

const asinPlan = []
const asinTotals = { added: 0, updated: 0, unchanged: 0, kept: 0 }
for (const sku of skuList) {
  const merged = mergeVariants(currentVariants.get(sku) || {}, bySku[sku])
  asinTotals.added += merged.added
  asinTotals.updated += merged.updated
  asinTotals.unchanged += merged.unchanged
  asinTotals.kept += merged.kept
  asinPlan.push({ sku, variants: merged.merged })
}

const specChanges = plan.update.filter((row) => Object.keys(row.added).length > 0)
const ignoredAxes = plan.update.filter((row) => Object.keys(row.ignored || {}).length > 0)

const sheetSkuSet = new Set(skuList)
const untouchedSkuCount = [...currentVariants.keys()].filter((sku) => !sheetSkuSet.has(sku)).length
const untouchedVariantCount = [...currentVariants.entries()]
  .filter(([sku]) => !sheetSkuSet.has(sku))
  .reduce((sum, [, variants]) => sum + Object.keys(variants).length, 0)

out('')
out('  本次')
out(`    货号                 ${skuList.length}`)
out(`    变体键               ${variantTotal}`)
out('')
out('  计划')
out(`    asins 新增           ${asinTotals.added}`)
out(`    asins 改写           ${asinTotals.updated}${asinTotals.updated ? '  ⚠ 已有 ASIN 会被表里的值覆盖' : '  ✓ 没有已有 ASIN 被改写'}`)
out(`    asins 不变           ${asinTotals.unchanged}`)
out(`    asins 保留           ${asinTotals.kept}（表里没提到的键，不进 payload）`)
out(`                         另有 ${untouchedVariantCount} 个变体属于本次没提到的 ${untouchedSkuCount} 个货号，完全不碰`)
out(`    products 新建        ${plan.create.length}${plan.create.length ? `（${plan.create[0].id} … ${plan.create[plan.create.length - 1].id}）` : ''}`)
if (plan.create.length) {
  out(`                         可见性 · ${HIDE_NEW ? 'hidden = true —— 前台看不到' : 'hidden = false —— 落库即可见'}`)
  if (!HIDE_NEW) out('                         ⚠ 还没补图就先上架了？加 --hide-new 重跑一遍（已有商品不会被隐藏）')
}
out(`    products 合并 specs  ${specChanges.length}（只追加，绝不重排）`)

if (plan.create.length) {
  out('')
  out('    新建的占位商品（name = 货号，category = Uncategorised，之后去 /#/admin 补名字和图片）')
  if (HIDE_NEW) out('    全部 hidden = true —— 补完图在后台勾选它们点 Unhide 才会上线')
  for (const row of plan.create) {
    out(`      ${pad(row.id, 6)} ${pad(row.sku, 12)} ${row.variantCount} 个变体${row.hidden ? '  hidden' : ''}`)
  }
}
if (specChanges.length) {
  out('')
  out('    合并进已有商品的 specs')
  for (const row of specChanges) {
    const added = Object.entries(row.added)
      .map(([type, values]) => `${type} +${values.length}（${values.slice(0, 6).join('、')}${values.length > 6 ? '…' : ''}）`)
      .join(' · ')
    out(`      ${pad(row.product.id, 6)} ${pad(row.product.sku, 12)} ${added}`)
  }
}
if (ignoredAxes.length) {
  out('')
  out('    ⚠ 这些商品没有对应的规格维度，取值不会写进 specs（ASIN 仍然照常入库）')
  out('      真要加维度，得在 /#/admin 里手工加 —— 脚本加会让历史选款码错位')
  for (const row of ignoredAxes) {
    const detail = Object.entries(row.ignored)
      .map(([type, values]) => `${type}：${values.slice(0, 5).join('、')}`)
      .join(' · ')
    out(`      ${pad(row.product.id, 6)} ${pad(row.product.sku, 12)} ${detail}`)
  }
}

if (DRY) {
  out('')
  out('  干跑结束 —— 一个字节都没写。确认上面的数字后加 --write 再跑一次。')
  out('')
  process.exit(0)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 写入
 * ══════════════════════════════════════════════════════════════════════════ */
const snapshot = new Map(
  dbProducts.map((product) => [
    product.id,
    {
      name: product.name,
      image: product.image,
      category: product.category,
      hidden: Boolean(product.hidden),
      sortOrder: product.sort_order,
    },
  ]),
)

out('')
out('  写入')

try {
  /* 已有商品：payload 里只有 specs —— 物理上不可能覆盖别的字段 */
  let specsWritten = 0
  for (const row of specChanges) {
    const { error } = await supabase
      .from('products')
      .update({ specs: row.specs })
      .eq('id', row.product.id)
    if (error) die(`更新 ${row.product.id} 的 specs 失败 —— ${error.message}`)
    specsWritten++
  }
  out(`    products 已更新 specs   ${specsWritten}`)

  if (plan.create.length) {
    const rows = plan.create.map(({ variantCount, ...row }) => row)
    for (const slice of chunks(rows)) {
      const { error } = await supabase.from('products').insert(slice)
      if (error) die(`新建商品失败 —— ${error.message}${error.details ? `（${error.details}）` : ''}`)
    }
    out(`    products 已新建         ${rows.length}`)
  }

  const asinRows = asinPlan.map((row) => ({ sku: row.sku, variants: row.variants }))
  for (const slice of chunks(asinRows)) {
    const { error } = await supabase.from('asins').upsert(slice, { onConflict: 'sku' })
    if (error) die(`asins 写入失败 —— ${error.message}${error.details ? `（${error.details}）` : ''}`)
  }
  out(`    asins 已 upsert         ${asinRows.length} 个货号`)
} catch (error) {
  die(error.message)
}

/* 序列对齐：下次从 /#/admin 新建商品不会撞号 */
if (plan.create.length) {
  const { data: seq, error: seqError } = await supabase.rpc('sync_product_id_seq')
  out('')
  if (seqError) {
    out('  ⚠ sync_product_id_seq() 不可用 —— 在 SQL Editor 里跑 supabase/02-import-helpers.sql')
  } else {
    out(`  序列已对齐：下一个新商品是 ${formatId(Number(seq) + 1)}`)
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. 验收 —— 用读回来的数据证明「什么都没被覆盖」
 * ══════════════════════════════════════════════════════════════════════════ */
out('')
out('  验收')

const { data: afterProducts } = await supabase
  .from('products')
  .select('id, sku, name, category, image, specs, hidden, sort_order')
  .order('sort_order', { ascending: true })
const { data: afterAsins } = await supabase.from('asins').select('sku, variants')

const afterVariantTotal = (afterAsins || []).reduce(
  (sum, row) => sum + Object.keys(row.variants || {}).length,
  0,
)

out(`    products            ${(afterProducts || []).length}（之前 ${dbProducts.length}，+${(afterProducts || []).length - dbProducts.length}）`)
out(`    变体总数             ${afterVariantTotal}（之前 ${currentVariantTotal}，+${afterVariantTotal - currentVariantTotal}）`)

/* name / image / category / hidden / sort_order 一个都不能变 */
let clobbered = 0
for (const product of afterProducts || []) {
  const before = snapshot.get(product.id)
  if (!before) continue

  const fields = []
  if (before.name !== product.name) fields.push('name')
  if (before.image !== product.image) fields.push('image')
  if (before.category !== product.category) fields.push('category')
  if (before.hidden !== Boolean(product.hidden)) {
    fields.push(`hidden ${before.hidden}→${Boolean(product.hidden)}`)
  }
  if (Number(before.sortOrder) !== Number(product.sort_order)) fields.push('sort_order')
  if (!fields.length) continue

  clobbered++
  out(`    ✗ ${product.id} 的 ${fields.join(' / ')} 被改动了`)
}
out(
  clobbered === 0
    ? '    ✓ 已有商品的名字、图片、分类、可见状态、排序一个都没动'
    : `    ✗ ${clobbered} 个商品的非 specs 字段被改动`,
)

/* 新建的商品：加 --hide-new 就必须真的藏住了。
 * 这一条是给"我以为藏了、其实已经在卖"准备的 —— 读回来比对，不信写入返回值。 */
if (plan.create.length) {
  const createdIds = new Set(plan.create.map((row) => row.id))
  const created = (afterProducts || []).filter((product) => createdIds.has(product.id))
  const absent = plan.create.length - created.length
  const exposed = created.filter((product) => !product.hidden).map((product) => product.id)

  if (absent) out(`    ✗ ${absent} 个新建商品在库里找不到`)
  if (HIDE_NEW) {
    out(
      !absent && exposed.length === 0
        ? `    ✓ 新建的 ${created.length} 个商品都是隐藏的，前台看不到`
        : `    ✗ ${exposed.length} 个新建商品没有隐藏：${exposed.join('、')}`,
    )
  } else {
    out(
      exposed.length === created.length
        ? `    ✓ 新建的 ${created.length} 个商品已可见（没加 --hide-new，符合预期）`
        : `    ⚠ ${created.length - exposed.length} 个新建商品是隐藏的，跟前台预期不一致`,
    )
  }
}

/* id 没被重新编号：同一个货号必须还是同一个 id */
let renumbered = 0
for (const before of dbProducts) {
  const after = (afterProducts || []).find((row) => row.id === before.id)
  if (!after) {
    renumbered++
    out(`    ✗ ${before.id}（${before.sku}）不见了`)
    continue
  }
  if (String(after.sku) !== String(before.sku)) {
    renumbered++
    out(`    ✗ ${before.id} 的货号从 ${before.sku} 变成了 ${after.sku}`)
  }
}
out(renumbered === 0 ? '    ✓ 所有已有 id 都还在原位，没有重新编号' : `    ✗ ${renumbered} 个 id 出了问题`)

/* 原有变体一个都没丢 */
let lost = 0
for (const [sku, variants] of currentVariants) {
  const row = (afterAsins || []).find((entry) => entry.sku === sku)
  if (!row) {
    lost++
    out(`    ✗ ${sku} 这一行 asins 不见了`)
    continue
  }
  for (const key of Object.keys(variants)) {
    if (!(key in row.variants)) {
      lost++
      out(`    ✗ ${sku} 的变体 ${key} 被删掉了`)
    }
  }
}
out(lost === 0 ? '    ✓ 原有变体一个都没丢' : `    ✗ 丢了 ${lost} 个变体`)

/* specs 键序没变：v4 选码靠它定位 */
const { data: probe } = await supabase
  .from('products')
  .select('id, specs')
  .eq('id', dbProducts[0]?.id || 'p001')
  .maybeSingle()

if (probe && dbProducts[0]) {
  const before = Object.keys(dbProducts[0].specs || {}).join(',')
  const after = Object.keys(probe.specs || {}).join(',')
  out(before === after ? `    ✓ specs 键序没变（${after}）` : `    ✗ specs 键序变了：${before} → ${after}`)
}

out('')
if (HIDE_NEW && plan.create.length) {
  out(`  完成。${plan.create.length} 个新货号已隐藏入库，前台看不到。`)
  out('  去 /#/admin 补名字、分类、图片，弄好以后勾选它们 → Unhide 上线。')
} else {
  out('  完成。新增货号记得去 /#/admin 补名字、分类和图片。')
}
out('')
