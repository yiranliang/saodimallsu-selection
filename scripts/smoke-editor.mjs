import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = 'http://localhost:5199/scripts/preview-editor.html'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' && !/favicon|Supabase|Failed to load resource/i.test(t)) {
    errors.push(`console: ${t}`)
  }
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

/* 关键：编辑器内容是否真的渲染出来（而不是崩在 render 里） */
const titleVisible = await page.locator('text=编辑商品').count()
console.log('editor title count:', titleVisible)

const preview = await page.locator('[data-card-preview]').count()
console.log('card preview block:', preview)

await page.screenshot({ path: 'shots/editor.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
