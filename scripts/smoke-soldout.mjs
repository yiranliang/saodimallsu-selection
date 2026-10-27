/**
 * Browser check for per-combination sold out
 *   node scripts/smoke-soldout.mjs [baseUrl]
 *
 * Covers:
 *   · a marked combination is disabled in the detail sheet and says "(Sold out)"
 *   · its sibling sizes stay selectable — sold out is per combination, not per
 *     colour, so Green/M being gone must not touch Green/L
 *   · the colour chips stay selectable while that colour still has stock
 *   · a fully sold-out product gets the card badge and stays clickable
 *   · a partially sold-out product gets NO badge (otherwise the card reads as
 *     "unavailable" and the creator scrolls past a piece she can still order)
 *
 * WRITES, THEN PUTS IT BACK
 * ─────────────────────────
 * There is no way to prove the greying works without a product that actually has
 * a sold-out mark, and asking a human to create one by hand is how these tests
 * rot. So this suite borrows one product, writes a known mark, checks the UI,
 * and restores the original value in a `finally`. The restore is asserted, not
 * assumed.
 *
 * Skips cleanly when `supabase/05-sold-out.sql` has not been run yet — the app
 * itself degrades to "everything in stock" in that case, so there is nothing to
 * test.
 *
 * Needs SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD in .env.
 */

import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { hasAdminCredentials, ENV, skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

if (!hasAdminCredentials()) {
  console.log('\n⚠ skipped — SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD not set in .env\n')
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

/* ── connect ─────────────────────────────────────────────────────────────── */
const supabase = createClient(ENV.VITE_SUPABASE_URL, ENV.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { error: authError } = await supabase.auth.signInWithPassword({
  email: ENV.SUPABASE_ADMIN_EMAIL,
  password: ENV.SUPABASE_ADMIN_PASSWORD,
})
if (authError) {
  console.log(`\n✗ sign-in failed — ${authError.message}\n`)
  process.exit(1)
}

/* Does the column exist? */
const probe = await supabase.from('products').select('id, sold_out_variants').limit(1)
if (probe.error && /sold_out_variants/i.test(probe.error.message)) {
  console.log('\n⚠ skipped — sold_out_variants 列不存在')
  console.log('  先在 Supabase SQL Editor 里跑一次 supabase/05-sold-out.sql，再重跑。\n')
  process.exit(0)
}
if (probe.error) {
  console.log(`\n✗ could not read products — ${probe.error.message}\n`)
  process.exit(1)
}

/* ── pick a product with at least two colours and two sizes ──────────────── */
const { data: products, error: listError } = await supabase
  .from('products')
  .select('id, sku, name, hidden, specs, sold_out_variants')
  .order('sort_order', { ascending: true })

if (listError) {
  console.log(`\n✗ could not list products — ${listError.message}\n`)
  process.exit(1)
}

function axes(product) {
  const specs = product.specs || {}
  const colourType = Object.keys(specs).find((t) => /^(colour|color|颜色)$/i.test(t.trim()))
  const sizeType = Object.keys(specs).find((t) => /^(size|尺码|尺寸)$/i.test(t.trim()))
  return {
    colourType,
    sizeType,
    colours: colourType ? specs[colourType] : [],
    sizes: sizeType ? specs[sizeType] : [],
  }
}

const target = products.find((product) => {
  if (product.hidden) return false
  const { colours, sizes } = axes(product)
  return colours.length >= 2 && sizes.length >= 2
})

if (!target) {
  console.log('\n⚠ skipped — no visible product has 2+ colours and 2+ sizes\n')
  process.exit(0)
}

const { colourType, sizeType, colours, sizes } = axes(target)
const original = Array.isArray(target.sold_out_variants) ? target.sold_out_variants : []

/* Second colour + second size: using the first of each would make "wrong
 * product marked" indistinguishable from "right product marked". */
const colour = colours[1]
const size = sizes[1]
const otherSize = sizes[0]
const otherColour = colours[0]
const comboKey = `${colour}|${size}`
const allKeys = colours.flatMap((c) => sizes.map((s) => `${c}|${s}`))

console.log(`\n  product  ${target.id} · ${target.sku || '(no sku)'} · ${target.name}`)
console.log(`  combo    ${comboKey}   (others: ${otherColour}, ${otherSize})`)
console.log(`  original ${original.length ? JSON.stringify(original) : '[]'}`)

async function setMarks(marks) {
  const { error } = await supabase
    .from('products')
    .update({ sold_out_variants: marks })
    .eq('id', target.id)
  if (error) throw new Error(`could not write marks — ${error.message}`)
}

/** Open the storefront, find the product by 货号, open its sheet. */
async function openSheet(page) {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)

  const search = page.locator('input[type="search"]')
  await search.fill(target.sku || target.name)
  await page.waitForTimeout(800)

  const card = page.locator(`article[aria-label="View ${target.name}"]`).first()
  await card.waitFor({ timeout: 15000 })
  return card
}

/** Every pressed-state button in the sheet, with its label and disabled flag. */
const sheetOptions = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return []
    return [...dialog.querySelectorAll('button[aria-pressed]')].map((button) => ({
      label: button.textContent.replace(/\s+/g, ' ').trim(),
      disabled: button.disabled === true,
      pressed: button.getAttribute('aria-pressed') === 'true',
    }))
  })

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1000, height: 950 } })
await skipGuide(page)

let restoreOk = false

try {
  /* ── 1. one combination marked ── */
  console.log('\n[1] One combination sold out')
  await setMarks([comboKey])

  let card = await openSheet(page)

  /* A partial sell-out must not badge the card. */
  check('partial sell-out adds no card badge', await card.getByText('Sold out', { exact: true }).count(), 0)

  await card.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)

  let options = await sheetOptions(page)
  check('sheet rendered options', options.length > 0, true)

  /* Colour comes first, and the size row only knows what is gone *after* a
   * colour is picked — `isOptionAvailable` is contextual on purpose: Green
   * being out of S says nothing about Black in S. So the colour is clicked
   * before the size labels mean anything. Asserting the "(Sold out)" suffix
   * on a fresh sheet would be asserting the opposite of the design. */
  const colourChips = options.filter((option) => option.label === colour)
  check('the colour itself stays selectable', colourChips.length, 1)
  check('the colour chip is not disabled', colourChips[0]?.disabled, false)

  const otherColourChip = options.filter((option) => option.label === otherColour)
  check('another colour is untouched', otherColourChip[0]?.disabled, false)

  /* Exact name, not `hasText`: with colours like "Blue" and "Dark Blue" in the
   * same group, a substring match clicks "Dark Blue" and every assertion after
   * it is about the wrong colour. */
  await page
    .locator('[role="dialog"] button[aria-pressed]')
    .filter({ hasText: new RegExp(`^\\s*${colour}\\s*$`) })
    .first()
    .click()
  await page.waitForTimeout(400)
  options = await sheetOptions(page)

  /* Normalise whitespace: the label is two spans (`S` + `(Sold out)`) and the
   * gap between them is CSS, not a character. */
  const flat = (option) => (option?.label || '').replace(/\s/g, '')
  const gone = options.filter((option) => flat(option).startsWith(`${size}(Soldout)`))
  check('marked size is present exactly once', gone.length, 1)
  check('marked size is disabled', gone[0]?.disabled, true)
  check('marked size says (Sold out)', flat(gone[0] || {}), `${size}(Soldout)`)

  const afterPick = options.find((option) => option.label.startsWith(size))
  check('the blocked size stays blocked for that colour', afterPick?.disabled, true)
  const stillOpen = options.find((option) => option.label === otherSize)
  check('the in-stock size of that colour opens up', stillOpen?.disabled, false)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ── 2. everything marked ── */
  console.log('\n[2] Fully sold out')
  await setMarks(allKeys)

  card = await openSheet(page)
  const badge = card.getByText('Sold out', { exact: true })
  check('card shows a Sold out badge', await badge.count(), 1)

  /* The card must still open — a creator may want to read the name or size
   * chart even when nothing is left. */
  await card.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)
  check('a sold-out card still opens', await page.locator('[role="dialog"]').count(), 1)

  const allDisabled = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const buttons = [...dialog.querySelectorAll('button[aria-pressed]')]
    return buttons.length > 0 && buttons.every((button) => button.disabled === true)
  })
  check('every option in the sheet is disabled', allDisabled, true)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
} finally {
  await setMarks(original).catch((error) => console.log(`\n  ⚠ restore failed — ${error.message}`))

  const { data: after } = await supabase
    .from('products')
    .select('sold_out_variants')
    .eq('id', target.id)
    .maybeSingle()

  const restored = after?.sold_out_variants ?? []
  restoreOk = JSON.stringify(restored) === JSON.stringify(original)
  console.log(
    restoreOk
      ? '\n  ✓ restored the original marks'
      : `\n  ✗ RESTORE FAILED — ${target.id} now holds ${JSON.stringify(restored)}, expected ${JSON.stringify(original)}`,
  )

  await browser.close()
}

console.log('\n────────────────────────────────────────────')
console.log(`Passed ${passed}`)
if (failed || !restoreOk) {
  console.log(`Failed ${failed}${restoreOk ? '' : ' (+1 restore)'}`)
  process.exit(1)
}
