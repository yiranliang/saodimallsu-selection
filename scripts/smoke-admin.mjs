import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource|Supabase|JWT|fetch/i.test(text)) {
    errors.push(`console: ${text}`)
  }
})

await page.goto('http://localhost:5199/scripts/preview-admin.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

console.log('商品库标题:', await page.locator('text=商品库').count())
console.log('设置按钮:', await page.locator('button', { hasText: '设置' }).count())
await page.screenshot({ path: 'shots/admin-products-live.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
