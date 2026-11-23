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

/* 点「分类」折叠头的按钮：span 文本正好是 分类 的那个 aria-expanded 按钮 */
const header = page.locator('button[aria-expanded]').filter({ hasText: '分类' }).first()
await header.click()
await page.waitForTimeout(700)

const rows = await page.evaluate(() => {
  const out = []
  for (const button of document.querySelectorAll('button[aria-label*="的一级分组"]')) {
    const row = button.parentElement?.parentElement
    const text = (row?.textContent || '').replace(/\s+/g, ' ').trim()
    out.push(text)
  }
  return out
})
console.log('分类行:', rows.join(' || '))

await page.screenshot({ path: 'shots/admin-category-counts.png' })
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
