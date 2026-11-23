import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
await db.auth.signInWithPassword({
  email: pick('SUPABASE_ADMIN_EMAIL'),
  password: pick('SUPABASE_ADMIN_PASSWORD'),
})
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const countRows = async (label) => {
  const { data } = await db.from('product_categories').select('product_id, category, created_at')
  const times = (data || []).map((r) => Date.parse(r.created_at))
  const min = times.length ? Math.min(...times) : 0
  const backfill = (data || []).filter((r) => Date.parse(r.created_at) <= min + 2000).length
  console.log(`${label}: 总 ${data.length} 行，回填簇 ${backfill} 行`)
  return data.length
}

await countRows('清理前')

/* 找一件"有回填行、但没有手动额外归属"的商品，模拟用户改分类 */
const { data: products } = await db.from('products').select('id, sku, category').limit(2000)
const { data: members } = await db.from('product_categories').select('product_id, category, created_at')
const times = (members || []).map((r) => Date.parse(r.created_at))
const min = Math.min(...times)
const backfillRows = (members || []).filter((r) => Date.parse(r.created_at) <= min + 2000)
const targetId = backfillRows[0]?.product_id
const target = products.find((p) => p.id === targetId)
console.log('测试商品:', target.sku, '主=', target.category)

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
  await page.waitForTimeout(4000)
}

/* 打开商品库会触发一次加载 → 回填行应被清掉 */
await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await countRows('进后台后')

await page.locator('input[placeholder*="搜索货号"]').first().fill(target.sku)
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit"]').first().click()
await page.waitForTimeout(2200)

const editorText = await page.locator('body').innerText()
const idx = editorText.indexOf('同时归入')
console.log('打开时「同时归入」:', editorText.slice(idx, idx + 50).replace(/\n/g, ' | '))

const newCategory = target.category === 'Pullover' ? 'Tank tops' : 'Pullover'
await page.selectOption('select[aria-label="Category"]', newCategory)
await page.waitForTimeout(300)
await page.locator('button', { hasText: '保存修改' }).first().click()
await page.waitForTimeout(3500)
await browser.close()

const { data: after } = await db
  .from('product_categories')
  .select('category')
  .eq('product_id', target.id)
const { data: afterProduct } = await db.from('products').select('category').eq('id', target.id).maybeSingle()
console.log('保存后: 主=', afterProduct.category, '成员=', (after || []).map((r) => r.category).join(',') || '空')
await countRows('保存后')

/* 还原 */
await db.from('products').update({ category: target.category }).eq('id', target.id)
console.log('已还原主分类')
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
