#!/usr/bin/env node
/**
 * Incremental ASIN / 货号 import
 * ═══════════════════════════════
 *
 *   node scripts/import-asins.mjs <file.xlsx>              # 真正写入
 *   node scripts/import-asins.mjs <file.xlsx> --dry-run    # 只看计划，不写
 *   node scripts/import-asins.mjs <file.xlsx> --conflict=last
 *   node scripts/import-asins.mjs <file.xlsx> --only=asins
 *   node scripts/import-asins.mjs <file.xlsx> --no-alias
 *   node scripts/import-asins.mjs <file.xlsx> --json=out.json
 *
 * WHY NOT push-supabase.mjs
 * ─────────────────────────
 * That script mirrors `src/data/products.js` onto the cloud: every product row
 * is upserted whole, so name / category / image are whatever the shipped file
 * says. Correct for the first import; destructive once ops has spent weeks
 * filling those in through /#/admin.
 *
 * This one is additive by construction:
 *   asins    → variants merged key by key. A key the sheet never mentions is
 *              not in the payload at all, so it cannot be deleted.
 *   products → existing 货号 get `specs` updated and NOTHING else (the update
 *              payload is literally `{ specs }`); new 货号 are inserted with
 *              name = 货号 and category = Uncategorised.
 *
 * WHAT IT WILL NOT DO
 * ───────────────────
 * · delete a product, a variant or an ASIN
 * · reorder or remove an option inside `specs` — a v4 code stores option
 *   *indexes*, so reordering silently re-points codes already sent out
 * · touch `sort_order` on an existing product — legacy codes store the
 *   product's position too
 * · guess which of two ASINs for the same colour+size is the right one
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import XLSX from 'xlsx'

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

/* ── tiny .env reader (same behaviour as push-supabase.mjs) ─────────────── */
function loadEnv() {
  /* ENV_FILE lets one checkout serve two brands — see scripts/cli-common.mjs */
  const path = resolve(process.cwd(), process.env.ENV_FILE || '.env')
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv()

/* ── args ───────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const valueOf = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const FILE = argv.find((a) => !a.startsWith('--'))
const DRY = flag('--dry-run') || flag('-n')
const CONFLICT = valueOf('conflict', 'first')
const SHEET = valueOf('sheet', '')
const JSON_OUT = valueOf('json', 'scripts/out/asins-import.json')
const NO_ALIAS = flag('--no-alias')
const ONLY = (() => {
  const raw = valueOf('only', '')
  if (!raw) return new Set(['asins', 'products'])
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
})()

const CHUNK = 100
const out = (text = '') => console.log(text)
const pad = (text, width) => String(text).padEnd(width)

function die(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!FILE) {
  die(
    '用法：node scripts/import-asins.mjs <file.xlsx> [--dry-run]\n' +
      '     表头必须是：货号 | ASIN | 颜色 | 尺寸',
  )
}
if (!['first', 'last', 'skip'].includes(CONFLICT)) {
  die(`--conflict=${CONFLICT} 不认识，只能是 first / last / skip`)
}

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.env.SUPABASE_ADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_ADMIN_PASSWORD

if (!URL || !ANON) {
  die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 缺失，检查项目根目录的 .env')
}
if (!SERVICE && !(EMAIL && PASSWORD)) {
  die(
    '没有可写入的凭据。二选一：\n\n' +
      '  A) 推荐 —— 用管理员账号登录（也顺带验证 RLS 真的在工作），.env 里加：\n' +
      '       SUPABASE_ADMIN_EMAIL=ops@yourbrand.com\n' +
      '       SUPABASE_ADMIN_PASSWORD=your-password\n\n' +
      '  B) service role，.env 里加：\n' +
      '       SUPABASE_SERVICE_ROLE_KEY=eyJ…\n' +
      '     （绕过 RLS，别提交进仓库）',
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 读表
 * ══════════════════════════════════════════════════════════════════════════ */
if (!existsSync(FILE)) die(`找不到文件：${FILE}`)

const workbook = XLSX.readFile(FILE)
const sheetName = SHEET || workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
if (!sheet) die(`工作簿里没有名为 ${sheetName} 的 sheet（有：${workbook.SheetNames.join('、')}）`)

const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
const parsed = readTable(grid)

out('')
out('Saodimallsu → 增量 ASIN 导入')
out(`  文件     ${FILE}`)
out(`  sheet    ${sheetName}${workbook.SheetNames.length > 1 ? `（另有 ${workbook.SheetNames.length - 1} 个 sheet 未读）` : ''}`)
out(`  project  ${URL}`)
out(`  模式     ${DRY ? 'dry run —— 只打印计划，不写任何数据' : SERVICE ? 'service role（绕过 RLS）' : `管理员登录 ${EMAIL}`}`)
out(`  参数     conflict=${CONFLICT}${NO_ALIAS ? ' · 不做别名' : ''} · only=${[...ONLY].join(',')}`)

out('')
out('  读表')
out(`    sheet 总行数        ${grid.length - 1}`)
out(`    空行（已丢弃）      ${parsed.blankRows}`)
out(`    有效数据行          ${parsed.records.length}`)
out(`    被拒绝的行          ${parsed.rejected.length}`)

if (!parsed.headerLooksRight) {
  out('')
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

/* 精确重复：四列完全相同 */
const exact = dedupeExact(parsed.records)
out(`    完全重复的行        ${exact.dropped}${exact.dropped ? '（保留第一次出现）' : ''}`)

const asinCased = parsed.records.filter((r) => r.asinCased).length
if (asinCased) out(`    ASIN 小写已转大写    ${asinCased}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 连库，读出「现有词汇表」
 * ══════════════════════════════════════════════════════════════════════════ */
const supabase = createClient(URL, SERVICE || ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

if (!SERVICE) {
  out('')
  out('  登录')
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error) die(`登录失败 —— ${error.message}`)

  const { data: me, error: meError } = await supabase.from('admin_users').select('email')
  if (meError) die(`读不到 admin_users —— ${meError.message}`)
  if (!me || me.length === 0) die('登录成功，但这个账号不在 public.admin_users 里，所有写入都会被 RLS 拒绝')
  out(`    ✓ ${me[0].email}`)
}

const { data: dbProducts, error: productsError } = await supabase
  .from('products')
  .select('id, sku, name, category, image, specs, sort_order')
  .order('sort_order', { ascending: true })

if (productsError) die(`读不到 products —— ${productsError.message}`)

const { data: dbAsins, error: asinsError } = await supabase.from('asins').select('sku, variants')
if (asinsError) die(`读不到 asins —— ${asinsError.message}`)

const currentVariants = new Map(dbAsins.map((row) => [row.sku, row.variants || {}]))
const currentVariantTotal = [...currentVariants.values()].reduce(
  (sum, variants) => sum + Object.keys(variants).length,
  0,
)

out('')
out('  线上现状')
out(`    products            ${dbProducts.length}`)
out(`    asins 货号           ${dbAsins.length}`)
out(`    变体总数             ${currentVariantTotal}`)

/* 现有词汇表：所有商品的 Colour / Size 取值 */
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

const colourVocab = buildVocabulary(dbColours)
const sizeVocab = buildVocabulary(dbSizes)

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 对齐写法
 * ══════════════════════════════════════════════════════════════════════════ */
const aliases = NO_ALIAS ? {} : VALUE_ALIASES
const aligned = alignRecords(exact.records, { colours: colourVocab, sizes: sizeVocab }, aliases)

/* 对齐之后可能又冒出新的完全重复（2XL 与 XXL 落到同一个键） */
const reDedupe = dedupeExact(aligned.records)
const afterAlignDropped = reDedupe.dropped

out('')
out('  写法对齐（以线上已有写法为准）')
out(`    颜色词汇             ${colourVocab.list.length} 种`)
out(`    尺寸词汇             ${sizeVocab.list.length} 种`)

const rewrites = aligned.changes.filter((c) => c.how !== 'new')
const brandNew = aligned.changes.filter((c) => c.how === 'new')

if (rewrites.length) {
  out('')
  out('    改写的写法')
  for (const change of rewrites.sort((a, b) => b.count - a.count)) {
    // `alias` used to be labelled 尺寸别名 unconditionally, which read as
    // nonsense the first time a *colour* alias fired (`Navy → Navy Blue`).
    // The label follows the field the change actually happened on.
    const how = {
      case: '大小写',
      punctuation: '空格/符号',
      alias: change.field === '颜色' ? '颜色别名' : '尺寸别名',
    }[change.how] || change.how
    out(`      ${pad(change.field, 4)} ${pad(change.from, 20)} → ${pad(change.to, 20)} ${how}  ×${change.count}`)
  }
} else {
  out('    改写的写法           0（全部已经是线上写法）')
}

if (afterAlignDropped) {
  out(`    对齐后重复           ${afterAlignDropped}（同一个键的两种写法合并）`)
}

if (brandNew.length) {
  out('')
  out('    ⚠ 线上没有的取值 —— 会原样新增')
  for (const change of brandNew.sort((a, b) => b.count - a.count)) {
    out(`      ${pad(change.field, 4)} ${pad(change.from, 20)} ×${change.count}`)
  }

  /* Only colours. Numeric sizes legitimately sit one character apart
   * (`14` vs `140`, `8` vs `S`), so suggesting there is pure noise. */
  const misses = nearMisses(
    brandNew.filter((c) => c.field === '颜色').map((c) => c.from),
    colourVocab,
  )
  if (misses.length) {
    out('')
    out('    · 疑似笔误（只提示，不会自动改）')
    for (const miss of misses) {
      out(`      ${pad(miss.value, 20)} ≈ ${miss.candidate}  （编辑距离 ${miss.distance}）`)
    }
  }
} else {
  out('    线上没有的取值       0')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 同键冲突
 * ══════════════════════════════════════════════════════════════════════════ */
const resolved = resolveConflicts(reDedupe.records, CONFLICT)

out('')
out('  同键冲突（同一个 货号+颜色+尺寸 对应两个 ASIN）')
if (!resolved.conflicts.length) {
  out('    没有')
} else {
  out(`    ${resolved.conflicts.length} 组 · 处理策略 = ${CONFLICT}`)
  for (const conflict of resolved.conflicts) {
    const [first, ...rest] = conflict.asins
    const others = rest.map((asin, i) => `${asin}（第 ${conflict.rows[i + 1]} 行）`).join(' vs ')
    const winner = CONFLICT === 'skip' ? '跳过' : CONFLICT === 'last' ? rest[rest.length - 1] : first
    out(`      ${pad(`${conflict.sku} ${conflict.variant}`, 30)} ${first}（第 ${conflict.rows[0]} 行） vs ${others}`)
    out(`      ${' '.repeat(30)} → ${winner}`)
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. 聚合成 { 货号: { "颜色|尺寸": "ASIN" } }
 * ══════════════════════════════════════════════════════════════════════════ */
const bySku = aggregate(resolved.records)
const skuList = Object.keys(bySku)
const variantTotal = Object.values(bySku).reduce((sum, variants) => sum + Object.keys(variants).length, 0)

out('')
out('  聚合结果')
out(`    货号                 ${skuList.length}`)
out(`    变体键               ${variantTotal}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 6. 计划
 * ══════════════════════════════════════════════════════════════════════════ */
const plan = planProducts(dbProducts, bySku)

const asinPlan = []
const totals = { added: 0, updated: 0, unchanged: 0, kept: 0 }
for (const sku of skuList) {
  const current = currentVariants.get(sku) || {}
  const merged = mergeVariants(current, bySku[sku])
  totals.added += merged.added
  totals.updated += merged.updated
  totals.unchanged += merged.unchanged
  totals.kept += merged.kept
  asinPlan.push({ sku, variants: merged.merged, stats: merged })
}

const specChanges = plan.update.filter((row) => Object.keys(row.added).length > 0)
const ignoredAxes = plan.update.filter((row) => Object.keys(row.ignored || {}).length > 0)

/* Variants belonging to 货号 this sheet never mentions. They are not in the
 * payload at all — the strongest form of "not touched". */
const sheetSkuSet = new Set(skuList)
const untouchedSkuVariants = [...currentVariants.entries()]
  .filter(([sku]) => !sheetSkuSet.has(sku))
  .reduce((sum, [, variants]) => sum + Object.keys(variants).length, 0)
const untouchedSkuCount = [...currentVariants.keys()].filter((sku) => !sheetSkuSet.has(sku)).length

out('')
out('  计划')
if (ONLY.has('asins')) {
  out(`    asins                ${skuList.length} 个货号 / ${variantTotal} 个变体键`)
  out(`                         新增 ${totals.added} · 改写 ${totals.updated} · 不变 ${totals.unchanged}`)
  out(
    `                         线上 ${currentVariantTotal} 个变体全部保留：` +
      `${untouchedSkuVariants} 个属于本次没提到的 ${untouchedSkuCount} 个货号，` +
      `${totals.kept} 个属于表里没提到的键`,
  )
  if (totals.updated === 0) {
    out('                         ✓ 没有任何已有 ASIN 会被改写')
  } else {
    out(`                         ⚠ ${totals.updated} 个已有 ASIN 会被覆盖成表里的值`)
  }
}
if (ONLY.has('products')) {
  out(`    products 新建        ${plan.create.length}${plan.create.length ? `（${plan.create[0].id} … ${plan.create[plan.create.length - 1].id}）` : ''}`)
  out(`    products 合并 specs  ${specChanges.length}（只加不删，绝不重排）`)
  if (plan.update.length - specChanges.length > 0) {
    out(`    products 无需改动    ${plan.update.length - specChanges.length}（specs 已经覆盖表里的取值）`)
  }
}

if (plan.create.length) {
  out('')
  out('    新建的占位商品（name = 货号，category = Uncategorised，之后去 /#/admin 补名字和图片）')
  for (const row of plan.create) {
    out(`      ${pad(row.id, 6)} ${pad(row.sku, 10)} ${pad(`${row.variantCount} 个变体`, 12)} ${Object.entries(row.specs).map(([t, v]) => `${t} ${v.length}`).join(' · ')}`)
  }
}

if (specChanges.length) {
  out('')
  out('    合并进已有商品的 specs')
  for (const row of specChanges) {
    const added = Object.entries(row.added).map(([type, values]) => `${type} +${values.length}（${values.slice(0, 6).join('、')}${values.length > 6 ? '…' : ''}）`).join(' · ')
    out(`      ${pad(row.product.id, 6)} ${pad(row.product.sku, 10)} ${added}`)
  }
}

if (ignoredAxes.length) {
  out('')
  out('    ⚠ 这些商品没有对应的规格维度，取值不会写进 specs（ASIN 仍然照常入库）')
  out('      真要加维度，得在 /#/admin 里手工加 —— 脚本加会让历史选款码错位')
  for (const row of ignoredAxes) {
    const detail = Object.entries(row.ignored).map(([type, values]) => `${type}：${values.slice(0, 5).join('、')}`).join(' · ')
    out(`      ${pad(row.product.id, 6)} ${pad(row.product.sku, 10)} ${detail}`)
  }
}

/* ── 写出聚合 JSON（无论 dry-run 与否都写，方便核对） ─────────────────── */
try {
  const jsonPath = resolve(process.cwd(), JSON_OUT)
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(bySku, null, 2)}\n`, 'utf8')
  out('')
  out(`  聚合 JSON 已写出：${JSON_OUT}（${skuList.length} 个货号）`)
} catch (error) {
  out('')
  out(`  ⚠ 聚合 JSON 写出失败：${error.message}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. 写入
 * ══════════════════════════════════════════════════════════════════════════ */
if (DRY) {
  out('')
  out('  dry run —— 一个字节都没写。去掉 --dry-run 再跑一次就会真正落库。')
  out('')
  process.exit(0)
}

/* 写入前留一份快照，写完用它证明「名字和图片没被动过」 */
const snapshot = new Map(dbProducts.map((p) => [p.id, { name: p.name, image: p.image, category: p.category }]))

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).upsert(slice, { onConflict })
    if (error) die(`${table} 写入失败 —— ${error.message}${error.details ? `（${error.details}）` : ''}`)
  }
}

try {
  out('')
  out('  写入')

  if (ONLY.has('products')) {
    /* 已有商品：payload 里只有 specs，物理上不可能覆盖 name / image / category */
    let touched = 0
    for (const row of specChanges) {
      const { error } = await supabase.from('products').update({ specs: row.specs }).eq('id', row.product.id)
      if (error) die(`更新 ${row.product.id} 的 specs 失败 —— ${error.message}`)
      touched++
    }
    out(`    products 已更新 specs   ${touched}`)

    if (plan.create.length) {
      const rows = plan.create.map(({ variantCount, ...row }) => row)
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from('products').insert(rows.slice(i, i + CHUNK))
        if (error) die(`新建商品失败 —— ${error.message}${error.details ? `（${error.details}）` : ''}`)
      }
      out(`    products 已新建         ${rows.length}`)
    }
  }

  if (ONLY.has('asins')) {
    const rows = asinPlan.map((row) => ({ sku: row.sku, variants: row.variants }))
    await upsert('asins', rows, 'sku')
    out(`    asins 已 upsert         ${rows.length} 个货号`)
  }
} catch (error) {
  die(error.message)
}

/* ── 序列对齐：下次从 /#/admin 新建商品不会撞号 ─────────────────────────── */
if (ONLY.has('products') && plan.create.length) {
  const { data: seq, error: seqError } = await supabase.rpc('sync_product_id_seq')
  out('')
  if (seqError) {
    out('  ⚠ sync_product_id_seq() 不可用 —— 在 SQL Editor 里跑 supabase/02-import-helpers.sql')
    out(`     或者手动：select setval('public.products_id_seq', (select max(substring(id from 2)::int) from public.products), true);`)
  } else {
    out(`  序列已对齐：下一个新商品是 ${formatId(Number(seq) + 1)}`)
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. 验收
 * ══════════════════════════════════════════════════════════════════════════ */
out('')
out('  验收')

const { data: afterProducts } = await supabase
  .from('products')
  .select('id, sku, name, category, image, specs')
  .order('sort_order', { ascending: true })
const { data: afterAsins } = await supabase.from('asins').select('sku, variants')

const afterVariantTotal = afterAsins.reduce((sum, row) => sum + Object.keys(row.variants || {}).length, 0)

out(`    products            ${afterProducts.length}（导入前 ${dbProducts.length}，+${afterProducts.length - dbProducts.length}）`)
out(`    变体总数             ${afterVariantTotal}（导入前 ${currentVariantTotal}，+${afterVariantTotal - currentVariantTotal}）`)

let clobbered = 0
for (const product of afterProducts) {
  const before = snapshot.get(product.id)
  if (!before) continue
  if (before.name !== product.name || before.image !== product.image || before.category !== product.category) {
    clobbered++
    out(`    ✗ ${product.id} 的 name/image/category 被改动了`)
  }
}
out(clobbered === 0 ? '    ✓ 已有商品的名字、图片、分类一个都没动' : `    ✗ ${clobbered} 个商品的非 specs 字段被改动`)

let lost = 0
for (const [sku, variants] of currentVariants) {
  const now = afterAsins.find((row) => row.sku === sku)
  if (!now) {
    lost++
    out(`    ✗ ${sku} 这一行 asins 不见了`)
    continue
  }
  for (const key of Object.keys(variants)) {
    if (!(key in now.variants)) {
      lost++
      out(`    ✗ ${sku} 的变体 ${key} 被删掉了`)
    }
  }
}
out(lost === 0 ? '    ✓ 原有变体一个都没丢' : `    ✗ 丢了 ${lost} 个变体`)

/* 抽样：表里的每个键都真的落库了，且 ASIN 对得上 */
let wrong = 0
for (const [sku, variants] of Object.entries(bySku)) {
  const now = afterAsins.find((row) => row.sku === sku)
  if (!now) {
    wrong++
    continue
  }
  for (const [key, asin] of Object.entries(variants)) {
    if (now.variants[key] !== asin) {
      wrong++
      if (wrong <= 5) out(`    ✗ ${sku} ${key} 期望 ${asin}，实际 ${now.variants[key]}`)
    }
  }
}
out(wrong === 0 ? `    ✓ 表里 ${variantTotal} 个键全部落库且 ASIN 一致` : `    ✗ ${wrong} 个键与表格不一致`)

/* 规格索引没被动过：v4 码靠它解码 */
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
out('  完成。去 /#/admin 抽查两三个新建货号，补名字、分类和图片。')
out('')
