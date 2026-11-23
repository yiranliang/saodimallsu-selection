import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 现状：有多少商品的成员表里还留着"不是当前主分类"的行 */
const { data: members } = await db.from('product_categories').select('product_id, category')
const { data: products } = await db.from('products').select('id, sku, category')
const byId = new Map((products || []).map((p) => [p.id, p]))

const multi = new Map()
for (const row of members || []) {
  if (!multi.has(row.product_id)) multi.set(row.product_id, [])
  multi.get(row.product_id).push(row.category)
}

let staleCount = 0
const samples = []
for (const [id, cats] of multi) {
  const product = byId.get(id)
  if (!product) continue
  const others = cats.filter((c) => c !== product.category)
  if (others.length) {
    staleCount += 1
    if (samples.length < 5) samples.push(`${product.sku}: 主=${product.category} 额外=${others.join(',')}`)
  }
}
console.log('有额外归属的商品数:', staleCount)
console.log('样例:', samples.join(' | '))
