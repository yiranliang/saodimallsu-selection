import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 找一件干净商品（无额外归属） */
const { data: products } = await db.from('products').select('id, sku, category').order('sku')
const { data: members } = await db.from('product_categories').select('product_id')
const withMembers = new Set((members || []).map((r) => r.product_id))
const target = products.find((p) => !withMembers.has(p.id))
const NEW_CATEGORY = target.category === 'Pullover' ? 'Tank tops' : 'Pullover'
console.log('测试商品:', target.sku, '主=', target.category, '→', NEW_CATEGORY)

const read = async (label) => {
  const { data: p } = await db.from('products').select('category').eq('id', target.id).maybeSingle()
  const { data: m } = await db.from('product_categories').select('category').eq('product_id', target.id)
  console.log(`${label}: 主=${p.category} 成员=${(m || []).map((r) => r.category).join(',') || '空'}`)
}

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
await page.locator('input[type="checkbox"]').nth(1).check({ force: true })
await page.waitForTimeout(300)
await page.locator('button', { hasText: '批量分类' }).first().click()
await page.waitForTimeout(600)

/* 目标分类 */
await page.locator('button[aria-label="批量分类目标"]').first().click()
await page.waitForTimeout(400)
await page.locator('button').filter({ hasText: NEW_CATEGORY }).last().click()
await page.waitForTimeout(400)

/* 没有选动作时按钮应是禁用的 */
const applyDisabled = await page.locator('button', { hasText: /移动 1 件|把 1 件/ }).first().isDisabled()
console.log('未选动作时按钮禁用:', applyDisabled)

/* 选「改写主分类」 */
await page.locator('label', { hasText: '改写主分类' }).first().click()
await page.waitForTimeout(400)
const summary = await page.locator('body').innerText()
const line = summary.split('\n').find((t) => t.startsWith('将执行：'))
console.log('摘要:', line)

await page.locator('button', { hasText: /把 1 件改成/ }).first().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: 'shots/batch-mode.png' })
await browser.close()

await read('批量「改写主分类」之后')
await db.from('products').update({ category: target.category }).eq('id', target.id)
console.log('已还原为', target.category)
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
