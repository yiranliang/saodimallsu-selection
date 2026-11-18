import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://localhost:5199/scripts/preview-filter.html'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(t)) errors.push(`console: ${t}`)
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const trigger = page.locator('button[aria-haspopup="true"]')

/* 1. 打开 */
await trigger.click()
await page.waitForTimeout(200)
console.log('after open, expanded =', await trigger.getAttribute('aria-expanded'))

/* 2. 再点一次触发器 —— 应该收起 */
await trigger.click()
await page.waitForTimeout(200)
console.log('after second click, expanded =', await trigger.getAttribute('aria-expanded'))

/* 3. 重新打开，然后点外部 */
await trigger.click()
await page.waitForTimeout(200)
console.log('reopened, expanded =', await trigger.getAttribute('aria-expanded'))
await page.locator('#outside').click()
await page.waitForTimeout(200)
console.log('after outside click, expanded =', await trigger.getAttribute('aria-expanded'))

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
