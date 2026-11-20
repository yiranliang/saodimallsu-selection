import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5199/'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(text)) {
    errors.push(`console: ${text}`)
  }
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(400)
}

const shop = page.getByRole('button', { name: 'Shop', exact: true }).first()
console.log('shop count:', await shop.count())
const box = await shop.boundingBox()
console.log('shop box:', box && { x: Math.round(box.x), y: Math.round(box.y) })
await shop.hover()
await page.waitForTimeout(700)

const allRow = page.locator('button', { hasText: 'All products' }).first()
console.log('All products visible:', await allRow.isVisible())
await page.screenshot({ path: 'shots/nav-shop-collapsed.png' })

const tops = page.locator('button[aria-expanded]').filter({ hasText: 'Tops' }).first()
console.log('tops count:', await tops.count(), 'visible:', await tops.isVisible().catch(() => false))
if (await tops.count()) {
  await tops.click({ force: true })
  await page.waitForTimeout(400)
}
await page.screenshot({ path: 'shots/nav-shop-expanded.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
