import { chromium } from 'playwright-core'
import { signInAdmin } from './unlock.mjs'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
await page.goto('http://localhost:5178/#/admin/products', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1600)
await signInAdmin(page)
await page.waitForTimeout(2500)

// 顶部按钮
await page.screenshot({ path: 'scripts/out/import-button.png' })

const csv = [
  '货号,ASIN,颜色,尺寸',
  'ZZSHOT-01,B000TEST01,Camel,M',
  'ZZSHOT-01,,Camel,L',
  'ZZSHOT-02,B000TEST02,Camel,M',
  ',B000TEST03,Black,M',
  'ZZSHOT-01,,Black,',
].join('\n')

await page.locator('input[type="file"]').setInputFiles({
  name: 'spring-2026.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(csv, 'utf8'),
})
await page.waitForSelector('[role="dialog"][aria-label="Import preview"]', { timeout: 20000 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/import-preview.png' })
console.log('preview stats:', await page.evaluate(() =>
  [...document.querySelectorAll('[data-import-stat]')].map((el) => el.getAttribute('data-import-stat') + '=' + el.querySelector('[data-import-value]').innerText.replace(/\s/g, ''))
))
await browser.close()
