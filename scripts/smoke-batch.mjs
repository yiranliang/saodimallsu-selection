import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
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

/* 勾选前两件商品 */
const checks = page.locator('input[type="checkbox"]')
const total = await checks.count()
for (let i = 1; i < Math.min(3, total); i += 1) {
  await checks.nth(i).check({ force: true })
  await page.waitForTimeout(200)
}

/* 打开批量分类 */
await page.locator('button', { hasText: '批量分类' }).first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: 'shots/batch-category.png' })

const text = await page.locator('body').innerText()
const idx = text.indexOf('批量分类')
console.log('弹窗内容:', text.slice(idx, idx + 260).replace(/\n/g, ' | '))
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
