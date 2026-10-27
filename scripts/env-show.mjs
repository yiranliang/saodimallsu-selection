/**
 * Which database is this checkout pointing at?
 * ═════════════════════════════════════════════
 *
 *   npm run env:show
 *   npm run env:show -- --env=.env.brandb
 *
 * Run this before any import. It answers three questions in five seconds:
 *
 *   1. which env file was actually read (not which one you think you edited)
 *   2. which project host that file points at
 *   3. what is in there right now — row counts and three real 货号
 *
 * Step 3 is the important one. Two Supabase projects look identical in a
 * dashboard; three 货号 do not. If the numbers or the 货号 are not what you
 * expect, stop — the next command writes.
 *
 * Read-only. It signs in (so RLS is exercised exactly like a real write would
 * be) and issues nothing but `select count` and a three-row sample.
 */

import { loadEnv, readArgs, printTarget, connectAdmin, die, out, projectHost } from './cli-common.mjs'

const args = readArgs()
const envPath = loadEnv(args.get('env'))

out('')
out('  Supabase 目标')
printTarget(envPath)
out('')

const { supabase, mode } = await connectAdmin()
out(`  凭据     ${mode}`)

const counted = async (table, column = '*', head = true) => {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head })
  if (error) return `读取失败（${error.message}）`
  return count ?? 0
}

const products = await counted('products', 'id')
const asins = await counted('asins', 'sku')
const categories = await counted('categories', 'name')

out('')
out('  现在有什么')
out(`    products     ${products} 行`)
out(`    asins        ${asins} 行（每行一个货号，变体在 variants 里）`)
out(`    categories   ${categories} 行`)

const { data: sample, error: sampleError } = await supabase
  .from('products')
  .select('sku, name')
  .order('sort_order', { ascending: true })
  .limit(3)

out('')
if (sampleError) {
  out(`  样本     读取失败（${sampleError.message}）`)
} else if (!sample?.length) {
  out('  样本     （空表 —— 还没导入过商品）')
} else {
  out('  前 3 个货号（认品牌用）')
  for (const row of sample) out(`    ${row.sku || '—'}  ${row.name || ''}`)
}

/* The one thing that turns "I think this is the right project" into a check. */
const slug = String(process.env.BRAND_SLUG || '').trim()
out('')
if (!slug) {
  out('  ⚠ 这个 env 文件没有 BRAND_SLUG，--expect-brand=… 用不了。')
  out('    在文件里加一行：BRAND_SLUG=你的品牌标识')
} else {
  out(`  ✓ BRAND_SLUG=${slug} —— 写入脚本可以加 --expect-brand=${slug} 做二次核对`)
}

if (!products) {
  out('')
  out('  ⚠ products 是空表。新项目要先跑 supabase/01-schema.sql 等脚本，')
  out('    否则导入会因为没有列而失败（脚本会提示缺哪个）。')
}

if (!projectHost()) die('VITE_SUPABASE_URL 缺失')
out('')
process.exit(0)
