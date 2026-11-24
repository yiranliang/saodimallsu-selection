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

/* 0. 列是否就绪 */
{
  const { error } = await db.from('products').select('id, category_pins').limit(1)
  console.log('category_pins 列:', error ? `缺失（${error.message}）` : '就绪')
  if (error) process.exit(1)
}

/* 1. 选目标：Pullover 分类里第 5 件（不选第一件，才能看出"置顶"确实改变了顺序） */
const { data: pool } = await db
  .from('products')
  .select('id, sku, name, category, sort_order, category_pins')
  .eq('category', 'Pullover')
  .order('sort_order')
  .limit(20)

const target = pool[4]
console.log('目标商品:', target.sku, '| 原 sort_order =', target.sort_order, '| 分类=', target.category)
console.log('    改动前 category_pins =', JSON.stringify(target.category_pins))
const firstBefore = pool[0]

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

/* 2. 选分类 Pullover */
await page.locator('button[aria-label="Filter by category"]').first().click()
await page.waitForTimeout(400)
await page.locator('button').filter({ hasText: 'Pullover' }).last().click()
await page.waitForTimeout(1500)

/* 3. 点第 5 张卡片的置顶按钮 */
const pinButtons = page.locator('button[aria-label*="置顶"]')
console.log('本页置顶按钮数量:', await pinButtons.count())
const button = pinButtons.nth(4)
console.log('将点击:', await button.getAttribute('aria-label'))
await button.click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/pin-admin.png' })

/* 4. 数据库校验 */
const { data: after } = await db
  .from('products')
  .select('sort_order, category_pins')
  .eq('id', target.id)
  .maybeSingle()
console.log('改动后 category_pins =', JSON.stringify(after.category_pins))
console.log('全局 sort_order 是否未变:', after.sort_order === target.sort_order, `(${target.sort_order} → ${after.sort_order})`)

await browser.close()
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
