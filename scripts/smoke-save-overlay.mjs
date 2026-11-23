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
  await page.waitForTimeout(3500)
}

await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('input[placeholder*="搜索货号"]').first().fill('C8P407')
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit Color Block"]').first().click()
await page.waitForTimeout(2200)

/* 点保存，立刻截图捕捉遮罩 */
await page.locator('button', { hasText: '保存修改' }).first().click()
await page.waitForTimeout(120)
const overlay = await page.locator('text=正在保存…').count()
console.log('保存遮罩出现:', overlay > 0)
await page.screenshot({ path: 'shots/saving-overlay.png' })

await page.waitForTimeout(3000)
console.log('保存后遮罩消失:', (await page.locator('text=正在保存…').count()) === 0)
await page.screenshot({ path: 'shots/saving-done.png' })
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
