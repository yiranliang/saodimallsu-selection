import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const { error: authError } = await db.auth.signInWithPassword({
  email: pick('SUPABASE_ADMIN_EMAIL'),
  password: pick('SUPABASE_ADMIN_PASSWORD'),
})
if (authError) throw new Error(`数据库登录失败：${authError.message}`)
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const SKU = 'C9Q496'
const { data: product } = await db.from('products').select('id, category').eq('sku', SKU).maybeSingle()
console.log('商品:', SKU, '主=', product.category)

/* 人为制造"历史脏行"：成员表里写一行与主分类相同的记录 */
await db.from('product_categories').delete().eq('product_id', product.id)
const { error: insertError } = await db
  .from('product_categories')
  .insert({ product_id: product.id, category: product.category })
if (insertError) throw new Error(`制造脏数据失败：${insertError.message}`)

const read = async (label) => {
  const { data: p } = await db.from('products').select('category').eq('id', product.id).maybeSingle()
  const { data: m } = await db.from('product_categories').select('category').eq('product_id', product.id)
  console.log(`${label}: 主=${p.category} 成员=${(m || []).map((r) => r.category).join(',') || '空'}`)
}
await read('脏数据准备完')

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/#/admin', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
if (await page.locator('text=Admin access').count()) {
  await page.locator('input[type="email"]').fill(pick('SUPABASE_ADMIN_EMAIL'))
  await page.locator('input[type="password"]').fill(pick('SUPABASE_ADMIN_PASSWORD'))
  await page.locator('button', { hasText: /Sign in/ }).first().click()
  await page.waitForTimeout(3500)
}

await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('input[placeholder*="搜索货号"]').first().fill(SKU)
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit"]').first().click()
await page.waitForTimeout(2200)

const targetCategory = product.category === 'Pullover' ? 'Tank tops' : 'Pullover'
await page.selectOption('select[aria-label="Category"]', targetCategory)
await page.waitForTimeout(400)
await page.locator('button', { hasText: '保存修改' }).first().click()
await page.waitForTimeout(3500)
await browser.close()

await read('改分类并保存后')

/* 还原 */
await db.from('products').update({ category: product.category }).eq('id', product.id)
await db.from('product_categories').delete().eq('product_id', product.id)
await db.from('product_categories').insert({ product_id: product.id, category: product.category })
console.log('已还原')
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
