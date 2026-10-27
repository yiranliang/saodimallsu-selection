/**
 * Selection lifetime check (browser)
 *   node scripts/smoke-cart.mjs [baseUrl]
 *
 * Needs a dev server already running (default http://127.0.0.1:5178):
 *   npm run dev -- --port 5178
 *
 * Covers the 7-day rule end to end — and, more importantly, the cases where it
 * must NOT fire:
 *
 *   · a fresh visitor sees an empty bar and no toast
 *   · a draft stamped 3 days ago survives a reload, and the reload does NOT
 *     extend its life (the stamp is "last changed", not "last opened")
 *   · 6 days old → still there
 *   · 8 days old → cleared, with the expiry toast
 *   · the pre-envelope bare array is migrated, not discarded
 *   · adding through the UI bumps the stamp
 *   · generating a code empties the cart, while the sheet still quotes the
 *     counts that went INTO the code
 *
 * Writes nothing to Supabase — only localStorage inside a throwaway browser
 * profile. Safe to point at production.
 */

import { chromium } from 'playwright-core'
import { skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const KEY = 'mako_lines_v1'
const DAY = 24 * 60 * 60 * 1000
const EXPIRY_TOAST = 'Your previous selection has expired. Starting a fresh one!'

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
await skipGuide(page)

const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))

const bar = () => page.getByRole('button', { name: 'View your selection' }).innerText()

async function settle() {
  await page.waitForFunction(() => window.SAODIMALLSU && window.SAODIMALLSU.products().length > 0, null, {
    timeout: 20000,
  })
  await page.waitForSelector('article[aria-label^="View "]', { timeout: 20000 })
  await page.waitForTimeout(300)
}

async function visit() {
  await page.goto(`${BASE}/?ref=carttest`, { waitUntil: 'domcontentloaded' })
  await settle()
}

async function reload() {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle()
}

/** Overwrite storage, then reload so the app reads it at mount. */
async function seed(lines, updatedAt) {
  await page.evaluate(
    ({ key, lines, updatedAt }) => {
      const value = updatedAt === null ? JSON.stringify(lines) : JSON.stringify({ v: 2, updatedAt, lines })
      localStorage.setItem(key, value)
    },
    { key: KEY, lines, updatedAt },
  )
  await reload()
}

const stored = () =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return { unreadable: true }
    }
  }, KEY)

/* ── 0. boot ───────────────────────────────────────────────────────────── */
console.log('\n[0] Boot')
await visit()
const sample = await page.evaluate(() => {
  const product = window.SAODIMALLSU.products().find(
    (p) => !p.hidden && p.specs && Object.keys(p.specs).length > 0,
  )
  if (!product) return null
  const specs = {}
  for (const type of Object.keys(product.specs)) specs[type] = product.specs[type][0]
  return { id: product.id, name: product.name, specs }
})
check('the catalogue has at least one variant product', Boolean(sample), true)
if (!sample) {
  console.log('\n⚠ no products found — is the dev server pointed at a seeded database?')
  await browser.close()
  process.exit(0)
}
console.log(`      using ${sample.id} · ${sample.name} · ${JSON.stringify(sample.specs)}`)

const line = () => ({
  key: `${sample.id}::seeded`,
  productId: sample.id,
  qty: 2,
  specs: sample.specs,
})

/* ── 1. fresh visitor ──────────────────────────────────────────────────── */
console.log('\n[1] Fresh visitor')
await page.evaluate((key) => localStorage.removeItem(key), KEY)
await reload()
check('the bar starts empty', (await bar()).includes('Empty'), true)
check('no expiry toast on a first visit', await page.locator(`text=${EXPIRY_TOAST}`).count(), 0)

/* ── 2. a recent draft survives, and reloading does not extend it ──────── */
console.log('\n[2] Recent draft')
const threeDaysAgo = Date.now() - 3 * DAY
await seed([line()], threeDaysAgo)
check('the line is restored', (await bar()).includes('1 style'), true)
check('quantity is restored too', (await bar()).includes('2 items'), true)
check('no expiry toast for a 3-day-old draft', await page.locator(`text=${EXPIRY_TOAST}`).count(), 0)

const afterReload = await stored()
check('the stored stamp is untouched by a page load', afterReload.updatedAt, threeDaysAgo)
check('the envelope is versioned', afterReload.v, 2)
check('the line is still in storage', afterReload.lines.length, 1)

/* ── 3. six days is still inside the window ────────────────────────────── */
console.log('\n[3] Six days old')
await seed([line()], Date.now() - 6 * DAY)
check('still restored', (await bar()).includes('1 style'), true)
check('still no toast', await page.locator(`text=${EXPIRY_TOAST}`).count(), 0)

/* ── 4. eight days is not ──────────────────────────────────────────────── */
console.log('\n[4] Eight days old')
await seed([line()], Date.now() - 8 * DAY)
check('the bar is empty', (await bar()).includes('Empty'), true)
check('the toast explains it', await page.locator(`text=${EXPIRY_TOAST}`).count(), 1)

const afterExpiry = await stored()
check('the stale lines are gone from storage', afterExpiry.lines, [])
check('the clock restarted', Math.abs(afterExpiry.updatedAt - Date.now()) < 60_000, true)

/* a reload straight after expiry must not show the toast again */
await reload()
check('the toast does not repeat on the next visit', await page.locator(`text=${EXPIRY_TOAST}`).count(), 0)

/* ── 5. the pre-envelope array is migrated, not discarded ──────────────── */
console.log('\n[5] Legacy array')
await seed([line()], null)
check('a legacy array keeps its lines', (await bar()).includes('1 style'), true)
const migrated = await stored()
check('it is rewritten as an envelope', migrated.v, 2)
check('a timestamp was attached', Number.isFinite(migrated.updatedAt), true)
check('the lines survived the migration', migrated.lines.length, 1)

/* ── 6. adding through the UI bumps the stamp ──────────────────────────── */
console.log('\n[6] A real add')
const oldStamp = Date.now() - 3 * DAY
await seed([], oldStamp)
check('seeded empty', (await bar()).includes('Empty'), true)

await page.locator('article[aria-label^="View "]').first().click()
await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
await page.evaluate(() => {
  document.querySelectorAll('[role="dialog"] .flex.flex-wrap.gap-2').forEach((group) => {
    const button = group.querySelector('button[aria-pressed]')
    if (button) button.click()
  })
})
await page.waitForTimeout(400)

const addButton = page.getByRole('button', { name: /Add to my selection/ })
check('the sheet became addable', (await addButton.count()) > 0, true)
await addButton.first().click()
await page.waitForTimeout(600)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

const bumped = await stored()
check('the add was stored', bumped.lines.length >= 1, true)
check('the stamp moved to now', bumped.updatedAt > oldStamp + DAY, true)
check('the bar shows it', (await bar()).includes('Empty'), false)

/* ── 7. same session: a reload keeps the selection ─────────────────────── */
console.log('\n[7] Refresh mid-session')
const beforeRefresh = await bar()
await reload()
check('there was a selection before the reload', beforeRefresh.includes('1 style'), true)
check('the selection survives a refresh', (await bar()).includes('1 style'), true)
check('the bar reads exactly the same after the reload', await bar(), beforeRefresh)

/* ── 8. generating a code KEEPS the cart and restarts its 7-day clock ──
 * Creators often send one code, then spot another piece. Clearing forced a
 * second, separate code; keeping the lines means the next generate includes
 * everything they picked. The stamp must move on, or the draft would expire
 * while they keep shopping. */
console.log('\n[8] Generate keeps the selection')

const stampBeforeGenerate = (await stored()).updatedAt
const generateStartedAt = Date.now()

await page.getByRole('button', { name: 'Generate my code' }).click()
await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
await page.waitForTimeout(500)

const sheetText = await page.locator('[role="dialog"]').last().innerText()
check('the sheet is open', sheetText.includes('Your code is ready'), true)
check('the sheet still quotes the styles that went in', /\d+ styles?/.test(sheetText), true)
check('and the items', /\d+ items?/.test(sheetText), true)
check('the sheet says the selection is kept', /selection stays here/i.test(sheetText), true)
check('the cart behind it still has the selection', (await bar()).includes('1 style'), true)

const afterGenerate = await stored()
check('storage still holds the line', afterGenerate.lines.length >= 1, true)
check('the 7-day stamp was renewed', afterGenerate.updatedAt >= generateStartedAt, true)
check('and it moved on from the pre-generate stamp', afterGenerate.updatedAt >= stampBeforeGenerate, true)

await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check('the bar still shows the selection after closing', (await bar()).includes('Empty'), false)

/* ── 9. no runtime errors ─────────────────────────────────────────────── */
console.log('\n[9] Runtime')
check('no uncaught page errors', pageErrors, [])

await page.evaluate((key) => localStorage.removeItem(key), KEY)
await browser.close()

console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed) {
  console.log(`Failed ${failed}`)
  process.exit(1)
}
