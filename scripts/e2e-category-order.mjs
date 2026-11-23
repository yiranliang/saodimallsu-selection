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
await page.locator('input[placeholder*="搜索货号"]').first().fill('C8P407')
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit Color Block"]').first().click()
await page.waitForTimeout(2500)

const info = await page.evaluate(() => {
  const select = document.querySelector('select[aria-label="Category"]')
  const groups = select
    ? [...select.querySelectorAll('optgroup')].map((g) => ({
        label: g.getAttribute('label'),
        items: [...g.querySelectorAll('option')].map((o) => o.textContent.trim()),
      }))
    : []
  const badge = [...document.querySelectorAll('span')]
    .map((s) => s.textContent.trim())
    .find((t) => t.startsWith('分组：'))
  return { groups, badge }
})

console.log('optgroup 顺序:', info.groups.map((g) => `${g.label}(${g.items.length})`).join(' → '))
console.log('第一组内容:', info.groups[0]?.items.join(', '))
console.log('徽标:', info.badge)
await page.screenshot({ path: 'shots/e2e-category-row.png' })
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
