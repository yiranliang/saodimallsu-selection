/**
 * Realtime check — proves the two-condition rule actually works.
 *   node scripts/smoke-realtime.mjs [baseUrl]
 *
 * Supabase Realtime fails silently: a channel with no SELECT policy simply
 * never fires, with no error anywhere. That is why this suite exists — it
 * inserts a throwaway product with a second client and waits for a browser that
 * never touched the database to notice.
 *
 *   · a signed-out storefront receives INSERT  → anon SELECT policy is enough
 *   · a signed-out storefront receives DELETE
 *   · the signed-in console receives both
 *
 * Cleanup runs in a finally block: the temp row is deleted even on failure.
 * Only side effect is a consumed id from products_id_seq, which is harmless —
 * ids are never reused by design.
 */

import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import { ENV, ADMIN_EMAIL, ADMIN_PASSWORD, hasAdminCredentials, signInAdmin, skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL_ = ENV.VITE_SUPABASE_URL
const KEY = ENV.VITE_SUPABASE_ANON_KEY

if (!hasAdminCredentials() || !URL_ || !KEY) {
  console.log('\n⚠ skipped — needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY + admin credentials in .env\n')
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

const SKU = `RT-TEST-${Date.now()}`
const NAME = `Realtime probe ${SKU}`

const db = createClient(URL_, KEY, { auth: { persistSession: false } })
const { error: signInError } = await db.auth.signInWithPassword({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
})
if (signInError) {
  console.log(`\n✗ could not sign in as the admin: ${signInError.message}\n`)
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: CHROME })
const anonPage = await browser.newPage({ viewport: { width: 480, height: 900 } })
await skipGuide(anonPage)
const adminPage = await browser.newPage({ viewport: { width: 900, height: 1000 } })

const cards = (page) => page.locator('article[aria-label^="View "]').count()

/* The storefront is paged, so a new row at sort_order 999999 is never on the
 * first batch. What "the storefront received it" means now is that the
 * in-memory catalogue grew — the grid is only a window onto that. */
const catalogueSize = (page) => page.evaluate(() => window.SAODIMALLSU?.products?.().length ?? -1)

/** Poll until `fn()` matches, or give up. Realtime is async; a fixed sleep is a flaky test. */
async function waitFor(fn, expected, timeout = 15000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await fn()
    if (last === expected) return { ok: true, value: last }
    await new Promise((r) => setTimeout(r, 250))
  }
  return { ok: false, value: last }
}

/** Same, but for "this must stop being true" — e.g. a row leaving the front. */
async function waitForNot(fn, value, timeout = 15000) {
  const started = Date.now()
  let seen
  while (Date.now() - started < timeout) {
    seen = await fn()
    if (seen !== value) return { ok: true, value: seen }
    await new Promise((r) => setTimeout(r, 250))
  }
  return { ok: false, value: seen }
}

/* The sku appears twice per row (sku cell + name), so counts are not a stable
 * assertion — presence/absence is. */
const waitForPresence = (page, text, present, timeout = 15000) =>
  waitFor(async () => ((await page.locator(`text=${text}`).count()) > 0) === present, true, timeout)

let inserted = false
/* set while the reorder probe has moved a real row, so `finally` can undo it */
let restoreOrder = null

try {
  /* ── 1. baseline ── */
  console.log('\n[1] Baseline')
  await anonPage.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await anonPage.waitForTimeout(2000)
  const anonBefore = await catalogueSize(anonPage)
  check('storefront loaded the catalogue', anonBefore > 0, true)
  check('the grid is paged', (await cards(anonPage)) > 0, true)

  await adminPage.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await signInAdmin(adminPage)
  await adminPage.waitForSelector('text=Product library', { timeout: 20000 })
  await adminPage.waitForTimeout(1200)

  /* ── 2. INSERT propagates ── */
  console.log('\n[2] INSERT')
  const { error: insertError } = await db.from('products').insert({
    sku: SKU,
    name: NAME,
    category: 'Uncategorised',
    image: './placeholders/placeholder.svg',
    specs: {},
    variant_images: {},
    hidden: false,
    tag: '',
    sort_order: 999999,
  })
  if (insertError) throw new Error(`insert failed: ${insertError.message}`)
  inserted = true

  const anonAfterInsert = await waitFor(() => catalogueSize(anonPage), anonBefore + 1)
  check('storefront picked up the new product', anonAfterInsert.ok, true)

  /* …and it is reachable: the search box is how you get to row 140 now.
   * Polled rather than slept: the box debounces, and on a cold dev server the
   * first keystroke can land before the realtime update has re-rendered the
   * grid, which used to show up as an intermittent "found 0". */
  await anonPage.locator('input[type="search"]').fill(SKU)
  const searched = await waitFor(() => cards(anonPage), 1)
  check('search finds the new product', searched.value, 1)

  const adminSawInsert = await waitForPresence(adminPage, SKU, true)
  check('console picked up the new product', adminSawInsert.ok, true)

  /* ── 3. DELETE propagates ── */
  console.log('\n[3] DELETE')
  const { error: deleteError } = await db.from('products').delete().eq('sku', SKU)
  if (deleteError) throw new Error(`delete failed: ${deleteError.message}`)
  inserted = false

  const anonAfterDelete = await waitFor(() => catalogueSize(anonPage), anonBefore)
  check('storefront dropped it again', anonAfterDelete.ok, true)

  /* the search is still holding the sku, so the grid must now be empty */
  const cardAfterDelete = await waitFor(() => cards(anonPage), 0)
  check('the searched row disappeared from the grid', cardAfterDelete.ok, true)

  await anonPage.locator('input[type="search"]').fill('')

  const adminSawDelete = await waitForPresence(adminPage, SKU, false)
  check('console dropped it again', adminSawDelete.ok, true)

  /* ── 4. a sort_order UPDATE reaches the storefront ──
   *
   * This is the promise the reorder buttons make: an operator hits "move to
   * top" and the creator's open tab re-sorts without a refresh. Realtime has to
   * fire on UPDATE, and the refetch has to preserve order — a refetch that
   * dropped `order by sort_order` would still pass every other test in this
   * file, because those only look at presence.
   *
   * The probe borrows the current first row: send it to the end, watch the
   * storefront's first row change, then put the number back. The restore runs
   * from `finally` as well, so a crash mid-test cannot leave the catalogue
   * permanently reordered.
   */
  console.log('\n[4] REORDER')

  const firstBefore = await anonPage.evaluate(() => window.SAODIMALLSU?.products?.()[0]?.id ?? null)
  check('the storefront has a first row', Boolean(firstBefore), true)

  const { data: probe, error: probeError } = await db
    .from('products')
    .select('id, sort_order')
    .eq('id', firstBefore)
    .single()
  if (probeError) throw new Error(`could not read the first row: ${probeError.message}`)
  restoreOrder = { id: probe.id, sortOrder: probe.sort_order }

  const { error: reorderError } = await db
    .from('products')
    .update({ sort_order: 999999 })
    .eq('id', probe.id)
  if (reorderError) throw new Error(`reorder failed: ${reorderError.message}`)

  const movedAway = await waitForNot(
    () => anonPage.evaluate(() => window.SAODIMALLSU?.products?.()[0]?.id ?? null),
    firstBefore,
  )
  check('the storefront re-sorted on its own', movedAway.ok, true)

  const { error: restoreError } = await db
    .from('products')
    .update({ sort_order: probe.sort_order })
    .eq('id', probe.id)
  if (restoreError) throw new Error(`restore failed: ${restoreError.message}`)
  restoreOrder = null

  const cameBack = await waitFor(
    () => anonPage.evaluate(() => window.SAODIMALLSU?.products?.()[0]?.id ?? null),
    firstBefore,
  )
  check('and it came back to the front', cameBack.ok, true)
} catch (err) {
  failed++
  console.log(`\n✗ ${err.message}`)
} finally {
  if (restoreOrder) {
    await db.from('products').update({ sort_order: restoreOrder.sortOrder }).eq('id', restoreOrder.id)
    console.log('  (cleanup: sort_order restored)')
  }
  if (inserted) {
    await db.from('products').delete().eq('sku', SKU)
    console.log('  (cleanup: temp product removed)')
  }
  await browser.close()
}

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
