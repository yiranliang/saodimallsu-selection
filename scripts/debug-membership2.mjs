import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))

const { data: products } = await db
  .from('products')
  .select('id, sku, category')
  .order('sku')
  .limit(2000)
const { data: members } = await db.from('product_categories').select('product_id, category')

const byProduct = new Map()
for (const row of members || []) {
  if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, [])
  byProduct.get(row.product_id).push(row.category)
}

const counts = new Map()
for (const p of products || []) counts.set(p.category, (counts.get(p.category) || 0) + 1)

console.log('分类与主分类数量（前 20）:')
;[...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([name, n]) => console.log(`  ${name}: ${n}`))

/* 有多少商品"主分类"与"成员表"完全一致（干净） */
let clean = 0
for (const p of products || []) {
  const rows = byProduct.get(p.id) || []
  if (rows.length === 0 || (rows.length === 1 && rows[0] === p.category)) clean += 1
}
console.log('干净商品（无额外归属）:', clean, '/', (products || []).length)

const sample = (products || []).find((p) => (byProduct.get(p.id) || []).length === 0)
console.log('可测试商品:', sample?.sku, sample?.category)
