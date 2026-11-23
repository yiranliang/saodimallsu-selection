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

/* 分类筛选面板 */
await page.locator('button[aria-label="Filter by category"]').first().click()
await page.waitForTimeout(500)
const panel = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(
    (d) => d.className.includes('absolute top-full z-30') && d.textContent.includes('全部'),
  )
  if (!el) return null
  const box = el.getBoundingClientRect()
  return { width: Math.round(box.width), height: Math.round(box.height) }
})
console.log('分类面板尺寸:', panel)
await page.screenshot({ path: 'shots/admin-filter-big.png' })
await page.keyboard.press('Escape')

/* 编辑器里「+ 添加分类」面板 */
await page.locator('input[placeholder*="搜索货号"]').first().fill('C8P407')
await page.waitForTimeout(1500)
await page.locator('button[aria-label^="Edit Color Block"]').first().click()
await page.waitForTimeout(2200)
await page.locator('button[aria-label="添加额外分类"]').first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'shots/editor-extras-big.png' })

console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
