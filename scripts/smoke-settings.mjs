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
await page.locator('button', { hasText: '设置' }).first().click()
await page.waitForTimeout(700)

/* 展开「分类 & 分组布局」 */
await page.locator('button[aria-expanded]').filter({ hasText: '分类 & 分组布局' }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/settings-layout-collapsed.png' })

/* 展开第一个分组 */
const firstGroup = page.locator('button[aria-label^="展开 "]').first()
if (await firstGroup.count()) {
  await firstGroup.click()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: 'shots/settings-layout-open.png' })

const text = await page.locator('body').innerText()
const idx = text.indexOf('分类 & 分组布局')
console.log('布局区域:', text.slice(idx, idx + 220).replace(/\n/g, ' | '))
console.log('诊断:', logs.length ? logs.join('\n') : 'none')
await browser.close()
