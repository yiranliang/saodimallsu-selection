import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 找一件主分类是 Sweater 的商品 */
const { data: candidates } = await db
  .from('products')
  .select('id, sku, category')
  .eq('category', 'Sweater')
  .limit(1)

const target = candidates?.[0]
if (!target) throw new Error('没有 Sweater 商品可测')
console.log('测试商品:', target.sku, '当前主分类 =', target.category)

const readNow = async () => {
  const { data } = await db.from('products').select('category').eq('id', target.id).maybeSingle()
  return data?.category
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

/* 目标分类选 Tops */
await page.locator('button[aria-label="批量分类目标"]').first().click()
await page.waitForTimeout(400)
const opt = page.locator('button', { hasText: /^Pullover$/ }).last()
await opt.click()
await page.waitForTimeout(400)

const apply = page.locator('button', { hasText: /把 1 件改成/ }).first()
await apply.click()
await page.waitForTimeout(2800)

await page.screenshot({ path: 'shots/bulk-after.png' })

const { data: members } = await db
  .from('product_categories')
  .select('category')
  .eq('product_id', target.id)
console.log('成员表:', (members || []).map((r) => r.category).join(','))
console.log('成员表仍含旧分类 Sweater:', (members || []).some((r) => r.category === 'Sweater'))
console.log('保存后数据库主分类:', await readNow())

/* 还原 */
await db.from('products').update({ category: 'Sweater' }).eq('id', target.id)
await browser.close()
console.log('已还原为 Sweater')
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
