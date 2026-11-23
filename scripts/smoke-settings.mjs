import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/scripts/preview-admin.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(1600)

await page.locator('button', { hasText: '设置' }).first().click()
await page.waitForTimeout(700)

const height = await page.evaluate(() => {
  const panel = document.querySelector('.fixed .rounded-2xl.bg-white')
  return panel ? Math.round(panel.getBoundingClientRect().height) : null
})
console.log('面板高度(收起态):', height)
console.log('折叠头数量:', await page.locator('button[aria-expanded]').count())

await page.screenshot({ path: 'shots/settings-collapsed.png' })

/* 展开「菜单布局」 */
await page.locator('button', { hasText: '菜单布局（草稿）' }).first().click()
await page.waitForTimeout(500)
const height2 = await page.evaluate(() => {
  const panel = document.querySelector('.fixed .rounded-2xl.bg-white')
  return panel ? Math.round(panel.getBoundingClientRect().height) : null
})
console.log('面板高度(展开布局):', height2)
await page.screenshot({ path: 'shots/settings-layout-open.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
