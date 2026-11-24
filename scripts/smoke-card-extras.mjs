import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 找一件有"同时归入"的商品 */
const { data: members } = await db.from('product_categories').select('product_id, category')
const { data: products } = await db.from('products').select('id, sku, category, name').limit(2000)
const byId = new Map(products.map((p) => [p.id, p]))
const withExtra = (members || []).find((row) => {
  const product = byId.get(row.product_id)
  return product && product.category !== row.category
})
const target = byId.get(withExtra.product_id)
console.log('测试商品:', target.sku, '主=', target.category, '额外=', withExtra.category)

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
  await page.waitForTimeout(3800)
}

await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('input[placeholder*="搜索货号"]').first().fill(target.sku)
await page.waitForTimeout(1800)
await page.screenshot({ path: 'shots/card-extra-category.png' })

const text = await page.locator('body').innerText()
const idx = text.indexOf(target.sku)
console.log('卡片文本:', text.slice(idx, idx + 120).replace(/\n/g, ' | '))
console.log('出现「+ 额外分类」:', text.includes(`+ ${withExtra.category}`))
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
