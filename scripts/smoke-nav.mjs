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
await page.waitForTimeout(1000)

const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

const shop = page.getByRole('button', { name: 'Shop', exact: true }).first()
await shop.hover()

/* 动画：出现后 60ms 内不应完全就位 */
await page.waitForTimeout(60)
const panel = page.locator('.nav-drop').first()
const animation = await panel.evaluate((node) => {
  const style = getComputedStyle(node)
  return {
    name: style.animationName,
    duration: style.animationDuration,
  }
})
console.log('animation:', animation)

await page.waitForTimeout(400)
console.log('panel visible after animation:', await panel.isVisible())
await page.screenshot({ path: 'shots/nav-anim.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
