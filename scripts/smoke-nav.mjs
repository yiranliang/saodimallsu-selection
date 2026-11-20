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
  await page.waitForTimeout(300)
}

const shop = page.getByRole('button', { name: 'Shop', exact: true }).first()
await shop.hover()
await page.waitForTimeout(600)

/* 1. 默认：左侧一级、右侧留白 */
await page.screenshot({ path: 'shots/nav-mega-empty.png' })

/* 2. 悬停 Tops → 右侧出现二级 */
const tops = page.locator('button[aria-expanded]').filter({ hasText: 'Tops' }).first()
await tops.hover()
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots/nav-mega-tops.png' })

/* 3. 悬停 Accessories */
const acc = page.locator('button[aria-expanded]').filter({ hasText: 'Accessories' }).first()
await acc.hover()
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots/nav-mega-acc.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
