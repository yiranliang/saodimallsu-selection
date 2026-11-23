import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

/* 打开汉堡菜单 */
await page.getByRole('button', { name: /menu|导航|打开/i }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/drawer-collapsed.png' })

const collapsed = await page.locator('text=Black Friday Special').count()
console.log('默认收起（看不到 Black Friday Special）:', collapsed === 0)

/* 展开 SHOP */
const shopRow = page.locator('button', { hasText: 'Shop' }).last()
if (await shopRow.count()) {
  await shopRow.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'shots/drawer-shop.png' })
}

/* 再展开一个分组（Tops） */
const tops = page.locator('button').filter({ hasText: 'Tops' }).last()
if (await tops.count()) {
  await tops.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'shots/drawer-tops.png' })
}

console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
