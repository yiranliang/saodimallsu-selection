import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

await page.getByRole('button', { name: 'Shop', exact: true }).first().hover()
await page.waitForTimeout(600)

/* 悬停在「Tops」分组上，截图看是否只有下划线 */
const tops = page.locator('.nav-drop .w-56 button').filter({ hasText: 'Tops' }).first()
if (await tops.count()) {
  await tops.hover()
  await page.waitForTimeout(500)
}
await page.screenshot({ path: 'shots/shop-underline.png' })
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
