/**
 * Browser check for "Copy All ASINs" on the admin lookup page
 *   node scripts/smoke-asins.mjs [baseUrl]
 *
 * Covers:
 *   · the old "Copy JSON" button is gone
 *   · "Copy All ASINs" writes one bare ASIN per line — no quotes, commas,
 *     labels, blank lines or trailing newline
 *   · "Copy list" writes creator-facing lines — name, options, qty, Amazon link;
 *     no 货号, no em dash, no internal status wording
 *   · the clipboard matches exactly what the page shows, in the same order
 *   · a successful copy raises a toast
 *   · a selection with no matching ASIN disables the button instead of
 *     copying an empty string
 *
 * Needs SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD in .env (the lookup page
 * is behind the auth gate, and only a signed-in admin can resolve ASINs at all).
 *
 * Read-only: it looks codes up and copies text, nothing is written to Supabase.
 */

import { chromium } from 'playwright-core'
import { hasAdminCredentials, signInAdmin, skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

if (!hasAdminCredentials()) {
  console.log('\n⚠ skipped — SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD not set in .env')
  console.log('  Resolving ASINs needs a signed-in admin, so this check cannot run.\n')
  process.exit(0)
}

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
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } })
await skipGuide(page)

/* Capture what the app hands to the clipboard instead of reading the real one:
 * headless Chrome needs an explicit permission grant for clipboard-read, and a
 * stub also lets us assert the exact bytes that were written. */
await page.addInitScript(() => {
  window.__copied = null
  const stub = {
    writeText: async (text) => {
      window.__copied = text
      return undefined
    },
    readText: async () => window.__copied ?? '',
  }
  try {
    Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true })
  } catch {
    /* nothing to do — copyToClipboard will fall back to execCommand */
  }
})

const codeInput = () => page.locator('#code-input')
const lookUp = () => page.getByRole('button', { name: 'Look up', exact: true })
const copyAsins = () => page.getByRole('button', { name: /Copy All ASINs|Copied|No ASINs to copy/ })

/** Every ASIN the result table is showing, in row order */
const shownAsins = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('p'))
      .map((el) => el.textContent.trim())
      .filter((text) => /^ASIN [A-Z0-9]+$/.test(text))
      .map((text) => text.slice('ASIN '.length)),
  )

/** Paste a code and wait for the result panel */
async function lookup(code) {
  await codeInput().fill(code)
  await lookUp().click()
  await page.waitForSelector('text=Export CSV', { timeout: 15000 })
  await page.waitForTimeout(300)
}

/* ── 1. sign in ── */
console.log('\n[1] Admin sign-in')
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await signInAdmin(page)
/* signInAdmin resolves the moment the gate detaches; the console shell mounts
 * a tick later, so wait for the input instead of counting straight away. */
await page.waitForSelector('#code-input', { timeout: 20000 })
check('lookup input rendered', await codeInput().count(), 1)

/* The ASIN map is whitelist-only, so it has to be fetched again now that we
 * hold a JWT. Boot ran before sign-in, when the request was anonymous. */
await page.evaluate(() => window.SAODIMALLSU.refresh())
await page.waitForTimeout(800)

/* ── 2. build a code from the live catalogue ── */
console.log('\n[2] Fixture code')
const fixture = await page.evaluate(() => {
  /* Walk the catalogue and keep the first two products whose first variant
   * actually resolves to an ASIN — the real catalogue has gaps, so picking
   * blind would make the test flaky for reasons unrelated to the button. */
  const chosen = []
  for (const product of window.SAODIMALLSU.products()) {
    if (!product.specs || !Object.keys(product.specs).length) continue
    const specs = {}
    for (const [type, values] of Object.entries(product.specs)) {
      if (values?.length) specs[type] = values[0]
    }
    const probe = window.SAODIMALLSU.encode('smoke', { [product.id]: 1 }, { [product.id]: specs })
    const decoded = window.SAODIMALLSU.decode(probe.code)
    if (decoded.items[0]?.asin) chosen.push({ id: product.id, specs })
    if (chosen.length === 2) break
  }
  if (chosen.length < 2) return { code: '', expected: [] }

  const selection = {}
  const specs = {}
  for (const entry of chosen) {
    selection[entry.id] = 1
    specs[entry.id] = entry.specs
  }
  const { code } = window.SAODIMALLSU.encode('smoke', selection, specs)
  const decoded = window.SAODIMALLSU.decode(code)
  return {
    code,
    expected: decoded.items.map((item) => item.asin),
    skus: decoded.items.map((item) => item.sku).filter(Boolean),
  }
})

if (!fixture.expected.length || fixture.expected.length < 2) {
  console.log('  · skipped — could not find two products with a mapped ASIN')
  console.log('    (is the asins table populated, and is this account an admin?)')
  await browser.close()
  console.log(`\n${'─'.repeat(44)}`)
  console.log(`Passed ${passed}`)
  process.exit(0)
}

check('fixture has two ASINs', fixture.expected.length, 2)
console.log(`  code: ${fixture.code}`)

/* ── 3. the result page ── */
console.log('\n[3] Result page')
await lookup(fixture.code)

check('the table shows both ASINs', await shownAsins(), fixture.expected)
check('Copy JSON is gone', await page.getByRole('button', { name: 'Copy JSON' }).count(), 0)
check('Copy All ASINs is present', await page.getByRole('button', { name: 'Copy All ASINs' }).count(), 1)

/* ── 4. copy ── */
console.log('\n[4] Copy All ASINs')
await copyAsins().click()
await page.waitForTimeout(600)

const copied = await page.evaluate(() => window.__copied)
check('clipboard has one ASIN per line', copied, fixture.expected.join('\n'))
check('no trailing newline', typeof copied === 'string' && copied.endsWith('\n'), false)
check('no blank lines', String(copied).split('\n').filter((line) => !line.trim()).length, 0)
check('nothing but ASINs and newlines', /^[A-Z0-9]+\n[A-Z0-9]+$/.test(String(copied)), true)
check('no quotes or commas', /["',]/.test(String(copied)), false)

const toast = await page.evaluate(() =>
  Array.from(document.querySelectorAll('span'))
    .map((el) => el.textContent.trim())
    .find((text) => /copied to clipboard/i.test(text)),
)
check('a toast confirms the copy', /^2 ASINs copied to clipboard$/.test(toast || ''), true)

/* ── 4b. "Copy list" — the text that gets forwarded to the creator ── */
console.log('\n[4b] Copy list (creator-facing)')
await page.getByRole('button', { name: 'Copy list' }).click()
await page.waitForTimeout(600)
const listText = String((await page.evaluate(() => window.__copied)) || '')
const listLines = listText.split('\n')
const bodyLines = listLines.filter((line) => / × \d+ - /.test(line))

check('one line per variant', bodyLines.length, 2)
check(
  'line shape: name (options) × qty - link',
  bodyLines.every((line) => /^.+ \((.+)\) × \d+ - https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]+$/.test(line)),
  true,
)
check('line 1 links its own ASIN', bodyLines[0]?.endsWith(`/dp/${fixture.expected[0]}`), true)
check('line 2 links its own ASIN', bodyLines[1]?.endsWith(`/dp/${fixture.expected[1]}`), true)
check('no 货号 leaked', fixture.skus.some((sku) => listText.includes(sku)), false)
check('no em dash', listText.includes('—'), false)
check('no internal status wording', /removed from catalogue|hidden from storefront|no matching asin/i.test(listText), false)

const listToast = await page.evaluate(() =>
  Array.from(document.querySelectorAll('span'))
    .map((el) => el.textContent.trim())
    .find((text) => /^List copied/.test(text)),
)
check('the toast says the list was copied', /^List copied/.test(listToast || ''), true)

/* ── 5. nothing to copy ── */
console.log('\n[5] No ASINs in the selection')
/* A hand-built v4 payload pointing at an id that is not in the catalogue:
 * the row renders as "Removed product", resolves to no ASIN at all. */
const emptyCode = await page.evaluate(() => {
  const payload = '4.smoke.p999999._.1.tn7a36'
  const bytes = new TextEncoder().encode(payload)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  /* 前缀从页面里取（window.SAODIMALLSU.codePrefix），别写死 —— 换品牌时这一句
   * 不该成为唯一记得改的地方。 */
  const prefix = window.SAODIMALLSU?.codePrefix || 'sdm'
  return `${prefix}-${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
})

await page.getByRole('button', { name: 'Look up another code' }).click()
await lookup(emptyCode)

check('row has no ASIN', await shownAsins(), [])
const disabled = page.getByRole('button', { name: 'No ASINs to copy' })
check('button relabels itself', await disabled.count(), 1)
check('button is disabled', await disabled.isDisabled(), true)

await browser.close()

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
