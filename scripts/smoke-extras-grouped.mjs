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
await page.locator('input[placeholder*="搜索货号"]').first().fill('C8P407')
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit"]').first().click()
await page.waitForTimeout(2200)

const trigger = page.locator('button[aria-label="添加额外分类"]').first()
if (await trigger.count()) {
  await trigger.click()
} else {
  /* 空态：先点「添加」，选择器才出现 */
  await page.locator('button', { hasText: /^添加$/ }).first().click()
  await page.waitForTimeout(300)
  await page.locator('button[aria-label="添加额外分类"]').first().click()
}
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/extras-grouped.png' })

const text = await page.locator('body').innerText()
const i = text.indexOf('同时归入')
console.log('同时归入区域:', text.slice(i, i + 160).replace(/\n/g, ' | '))
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
