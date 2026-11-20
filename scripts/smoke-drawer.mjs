import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5199/'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

/* 汉堡菜单 */
const burger = page.getByRole('button', { name: /menu|导航|打开/i }).first()
console.log('burger count:', await burger.count())
if (await burger.count()) {
  await burger.click()
  await page.waitForTimeout(500)
}

await page.screenshot({ path: 'shots/nav-drawer.png' })

/* 展开 Tops */
const tops = page.locator('button[aria-expanded="false"]').filter({ hasText: 'Tops' }).first()
if (await tops.count()) {
  await tops.click({ force: true })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'shots/nav-drawer-expanded.png' })
}

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
