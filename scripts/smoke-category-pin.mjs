import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

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

/* 选一个分类（Sweaters） */
await page.locator('button[aria-label="Filter by category"]').first().click()
await page.waitForTimeout(400)
await page.locator('button').filter({ hasText: 'Pullover' }).last().click()
await page.waitForTimeout(1500)

await page.screenshot({ path: 'shots/category-pin-list.png' })

const label = await page
  .locator('button[aria-label*="置顶"]')
  .first()
  .getAttribute('aria-label')
console.log('置顶按钮 aria-label:', label)

await page.locator('button[aria-label*="置顶"]').first().click()
await page.waitForTimeout(2000)
await page.screenshot({ path: 'shots/category-pin-click.png' })
const text = await page.locator('body').innerText()
console.log('出现缺列提示:', /category_pins|23-category-pins/.test(text))
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
