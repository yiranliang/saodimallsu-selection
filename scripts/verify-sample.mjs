/**
 * Visual check for one specific code — used to confirm the admin lookup shows
 * 货号, the single variant ASIN and the quantity for a real selection.
 *   node scripts/verify-sample.mjs <code> [expected option text]
 */
import { chromium } from 'playwright-core'
import { CODE_PREFIX } from '../src/utils/code.js'

const BASE = 'http://127.0.0.1:5178'
const CODE = process.argv[2]
const EXPECT = process.argv[3] || 'Black / S'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

if (!CODE) {
  console.error(`Usage: node scripts/verify-sample.mjs <${CODE_PREFIX}-code> [expected option text]`)
  process.exit(2)
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 })

await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.fill('#code-input', CODE)
await page.click('button[type="submit"]')
await page.waitForSelector(`text=${EXPECT}`, { timeout: 8000 })
await page.waitForTimeout(600)

await page.screenshot({ path: 'scripts/sample-lookup.png', fullPage: true })

const rows = await page.locator('text=/ASIN [A-Z0-9]{10}/').allTextContents()
console.log('ASIN lines rendered:')
for (const row of rows) console.log('  ' + row.trim())

const noAsin = await page.locator('text=No ASIN for this colour / size').count()
console.log(`No-ASIN notices: ${noAsin}`)

await browser.close()
