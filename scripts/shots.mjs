/**
 * Screenshot run — read-only by design
 *   node scripts/shots.mjs [baseUrl]
 *
 * The catalogue lives in Postgres now, so this script must not mutate anything:
 * the old version added categories and hid every product, which was harmless
 * against a localStorage copy but would wreck the shared data today. Every step
 * below is a navigation or an open-then-close.
 *
 * Produces:
 *   shots/00-gate.png        the sign-in wall
 *   shots/00-gate-error.png  wrong password, red message
 *   shots/01-lookup.png      code lookup
 *   shots/02-products.png    product library
 *   shots/03-editor.png      product editor, opened then dismissed
 *   shots/04-developer.png   decode view
 *   shots/05-storefront.png  the creator-facing page
 *   shots/06-result.png      a looked-up code, with the copy buttons
 */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { signInAdmin, ADMIN_EMAIL, hasAdminCredentials, skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

if (!hasAdminCredentials()) {
  console.log('\n⚠ skipped — SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD not set in .env\n')
  process.exit(0)
}

mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 480, height: 1040 } })
await skipGuide(page)

const shot = async (name) => {
  await page.screenshot({ path: `shots/${name}` })
  console.log(`shots/${name}`)
}

/* ── 0. the gate ── */
await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.evaluate(() => sessionStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })
await page.waitForTimeout(400)
await shot('00-gate.png')

await page.locator('input[aria-label="Email"]').fill(ADMIN_EMAIL)
await page.locator('input[aria-label="Password"]').fill('not-the-password')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForTimeout(2200)
await shot('00-gate-error.png')

await signInAdmin(page)
/* this run starts on /admin/products, so wait for the tab bar, not the lookup */
await page.waitForSelector('nav a[href="#/admin/products"]', { timeout: 20000 })
await page.waitForTimeout(600)

await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.waitForSelector('#code-input', { timeout: 20000 })
await page.waitForTimeout(700)
await shot('01-lookup.png')

/* ── 1. product library ── */
await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Product library', { timeout: 20000 })
await page.waitForTimeout(900)
await shot('02-products.png')

/* ── 2. editor, opened then dismissed — nothing is written ── */
const firstEdit = page.locator('button[aria-label^="Edit "]').first()
if (await firstEdit.count()) {
  await firstEdit.click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(500)
  await shot('03-editor.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

/* ── 3. developer ── */
await page.goto(`${BASE}/#/admin/developer`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await shot('04-developer.png')

/* ── 4. storefront ── */
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
await shot('05-storefront.png')

/* ── 5. a lookup result, so the copy buttons are on record ── */
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.waitForSelector('#code-input', { timeout: 20000 })
/* the ASIN map is whitelist-only and boot ran before sign-in, so refetch */
await page.evaluate(() => window.SAODIMALLSU.refresh())
await page.waitForTimeout(600)

const demoCode = await page.evaluate(() => {
  /* first three products whose first variant actually has an ASIN */
  const chosen = []
  for (const product of window.SAODIMALLSU.products()) {
    if (!product.specs || !Object.keys(product.specs).length) continue
    const specs = {}
    for (const [type, values] of Object.entries(product.specs)) {
      if (values?.length) specs[type] = values[0]
    }
    const probe = window.SAODIMALLSU.encode('shots', { [product.id]: 1 }, { [product.id]: specs })
    if (window.SAODIMALLSU.decode(probe.code).items[0]?.asin) chosen.push({ id: product.id, specs })
    if (chosen.length === 3) break
  }
  if (!chosen.length) return ''
  const selection = {}
  const specs = {}
  for (const entry of chosen) {
    selection[entry.id] = 1
    specs[entry.id] = entry.specs
  }
  return window.SAODIMALLSU.encode('shots', selection, specs).code
})

if (demoCode) {
  await page.locator('#code-input').fill(demoCode)
  await page.getByRole('button', { name: 'Look up', exact: true }).click()
  await page.waitForSelector('text=Export CSV', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'shots/06-result.png', fullPage: true })
  console.log('shots/06-result.png')
} else {
  console.log('· skipped 06-result — no product has a mapped ASIN')
}

await browser.close()
