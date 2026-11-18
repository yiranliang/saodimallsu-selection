import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://localhost:5199/scripts/preview-settings.html'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })

page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

/* 展开分类 */
await page.locator('text=分类').first().click()
await page.waitForTimeout(400)

/* 打开后：body 滚动应被锁住 */
const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
console.log('body overflow while open:', JSON.stringify(bodyOverflow))

/* 在遮罩上滚动：页面不应滚动，弹窗内容滚动 */
const before = await page.evaluate(() => window.scrollY)
await page.mouse.move(640, 800)
await page.mouse.wheel(0, 600)
await page.waitForTimeout(300)
const after = await page.evaluate(() => window.scrollY)
console.log(`window.scrollY before=${before} after=${after}`)

await page.screenshot({ path: 'shots/settings-drag.png' })

/* 拖拽第 1 行到第 3 行 */
await page.locator('[draggable="true"]').nth(0).dragTo(page.locator('[draggable="true"]').nth(2))
await page.waitForTimeout(400)
await page.screenshot({ path: 'shots/settings-drag-after.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
