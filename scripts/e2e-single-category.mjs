import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const { data: products } = await db.from('products').select('id, sku, category').order('sku')
const { data: members } = await db.from('product_categories').select('product_id')

const withMembers = new Set((members || []).map((r) => r.product_id))
const target = products.find((p) => !withMembers.has(p.id))
console.log('测试商品:', target.sku, '主=', target.category)

const TARGET_CATEGORY = target.category === 'Pullover' ? 'Tank tops' : 'Pullover'

const read = async (label) => {
  const { data: p } = await db.from('products').select('category').eq('id', target.id).maybeSingle()
  const { data: m } = await db.from('product_categories').select('category').eq('product_id', target.id)
  console.log(`${label}: 主=${p.category} 成员=${(m || []).map((r) => r.category).join(',') || '空'}`)
}
await read('改前')

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
await page.locator('input[placeholder*="搜索货号"]').first().fill(target.sku)
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit"]').first().click()
await page.waitForTimeout(2200)

await page.selectOption('select[aria-label="Category"]', TARGET_CATEGORY)
await page.waitForTimeout(400)
await page.locator('button', { hasText: '保存修改' }).first().click()
await page.waitForTimeout(3500)

/* 关掉编辑器，用新分类筛选，看商品是否在里面 */
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
await page.locator('input[placeholder*="搜索货号"]').first().fill('')
await page.waitForTimeout(600)
await page.locator('button[aria-label="Filter by category"]').first().click()
await page.waitForTimeout(400)
await page.locator('button').filter({ hasText: TARGET_CATEGORY }).last().click()
await page.waitForTimeout(1500)
const filtered = await page.locator('body').innerText()
console.log(`筛选 ${TARGET_CATEGORY} 后能看到该商品:`, filtered.includes(target.sku))
await page.screenshot({ path: 'shots/single-cat-after.png' })
await browser.close()

await read('改后')
await db.from('products').update({ category: target.category }).eq('id', target.id)
console.log('已还原为', target.category)
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
