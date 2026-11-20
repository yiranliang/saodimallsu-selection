import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://localhost:5199/scripts/preview-editor.html'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource|Supabase/i.test(text)) {
    errors.push(`console: ${text}`)
  }
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

console.log('editor title:', await page.locator('text=编辑商品').count())
console.log('同时归入 block:', await page.locator('text=同时归入').count())
await page.screenshot({ path: 'shots/editor-multicat.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
