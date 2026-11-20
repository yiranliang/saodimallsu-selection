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
await page.waitForTimeout(500)

const panel = page.locator('button', { hasText: 'All products' }).first()
console.log('panel open:', await panel.isVisible())

/* 关键：鼠标移到面板里（模拟真实移动，经过中间区域） */
const tops = page.locator('button[aria-expanded]').filter({ hasText: 'Tops' }).first()
await tops.hover()
await page.waitForTimeout(300)
console.log('still open after moving into panel:', await panel.isVisible())

/* 再等超过 200ms 的延迟窗口，确认没有被误关 */
await page.waitForTimeout(400)
console.log('still open after 400ms:', await panel.isVisible())

await page.screenshot({ path: 'shots/nav-mega-hover.png' })

/* 移到页面其它地方 → 应该关闭 */
await page.mouse.move(720, 700)
await page.waitForTimeout(500)
console.log('closed after leaving:', !(await panel.isVisible()))

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
