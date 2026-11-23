import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

await page.getByRole('button', { name: 'Shop', exact: true }).first().hover()
await page.waitForTimeout(600)

/* 左栏的一级分组顺序 */
const leftColumn = page.locator('.nav-drop .w-56 button')
const count = await leftColumn.count()
const labels = []
for (let i = 0; i < count; i += 1) {
  const text = (await leftColumn.nth(i).innerText()).split('\n')[0].trim()
  if (text) labels.push(text)
}
console.log('前台左栏顺序:', labels.join(' | '))

await page.screenshot({ path: 'shots/nav-order-fixed.png' })
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
