/**
 * Browser check for the admin gate (Supabase Auth)
 *   node scripts/smoke-gate.mjs [baseUrl]
 *
 * Covers:
 *   · every /admin/* path is gated, not just the index
 *   · the admin DOM is absent while signed out — nothing can flash through
 *   · a wrong password shows a red error and keeps the gate up
 *   · the right password opens the console, and survives a reload
 *   · reorder (buttons, drag, filtered), the sold-out board, category order
 *   · the editor's ASIN panel reads the stored map, flags gaps, refuses a
 *     truncated ASIN, and a no-op save does not disturb the row
 *   · that panel is open on arrival, and a colour typed into the draft gets its
 *     own ASIN field immediately (nothing is saved)
 *   · a badge colour round-trips to the database and is painted by the
 *     storefront card, with readable text on it (skipped until 07-badge-color.sql)
 *   · the product list badges every product whose combinations lack an ASIN,
 *     with the same count the database says
 *   · size order: the stock grid, the ASIN list, the editor's option chips and
 *     the storefront sheet all read S → XXL on a product whose stored array is
 *     scrambled — and none of them rewrites the stored array (legacy v1/v2
 *     selection codes resolve options by position)
 *   · a drag survives editing and saving a different product, and survives a
 *     reload — a save must never write `sort_order`, and a stale catalogue read
 *     must never overwrite the dropped order
 *   · the editor's "View on Amazon" link sits under the image URL field, opens
 *     in a new tab, points at the FIRST ASIN the panel shows (not at whichever
 *     key jsonb returns first) and is absent when the product has none
 *   · the badge quick-fill templates write the text AND the colour in one
 *     click, keep the colour when the text is edited afterwards, replace both
 *     halves on a second click, and wrap inside their own column
 *   · dragging a colour photo onto the main image fills it in, says which
 *     colour it came from, is inert when dropped anywhere else, and the arrow
 *     on each card does the same thing without a mouse
 *   · the web import reads a CSV, previews four counts, writes new 货号
 *     hidden and merges into existing ones append-only — and 取消 writes
 *     nothing
 *   · the storefront pins badged styles above the rest of the catalogue while
 *     the admin list keeps raw `sort_order` — including a badge that sits eight
 *     batches down, a badge found by category and by search, and one whose text
 *     is cleared (it drops back into its own place)
 *   · renaming a colour moves its ASINs with it (both tables, every size), the
 *     change is reversible, and "delete the colour, add a new one" is NOT
 *     mistaken for a rename — it must show Missing ASIN and leave the old keys
 *     in the extras block instead of guessing
 *   · Log out re-locks, and the lock survives a reload
 *   · the storefront is untouched
 *   · nothing the run did is still in the table — the order at the end is the
 *     order it started with (a repair that restores an already-wrong snapshot
 *     passes every local check, so this one compares against the very beginning)
 *
 * Needs SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD in .env. Without them it
 * reports a skip rather than failing, so the suite stays runnable on a clone.
 */

import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { combinationsOf } from '../src/utils/soldOut.js'
import { isSortedSizes, sortSizes } from '../src/utils/sizes.js'
import { BADGE_TEMPLATES } from '../src/utils/badge.js'
import { DEAL_ITEMS } from '../src/utils/adminFilter.js'
import { ENV, ADMIN_EMAIL, ADMIN_PASSWORD, hasAdminCredentials, signInAdmin, skipGuide, GUIDE_SEEN_KEY, GUIDE_SEEN_VALUE } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

if (!hasAdminCredentials()) {
  console.log('\n⚠ skipped — SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD not set in .env')
  console.log('  The gate is Supabase Auth now; these tests need a real admin account.\n')
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
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
/* The storefront opens an onboarding guide on a first visit, and a fresh
 * Playwright context always looks like a first visit. `[5y]` tests that flow in
 * its own context; every other section wants the grid, not a modal over it. */
await skipGuide(page)

const consoleErrors = []
const toleratedErrors = []
const badRequestUrls = []
page.on('pageerror', (err) => consoleErrors.push(String(err)))
/* PostgREST answers 400 — not 404 — when a select names a column that does not
   exist. `productStore` catches it and falls back, so the site is fine; the
   only trace is the request itself. Record the URLs so the console line can be
   attributed, since the console message carries no URL of its own. */
page.on('response', (res) => {
  if (res.status() !== 400) return
  const url = res.url()
  if (/\/auth\/v1\/token/.test(url)) return // the deliberate bad-password step
  badRequestUrls.push(url)
})
page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  /* The deliberate bad-password step makes Supabase answer 400 on
   * /auth/v1/token. That is the test doing its job, not a regression — but a
   * 400 from /rest/v1 would be real, so filter on the URL, not the status. */
  const url = msg.location()?.url || ''
  if (/\/auth\/v1\/token/.test(url)) return
  /* Two tables arrive with their own migration and are optional:
   *   product_links — supabase/04-product-links.sql
   *   settings      — supabase/12-settings.sql
   * Both are asked for once per boot and the app stays quiet on failure, so the
   * 404 is expected noise until the operator runs the SQL. */
  if (/\/rest\/v1\/product_links|\/rest\/v1\/settings|favicon\.ico/.test(url)) {
    toleratedErrors.push(msg.text())
    return
  }
  consoleErrors.push(msg.text())
})

/* Selectors that only exist inside the unlocked admin shell */
const gate = () => page.locator('[role="dialog"][aria-modal="true"]')
const emailField = () => page.locator('input[aria-label="Email"]')
const passwordField = () => page.locator('input[aria-label="Password"]')
const errorText = () => page.locator('#access-gate-error')
const adminTabs = () => page.locator('nav a[href="#/admin/products"]')
const lookupInput = () => page.locator('#code-input')
/* 后台已汉化，页面标题是「商品库」。 */
const productLibrary = () => page.locator('h1', { hasText: '商品库' })

const sessionKeys = () =>
  page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.includes('auth-token')),
  )

/* ── 1. every admin path is gated ── */
console.log('\n[1] Route coverage')
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })
check('gate is a modal dialog', await gate().count(), 1)
check('email field present', await emailField().count(), 1)
check('password field present', await passwordField().count(), 1)

for (const [path, probe, label] of [
  ['#/admin/products', productLibrary, 'Product library'],
  ['#/admin/developer', () => page.locator('text=选品码'), '选品码'],
  ['#/admin/not-a-real-page', productLibrary, 'Product library'],
]) {
  await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })
  check(`${path} is gated`, await gate().count(), 1)
  check(`${path} leaks no ${label}`, await probe().count(), 0)
}

/* ── 2. nothing from the admin shell is in the DOM ── */
console.log('\n[2] No underlying content')
check('no admin tab bar', await adminTabs().count(), 0)
check('no lookup input', await lookupInput().count(), 0)
check('no product library', await productLibrary().count(), 0)

/* ── 3. wrong password ── */
console.log('\n[3] Wrong password')
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })

await emailField().fill(ADMIN_EMAIL)
await passwordField().fill('definitely-not-the-password')
await page.getByRole('button', { name: '登录', exact: true }).click()
/* Poll instead of sleeping. The round-trip belongs to Supabase; a fixed 2.5 s
 * wait failed once on a loaded machine while the error arrived 200 ms later —
 * and every check after it then read a page that was still mid-transition. */
const errorAppeared = await errorText()
  .first()
  .waitFor({ state: 'visible', timeout: 20000 })
  .then(() => true)
  .catch(() => false)

check('error is shown', errorAppeared, true)
check('error is red', (await errorText().getAttribute('class')).includes('text-red-600'), true)
check('error is announced', await errorText().getAttribute('role'), 'alert')
check('gate still up', await gate().count(), 1)
check('admin still absent', await lookupInput().count(), 0)
check('password cleared', await passwordField().inputValue(), '')
check('no session written', await sessionKeys(), [])

await page.getByRole('button', { name: '登录', exact: true }).click()
await page.waitForTimeout(400)
check(
  'empty submit warns',
  (await errorText().innerText()).includes('请输入邮箱和密码。'),
  true,
)

/* ── 4. correct password ── */
console.log('\n[4] Sign in')
await emailField().fill(ADMIN_EMAIL)
await passwordField().fill(ADMIN_PASSWORD)

/* Three attempts, values re-entered each time: a click that lands while the
 * previous auth request is still in flight gets swallowed (the button is busy),
 * and that is a property of the network, not of the gate. A bad password would
 * still fail all three, so this cannot hide a real break. */
let signedIn = false
for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
  await emailField().fill(ADMIN_EMAIL)
  await passwordField().fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  signedIn = await page
    .waitForSelector('#code-input', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  if (!signedIn) await page.waitForTimeout(1200)
}
check('the console opened', signedIn, true)

check('gate gone', await gate().count(), 0)
check('lookup input rendered', await lookupInput().count(), 1)
check('admin tabs rendered', await adminTabs().count(), 1)
check('a session token was stored', (await sessionKeys()).length > 0, true)

/* ── 5. the session sticks for this tab ── */
console.log('\n[5] Session persistence')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('still signed in after reload', await gate().count(), 0)

await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('sibling admin page stays open', await gate().count(), 0)
check('product library rendered', await productLibrary().count(), 1)

/* ── 5b. Reorder ──
 *
 * "Move to top" writes ONE number (`min - 1`) rather than reindexing every row,
 * and "move up/down" swaps two. The thing worth testing is not the maths but
 * that the write reaches Postgres and survives a reload — a purely local
 * reorder would look perfect and be lost on refresh.
 *
 * The test takes the LAST row, sends it to the top, reloads, then sends it back
 * to the bottom. Visible order ends exactly where it started.
 * Side effect: that one row's sort_order becomes `max + 1` instead of `max`.
 * Ordering is unchanged and nothing asserts that the numbers stay dense.
 */
console.log('\n[5b] Reorder')

/* A second, direct connection to the same database — used by the reorder tests
 * to read the real `sort_order` column and to put it back. Created here because
 * both [5b] and [5c] need it, and [5b] restores through the RPC as well. */
const db = createClient(ENV.VITE_SUPABASE_URL, ENV.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})
const { error: dbAuthError } = await db.auth.signInWithPassword({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
})
if (dbAuthError) throw new Error(`reorder test could not sign in: ${dbAuthError.message}`)

const orderIds = async () => {
  const { data, error } = await db.from('products').select('id').order('sort_order')
  if (error) throw new Error(error.message)
  return data.map((row) => row.id)
}

/** The whole catalogue order as this run found it, for the last section to check. */
const catalogueOrderAtStart = await orderIds()

/**
 * Put the catalogue order back and *prove* it stuck.
 *
 * One RPC is not enough. The app's own drag handler writes `reorder_products`
 * too, and its request can still be in flight when cleanup runs: the restore
 * lands first, the stale drop lands 200ms later, and every check above still
 * passes because they compare the DOM, not the table. That is exactly how a
 * previous run left the live catalogue rotated by one row with a green run.
 * Writing twice with a pause in between makes the race lose.
 */
async function restoreOrder(snapshot, label = 'order') {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await db.rpc('reorder_products', { p_ids: snapshot })
    if (error) {
      console.log(`  ⚠ could not restore the ${label}: ${error.message}`)
      return false
    }
    await page.waitForTimeout(700)
    if (JSON.stringify(await orderIds()) === JSON.stringify(snapshot)) return true
    if (attempt === 1) console.log(`  · the ${label} drifted again — restoring a second time`)
  }
  console.log(`  ⚠ the ${label} still differs from the snapshot after two attempts`)
  return false
}

/** aria-label → heading, in DOM order (= catalogue order). */
const rowHeadings = () =>
  page.$$eval('[aria-label$=" to top"]', (els) =>
    els.map((el) => el.getAttribute('aria-label').replace(/^Move /, '').replace(/ to top$/, '')),
  )

/** Poll until the first row's heading matches, or give up. */
async function waitForFirstRow(heading, timeout = 8000) {
  const started = Date.now()
  let seen = null
  while (Date.now() - started < timeout) {
    seen = (await rowHeadings())[0] ?? null
    if (seen === heading) return { ok: true, seen }
    await page.waitForTimeout(200)
  }
  return { ok: false, seen }
}

const before = await rowHeadings()
check('the library has rows', before.length > 1, true)

const lastHeading = before[before.length - 1]
const lastToTop = page.locator(`[aria-label="Move ${lastHeading} to top"]`)
const lastToBottom = page.locator(`[aria-label="Move ${lastHeading} to bottom"]`)

check('the last row cannot move down', await lastToBottom.isDisabled(), true)
check('the last row can move to the top', await lastToTop.isDisabled(), false)

/* Snapshot the ids BEFORE touching anything. Restoring by clicking "to bottom"
 * is not the inverse of "to top": it writes `max + 1`, so a run that started
 * with drifted sort_order numbers ends up with a different order than it began
 * with — which is how this test silently reordered the live catalogue once. One
 * RPC with the snapshot is exact, and `finally` runs even if an assertion throws. */
const orderBefore = await orderIds()

try {
  await lastToTop.click()
  check('it is now the first row', (await waitForFirstRow(lastHeading)).ok, true)

  /* A reload is the only proof that the number landed in the table rather than
   * only in the in-memory cache. */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  check('the move survived a reload', (await waitForFirstRow(lastHeading)).ok, true)
  check('the first row cannot move up', await page
    .locator(`[aria-label="Move ${lastHeading} to top"]`)
    .isDisabled(), true)
} finally {
  await restoreOrder(orderBefore)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
}

check('the original order is restored', await rowHeadings(), before)


/* ── 5c. Drag and drop ──
 *
 * The drag path is a different write from [5b]: instead of one UPDATE it calls
 * `reorder_products(ids)`, which rewrites the whole column in one transaction.
 * What is worth testing is that a *pointer gesture* triggers it at all — the
 * 6px activation threshold, the sortable context, and the id array all have to
 * line up, and none of that is visible from the code.
 *
 * The test is self-healing: it snapshots the full order from the database,
 * performs the drag, then restores through the same RPC in `finally`. A crash
 * halfway through therefore leaves the catalogue in its original order rather
 * than in whatever half-sorted state the gesture produced.
 */
console.log('\n[5c] Drag and drop')

let dragSnapshot = null

try {
  dragSnapshot = await orderIds()
  check('the catalogue has rows to drag', dragSnapshot.length > 3, true)

  const rows = await rowHeadings()
  const fromHeading = rows[0]
  const toHeading = rows[2]
  check('two different rows picked', fromHeading !== toHeading, true)

  /* Make sure both cards are actually in the viewport before measuring: the
   * previous section left the page scrolled wherever its last click landed, and
   * mouse coordinates are viewport-relative. */
  await page.locator(`input[aria-label="Select ${fromHeading}"]`).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  /* The card is the checkbox's parent — measure that, not the checkbox.
   * From `md` up the list is a 3-column grid, so the third card is to the
   * RIGHT of the first, not below it. Dragging by y alone (which is what this
   * test used to do) would never leave the first card. Aim at the centre of
   * the target card instead, which works in both layouts. */
  const cardBox = (heading) =>
    page.locator(`input[aria-label="Select ${heading}"]`).locator('xpath=..').boundingBox()

  const fromBox = await cardBox(fromHeading)
  const toBox = await cardBox(toHeading)
  check('both rows are on screen', Boolean(fromBox && toBox), true)

  const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const start = centre(fromBox)
  const end = centre(toBox)

  /* A real gesture: press, pass the 6px threshold, travel to the target, release. */
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y + 14, { steps: 4 })
  await page.waitForTimeout(200)
  await page.mouse.move(end.x, end.y, { steps: 20 })
  await page.waitForTimeout(300)
  await page.mouse.up()

  /* The toast auto-dismisses after 2s — read it before it goes. */
  await page.waitForTimeout(700)
  check('a toast confirms the drop', await page.locator('text=/已移到第 \\d+ 位/').count(), 1)

  await page.waitForTimeout(1200)
  const afterDrag = await orderIds()
  const movedId = dragSnapshot[0]
  check('the dragged row landed where it was dropped', afterDrag.indexOf(movedId), 2)
  check('the row count did not change', afterDrag.length, dragSnapshot.length)

  /* Reload: proves the RPC wrote to Postgres, not just to the cache. */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  check('the new order survived a reload', (await rowHeadings())[2], fromHeading)

  /* Filtered → dragging must be off.
   *
   * The RPC rewrites the whole sort_order column from the id array it receives,
   * so a drag on a 3-row search result would claim positions 0..2 for those
   * three and shove the other 192 down. The SQL function rejects a partial
   * array (count mismatch), but the correct behaviour is that the gesture does
   * nothing at all — an error toast for something the user could not have known
   * was illegal is worse than no gesture. */
  /* Pick the filter term from the data instead of blind-slicing one heading.
   * A 货号 prefix that happens to match a single product is not a failure — it
   * just cannot exercise "drag is off while filtering", which needs two cards.
   * That made the two checks below disappear silently on some runs. Any prefix
   * matching 2..n-1 rows will do; the shortest such prefix keeps the list short. */
  const narrowTerm = (() => {
    const total = dragSnapshot.length
    for (const length of [2, 3, 4, 5, 6]) {
      const counts = new Map()
      for (const heading of dragSnapshot) {
        const key = String(heading).slice(0, length).toUpperCase()
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      const hit = [...counts]
        .filter(([, count]) => count >= 2 && count < total)
        .sort((a, b) => a[1] - b[1])[0]
      if (hit) return hit[0]
    }
    return ''
  })()

  await page
    .locator('input[placeholder^="搜索货号"]')
    .fill(narrowTerm || rows[1].slice(0, 4))
  await page.waitForTimeout(900)
  const filtered = await rowHeadings()
  if (narrowTerm) check('the filter term was found in the catalogue', filtered.length >= 2, true)
  check('the filter narrowed the list', filtered.length < dragSnapshot.length, true)

  if (filtered.length >= 2) {
    const beforeFilteredDrag = await orderIds()
    const a = centre(await cardBox(filtered[0]))
    const b = centre(await cardBox(filtered[1]))
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x, a.y + 14, { steps: 4 })
    await page.waitForTimeout(150)
    await page.mouse.move(b.x, b.y, { steps: 15 })
    await page.waitForTimeout(250)
    await page.mouse.up()
    await page.waitForTimeout(900)

    check('dragging is off while filtering', await orderIds(), beforeFilteredDrag)
    check('the filtered order is unchanged on screen', await rowHeadings(), filtered)
  }

  await page.locator('input[placeholder^="搜索货号"]').fill('')
  await page.waitForTimeout(700)
} finally {
  if (dragSnapshot) {
    const ok = await restoreOrder(dragSnapshot, 'original order')
    console.log(ok ? '  (cleanup: original order restored)' : '  ⚠ the order is NOT restored')
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
  }
}
check('the catalogue is back in its original order', await rowHeadings(), before)


/* ── 5d. Sold-out board ──
 *
 * The board answers one question: "what do I have to re-order?" So the test
 * checks the three things that make the answer usable — the filter really
 * narrows to products with a dead variant, the export names the variant and its
 * ASIN, and a mark can be cleared from here without opening the editor.
 *
 * Clearing a mark writes to the live catalogue, so the original value is read
 * first and written back in `finally`.
 */
console.log('\n[5d] Sold-out board')

const { data: markedRows, error: markedError } = await db
  .from('products')
  .select('id, sku, sold_out_variants')
if (markedError) throw new Error(markedError.message)

const marked = markedRows.filter(
  (row) => Array.isArray(row.sold_out_variants) && row.sold_out_variants.length > 0,
)
let soldOutRestore = null

try {
  if (marked.length === 0) {
    console.log('  · nothing is marked sold out — skipping the board checks')
  } else {
    await page.getByRole('button', { name: '只看断货' }).click()
    await page.waitForTimeout(700)

    const shown = await rowHeadings()
    check('the board shows only marked styles', shown.length, marked.length)
    check('the marked style is on screen', shown.includes(marked[0].sku || marked[0].id), true)

    const variants = marked.reduce((sum, row) => sum + row.sold_out_variants.length, 0)
    /* 后台已汉化：横幅写的是「N 个规格断货，涉及 M 款商品」。 */
    const banner = await page.locator('text=/个规格断货/').first().textContent()
    check('the banner counts variants', banner.includes(String(variants)), true)

    /* Export → clipboard. The payload is plain text on purpose, so assert the
     * shape rather than the whole string: 货号 on one line, `Colour / Size` and
     * an ASIN under it. */
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: '导出断货清单' }).click()
    await page.waitForTimeout(500)
    const exported = await page.evaluate(() => navigator.clipboard.readText())
    const firstKey = marked[0].sold_out_variants[0]
    const [colour, size] = firstKey.split('|')
    check('the export names the 货号', exported.includes(marked[0].sku), true)
    check('the export names the variant', exported.includes(`${colour} / ${size}`), true)
    check('the export has a header line', /^Saodimallsu · sold out · \d{4}-\d{2}-\d{2}/.test(exported), true)

    /* Clear one mark from the board.
     *
     * The chip's aria-label is `Mark <Colour / Size> of <货号> back in stock`,
     * and that is the only reliable link between "the button I clicked" and
     * "the row I then read back". Taking `marked[0]` instead would be a bug
     * that hides whenever exactly one product is marked: PostgREST returns the
     * rows in arbitrary order, while the board is sorted by sort_order, so the
     * first chip on screen is not necessarily the first row in that array. */
    const chip = page.locator('button[aria-label*="back in stock"]').first()
    const chipLabel = await chip.getAttribute('aria-label')
    const chipSku = chipLabel?.match(/^Mark .+ of (.+) back in stock$/)?.[1]
    check('the chip names its 货号', Boolean(chipSku), true)

    const { data: beforeClear } = await db
      .from('products')
      .select('id, sold_out_variants')
      .eq('sku', chipSku)
      .single()
    soldOutRestore = { id: beforeClear.id, list: beforeClear.sold_out_variants }

    await chip.click()
    await page.waitForTimeout(1500)

    const { data: afterClear } = await db
      .from('products')
      .select('sold_out_variants')
      .eq('id', beforeClear.id)
      .single()
    check(
      'one mark was cleared in the database',
      afterClear.sold_out_variants.length,
      Math.max(0, beforeClear.sold_out_variants.length - 1),
    )

    await page.getByRole('button', { name: '只看断货' }).click()
    await page.waitForTimeout(500)
  }
} finally {
  if (soldOutRestore) {
    const { error } = await db
      .from('products')
      .update({ sold_out_variants: soldOutRestore.list })
      .eq('id', soldOutRestore.id)
    console.log(
      error ? `  ⚠ could not restore sold-out marks: ${error.message}` : '  (cleanup: sold-out marks restored)',
    )
  }
}


/* ── 5e. Category order ──
 *
 * The rail on the storefront reads `categories.sort_order`, so moving a row
 * here has to change that column — not just the array in memory. The test moves
 * the first category down one, checks the database, then moves it back.
 */
console.log('\n[5e] Category order')

const categoryOrder = async () => {
  const { data, error } = await db.from('categories').select('name, sort_order').order('sort_order')
  if (error) throw new Error(error.message)
  return data.map((row) => row.name)
}

const catsBefore = await categoryOrder()
check('there are at least two categories', catsBefore.length >= 2, true)

await page.getByRole('button', { name: /^分类/ }).click()
await page.waitForTimeout(500)
check('the category panel opened', await page.locator('input[aria-label^="Rename "]').count() >= 2, true)

await page.locator(`button[aria-label="Move ${catsBefore[0]} down"]`).click()
await page.waitForTimeout(1500)
const catsAfter = await categoryOrder()
check('the database order changed', catsAfter[0], catsBefore[1])
check('the two swapped places', catsAfter[1], catsBefore[0])

/* The rail renders `SAODIMALLSU.categories()` — the store the admin just updated —
 * so this is the front-end half of "the storefront follows the new order". */
const railOrder = await page.evaluate(() => window.SAODIMALLSU?.categories?.() ?? [])
check('the store order matches the database', railOrder.slice(0, 2), catsAfter.slice(0, 2))

/* Put it back: the row that is now second moves up. */
await page.locator(`button[aria-label="Move ${catsBefore[0]} up"]`).click()
await page.waitForTimeout(1500)
check('the category order is restored', await categoryOrder(), catsBefore)


/* ── 5f. ASIN panel ──
 *
 * The editor's ASIN block is the only place an ASIN is typed by hand, so what
 * matters is: it reads the stored map, one field per colour × size, missing
 * combinations are visibly flagged, a truncated ASIN is refused (nothing fails
 * until somebody packs the wrong listing), and a save round-trips without losing
 * keys.
 *
 * The save here is a NO-OP on purpose: the field is put back to its stored value
 * before clicking. A test that invents an ASIN would be writing fiction into the
 * production table; the write path is proven just as well by a save that leaves
 * the row byte-identical. `finally` still repairs the row if it ever drifts.
 */
console.log('\n[5f] ASIN panel')

const { data: asinTable, error: asinTableError } = await db.from('asins').select('sku, variants')
if (asinTableError) throw new Error(asinTableError.message)

const { data: catalogueRows, error: catalogueRowsError } = await db
  .from('products')
  .select('id, sku, name, specs, sort_order, hidden')
if (catalogueRowsError) throw new Error(catalogueRowsError.message)

const asinBySku = new Map(asinTable.map((row) => [row.sku, row.variants || {}]))

const axisOf = (specs, pattern) => {
  for (const [type, values] of Object.entries(specs || {})) {
    if (pattern.test(type)) return Array.isArray(values) ? values : [values]
  }
  return []
}

/** The spec type name that owns an axis (for aria-labels like `Colour value 3`). */
const axisTypeOf = (specs, pattern) => {
  for (const [type] of Object.entries(specs || {})) {
    if (pattern.test(type)) return type
  }
  return ''
}

/** Order-insensitive comparison for a variant map / JSON blob. */
const fingerprint = (value) =>
  JSON.stringify(
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      : value,
  )

const asinTarget = catalogueRows.find((row) => {
  const variants = asinBySku.get(row.sku)
  if (!variants || !Object.keys(variants).length) return false
  const colours = axisOf(row.specs, /colou?r|颜色/i)
  const sizes = axisOf(row.specs, /size|尺码|尺寸/i)
  return colours.length + sizes.length > 0
})

check('a product with stored ASINs exists to test with', Boolean(asinTarget), true)

if (asinTarget) {
  const colours = axisOf(asinTarget.specs, /colou?r|颜色/i)
  const sizes = axisOf(asinTarget.specs, /size|尺码|尺寸/i)
  const expectedInputs =
    colours.length && sizes.length ? colours.length * sizes.length : colours.length || sizes.length
  const originalVariants = asinBySku.get(asinTarget.sku) || {}

  try {
    /* This section is the only one that cares about the layout of the editor
     * rather than its behaviour, and the layout is responsive: below `lg` the
     * dialog is a single 576px sheet and everything stacks, which is correct.
     * Measure at a desktop size, then put the window back for the sections that
     * follow (they were written at 900px). */
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    const searchInput = page.locator('input[placeholder^="搜索货号"]')
    await searchInput.fill(asinTarget.sku)
    await page.waitForTimeout(800)

    const editButton = page.locator(`[aria-label="Edit ${asinTarget.name}"]`).first()
    check('searching the 货号 finds exactly that product', await editButton.count(), 1)
    await editButton.click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(600)

    const skuField = page.locator('[role="dialog"] input[placeholder="AMZ-1003"]')
    check('the editor opened on the right 货号', await skuField.inputValue(), asinTarget.sku)

    /* The block is a plain section now, not a disclosure: it used to be a
     * `<button aria-expanded>` that happened to start open, which meant a stray
     * click could hide it — and, sitting under the options list, it was 500px
     * below the fold with the dialog's scrollbar hidden. Both are regressions
     * worth pinning: no chevron, and on screen at 1440×900 without scrolling. */
    const asinPanel = page.locator('[role="dialog"] section[aria-label="ASINs"]')
    check('the editor has an ASIN panel', await asinPanel.count(), 1)
    check(
      'the ASIN panel cannot be collapsed',
      await asinPanel.locator('button[aria-expanded]').count(),
      0,
    )
    const panelBox = await asinPanel.boundingBox()
    check('the panel is on screen when the editor opens', panelBox.y < 700, true)
    await page.waitForTimeout(300)

    const asinInputs = page.locator('[role="dialog"] input[aria-label^="ASIN for "]')
    check('one field per colour × size', await asinInputs.count(), expectedInputs)

    const fieldValues = await asinInputs.evaluateAll((els) => els.map((el) => el.value))
    const fieldPlaceholders = await asinInputs.evaluateAll((els) => els.map((el) => el.placeholder))
    check('stored ASINs are shown', fieldValues.filter(Boolean).length > 0, true)
    check(
      'every empty combination says it is missing',
      fieldPlaceholders.filter((text) => text === '缺 ASIN').length,
      fieldValues.filter((value) => !value).length,
    )

    /* A nine-character ASIN is an order for the wrong listing. */
    const firstField = asinInputs.first()
    const storedValue = await firstField.inputValue()
    await firstField.fill('ABC')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(600)
    check('a truncated ASIN is refused', await page.locator('text=/不是 10 位/').count(), 1)
    check('and the editor stays open', await page.locator('[role="dialog"]').count(), 1)

    /* Put the real value back, then save: the upsert runs, the row does not move. */
    await firstField.fill(storedValue)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(1500)
    check('saving closes the editor', await page.locator('[role="dialog"]').count(), 0)

    const { data: afterAsins, error: afterAsinsError } = await db
      .from('asins')
      .select('sku, variants')
      .eq('sku', asinTarget.sku)
    if (afterAsinsError) throw new Error(afterAsinsError.message)
    check('the 货号 still has exactly one ASIN row', afterAsins.length, 1)
    check(
      'no ASIN was lost or rewritten by the save',
      fingerprint(afterAsins[0].variants),
      fingerprint(originalVariants),
    )

    await searchInput.fill('')
    await page.waitForTimeout(400)
  } finally {
    /* Back to the size the rest of the suite was written against. */
    await page.setViewportSize({ width: 900, height: 1000 })
    const { data: repair } = await db
      .from('asins')
      .select('variants')
      .eq('sku', asinTarget.sku)
    if (repair?.[0] && fingerprint(repair[0].variants) !== fingerprint(originalVariants)) {
      await db.from('asins').update({ variants: originalVariants }).eq('sku', asinTarget.sku)
      console.log('  · restored the ASIN map for', asinTarget.sku)
    }
  }
}

/* ── 5h. The ASIN panel follows the draft, not just the imports ──
 *
 * The old complaint: add a colour in the editor and there is nowhere to put its
 * ASIN, because the panel only ever listed combinations that were already in the
 * `asins` table. The rows are now derived from the draft specs, so a colour typed
 * a second ago must have a field of its own immediately.
 *
 * Nothing is saved — the editor is closed with Escape, and the specs/variants
 * are compared afterwards to prove the test itself wrote nothing.
 */
console.log('\n[5h] ASIN follows the draft')

if (asinTarget) {
  const colourType = axisTypeOf(asinTarget.specs, /colou?r|颜色/i)
  const sizeType = axisTypeOf(asinTarget.specs, /size|尺码|尺寸/i)
  const colours = axisOf(asinTarget.specs, /colou?r|颜色/i)
  const sizes = axisOf(asinTarget.specs, /size|尺码|尺寸/i)
  const newColour = 'ZZTEST'
  const rowsPerColour = sizes.length || 1

  const specsFingerprint = JSON.stringify(asinTarget.specs)
  const asinFingerprint = fingerprint(asinBySku.get(asinTarget.sku) || {})

  try {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const searchInput = page.locator('input[placeholder^="搜索货号"]')
    await searchInput.fill(asinTarget.sku)
    await page.waitForTimeout(800)
    await page.locator(`[aria-label="Edit ${asinTarget.name}"]`).first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(500)

    const dialog = page.locator('[role="dialog"]')
    const asinInputs = dialog.locator('input[aria-label^="ASIN for "]')
    const rowsBefore = await asinInputs.count()
    check('the panel lists the saved combinations', rowsBefore > 0, true)

    /* Exactly one colour group exists, and its button says "Add colour" — the
     * size group's just says "Add", so this cannot hit the wrong group. */
    const addColour = dialog.getByRole('button', { name: '添加颜色', exact: true })
    check('the colour group can take another option', await addColour.count(), 1)
    await addColour.click()
    await page.waitForTimeout(200)

    const newOption = dialog.locator(`input[aria-label="${colourType} value ${colours.length + 1}"]`)
    check('a new colour field appeared', await newOption.count(), 1)
    await newOption.fill(newColour)
    await page.waitForTimeout(400)

    check(
      'the ASIN panel grew by one row per size',
      await asinInputs.count(),
      rowsBefore + rowsPerColour,
    )

    const label = sizes.length ? `${newColour} / ${sizes[0]}` : newColour
    const newRow = dialog.locator(`input[aria-label="ASIN for ${label}"]`)
    check(`the new combination has its own ASIN field (${label})`, await newRow.count(), 1)
    check('and it starts empty', await newRow.first().inputValue(), '')
    check('and it is flagged as missing', await newRow.first().getAttribute('placeholder'), '缺 ASIN')

    /* And it is on screen, not just in the DOM. The list is scroll-capped, so a
     * new colour's rows are appended at the bottom: without the auto-scroll the
     * field exists but the user is looking at "Dark Blue / S" and concludes
     * nothing happened. */
    const inView = await newRow.first().evaluate((el) => {
      const list = el.closest('div.max-h-72')
      if (!list) return false
      const row = el.getBoundingClientRect()
      const box = list.getBoundingClientRect()
      return row.top >= box.top - 1 && row.bottom <= box.bottom + 1
    })
    check('the new row was scrolled into view', inView, true)

    /* The row belongs to no stored key, so it carries the "new" marker. */
    check('the new row is marked new', await dialog.locator('span', { hasText: /^新$/ }).count() > 0, true)

    /* Close without saving — through the Cancel button, then PROVE the dialog is
     * gone. `Escape` was the first attempt and the modal does not listen for it,
     * so the editor stayed open with the fabricated colour in state and the next
     * section's save wrote it into the catalogue. */
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForTimeout(600)
    check('the editor closed without saving', await page.locator('[role="dialog"]').count(), 0)
  } finally {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
  }

  const { data: afterSpecs } = await db.from('products').select('specs').eq('id', asinTarget.id).single()
  check('nothing was written to specs', JSON.stringify(afterSpecs?.specs), specsFingerprint)
  const { data: afterVariants } = await db
    .from('asins')
    .select('variants')
    .eq('sku', asinTarget.sku)
    .maybeSingle()
  check(
    'nothing was written to the ASIN map',
    fingerprint(afterVariants?.variants || {}),
    asinFingerprint,
  )
}

/* ── 5i. Badge colour ──
 *
 * Three things fail silently if this breaks, so all three are checked:
 * the colour reaches the database, the storefront paints it, and the text on it
 * stays readable. Skipped (loudly) until supabase/07-badge-color.sql has run —
 * the app itself treats a missing column as "no custom colours".
 */
console.log('\n[5i] Badge colour')

const { error: badgeColumnError } = await db.from('products').select('id, badge_color').limit(1)

if (badgeColumnError) {
  console.log('  · skipped — badge_color 列不存在，先跑 supabase/07-badge-color.sql')
} else if (!asinTarget) {
  console.log('  · skipped — no target product')
} else {
  const PRESET_HEX = '#B3453A'
  const PRESET_RGB = 'rgb(179, 69, 58)'
  const CREAM_RGB = 'rgb(250, 248, 245)'
  const tempTag = `ZZ-${String(Date.now()).slice(-4)}`

  const { data: beforeBadge } = await db
    .from('products')
    .select('id, tag, badge_color')
    .eq('id', asinTarget.id)
    .single()

  try {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const searchInput = page.locator('input[placeholder^="搜索货号"]')
    await searchInput.fill(asinTarget.sku)
    await page.waitForTimeout(800)
    await page.locator(`[aria-label="Edit ${asinTarget.name}"]`).first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(500)

    const dialog = page.locator('[role="dialog"]')
    const badgeText = dialog.locator('input[aria-label="Badge text"]')
    check('the editor has a badge text field', await badgeText.count(), 1)
    check('and a colour picker', await dialog.locator('input[aria-label="Badge colour"]').count(), 1)

    await badgeText.fill(tempTag)
    await dialog.getByRole('button', { name: 'Badge colour Red', exact: true }).click()
    await page.waitForTimeout(300)

    /* The preview pill sits on the product photo, so the colour is judged
     * against the garment rather than against a swatch. */
    const previewColor = await dialog
      .locator('span', { hasText: tempTag })
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    check('the preview pill takes the picked colour', previewColor, PRESET_RGB)

    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(1500)

    const { data: saved } = await db
      .from('products')
      .select('tag, badge_color')
      .eq('id', asinTarget.id)
      .single()
    check('the badge text saved', saved?.tag, tempTag)
    check('the colour saved to badge_color', saved?.badge_color, PRESET_HEX)

    /* The storefront is the only place that proves the value is actually used. */
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const painted = await page.evaluate((tag) => {
      const el = Array.from(document.querySelectorAll('span')).find(
        (node) => node.textContent.trim() === tag,
      )
      if (!el) return null
      const style = getComputedStyle(el)
      return { background: style.backgroundColor, color: style.color }
    }, tempTag)
    check('a storefront card badge is visible', Boolean(painted), true)
    check('the card paints the custom colour', painted?.background, PRESET_RGB)
    check('the text on it is the readable one', painted?.color, CREAM_RGB)
  } finally {
    /* Restore at the database level: the browser may have died halfway, and a
     * leftover ZZ- tag would show up on the live storefront. */
    await db
      .from('products')
      .update({ tag: beforeBadge?.tag ?? '', badge_color: beforeBadge?.badge_color ?? null })
      .eq('id', asinTarget.id)
    console.log('  · restored the badge to its previous look')
  }

  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

/* ── 5i.1 The colour that cannot be saved says so ──
 *
 * The bug report was "I picked a badge colour and the storefront ignored it".
 * The storefront was innocent — the value never reached the database, because
 * `badge_color` does not exist and the store strips unknown columns from every
 * write. What made it expensive to find was the silence: the editor accepted the
 * colour and the save said "Changes saved".
 *
 * So this section tests the diagnostic, not the feature. On a database that has
 * run 07-badge-color.sql it asserts the warning is *absent*; on one that has not,
 * it asserts the editor warns, names the file, and that the save toast admits the
 * colour was dropped.
 */
console.log('\n[5i.1] Badge colour diagnostic')

if (!asinTarget) {
  console.log('  · skipped — no target product')
} else {
  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.locator('input[placeholder^="搜索货号"]').fill(asinTarget.sku)
  await page.waitForTimeout(700)
  await page.locator(`[aria-label="Edit ${asinTarget.name}"]`).first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(500)

  const dialog = page.locator('[role="dialog"]')
  const warning = dialog.locator('[data-badge-column-missing]')

  if (badgeColumnError) {
    check('the editor warns that the badge colour cannot be stored', await warning.count(), 1)
    const text = (await warning.innerText()).replace(/\s+/g, ' ')
    check('the warning names the column', /badge_color/.test(text), true)
    check('and the file to run', /07-badge-color\.sql/.test(text), true)

    await dialog.getByRole('button', { name: 'Badge colour Red', exact: true }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(1500)

    const toast = (await page.locator('[role="status"]').allInnerTexts()).join(' ')
    check('the save toast does not claim the colour was saved', /没写进去/.test(toast), true)
    check('and points at the missing column', /badge_color/.test(toast), true)

    /* Nothing was written that needs repairing — but the tag did get saved, and
     * the product is left with whatever it had. Re-open once to make sure the
     * dialog closed cleanly and the list still renders. */
    check('the editor closed', await page.locator('[role="dialog"]').count(), 0)
  } else {
    check('no warning when the column exists', await warning.count(), 0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForTimeout(400)
  }
}

/* ── 5j. The list flags missing ASINs without opening anything ──
 *
 * The editor can only warn about the product in front of you. This badge is the
 * answer to "which of 195 products still need an ASIN", so it has to be on the
 * card and it has to agree with the database.
 *
 * Expected numbers are recomputed from the same rows the page loaded
 * (`catalogueRows` + the asins table) — the point is the wiring: sku lookup,
 * combo maths, and the "map has loaded" gate.
 */
console.log('\n[5j] Missing ASIN badge')

if (asinTarget) {
  const expected = new Map()
  for (const row of catalogueRows) {
    if (!row.sku) continue
    const stored = new Set(
      Object.keys(asinBySku.get(row.sku) || {}).map((key) => key.toLowerCase()),
    )
    const missing = combinationsOf({ specs: row.specs }).filter(
      (combo) => !stored.has(combo.key.toLowerCase()),
    ).length
    if (missing) expected.set(row.id, missing)
  }

  check('the catalogue has at least one product with gaps', expected.size > 0, true)

  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })

  /* Earlier sections leave a search term in the box, and a `goto` to the URL we
   * are already on does not remount the page — without this the "count the
   * badges" check would only see the one filtered card. */
  const clearSearch = page.locator('input[placeholder^="搜索货号"]')
  if (await clearSearch.count()) {
    await clearSearch.fill('')
    await page.waitForTimeout(800)
  }

  /* The badges only appear once the ASIN map has landed — before that every card
   * is "unknown", not "missing", so counting too early reads as a bug. Poll
   * instead of guessing a timeout. */
  const badgeNumbers = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('span'))
        .map((node) => node.textContent.trim())
        .filter((text) => /^! 缺 \d+$/.test(text))
        .map((text) => Number(text.replace('! 缺 ', ''))),
    )

  let rendered = []
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    rendered = await badgeNumbers()
    if (rendered.length >= expected.size) break
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(300)
  rendered = await badgeNumbers()

  check('every gapped product is badged', rendered.length, expected.size)
  check(
    'the badge counts match the database',
    rendered.reduce((sum, n) => sum + n, 0),
    [...expected.values()].reduce((sum, n) => sum + n, 0),
  )

  /* And the per-product number, for one product, through the UI's own search. */
  const sample = catalogueRows.find((row) => expected.has(row.id))
  if (sample) {
    const searchInput = page.locator('input[placeholder^="搜索货号"]')
    await searchInput.fill(sample.sku || sample.name)
    await page.waitForTimeout(900)
    const text = await page.evaluate(() =>
      Array.from(document.querySelectorAll('span'))
        .map((node) => node.textContent.trim())
        .find((value) => /^! 缺 \d+$/.test(value)),
    )
    check(
      `the badge names this product's gap (${sample.sku || sample.name})`,
      text,
      `! 缺 ${expected.get(sample.id)}`,
    )
    await searchInput.fill('')
    await page.waitForTimeout(500)
  }
}

/* ── 5k. A save must not undo a reorder ──
 *
 * The reported bug: drag a row (or "move to top"), then open any *other*
 * product and save it — the whole list jumps back to the pre-drag order.
 *
 * Two independent things can produce that, and both are covered here:
 *   1. a save writing `sort_order` (it must never do that — position belongs to
 *      `reorder_products`), and
 *   2. a catalogue read that was already in flight when the drop happened
 *      landing afterwards and overwriting the cache with its pre-drag snapshot
 *      (`orderEpoch` in `productStore` now makes that read retry).
 *
 * The assertions therefore look at the table AND at the DOM, before and after a
 * reload: table + DOM together is the only combination that rules out both.
 */
console.log('\n[5k] Reorder survives a save')

if (asinTarget) {
  const orderSnapshot = await orderIds()
  const editable = [...catalogueRows].reverse().find((row) => row.sku && row.name)
  const { data: beforeEdit } = await db
    .from('products')
    .select('id, name')
    .eq('id', editable.id)
    .single()

  const searchBox = () => page.locator('input[placeholder^="搜索货号"]')
  const cardBox = (heading) =>
    page.locator(`input[aria-label="Select ${heading}"]`).locator('xpath=..').boundingBox()
  const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

  try {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    if (await searchBox().count()) {
      await searchBox().fill('')
      await page.waitForTimeout(700)
    }

    const headings = await rowHeadings()
    const draggedHeading = headings[0]
    const dropHeading = headings[2]

    const start = centre(await cardBox(draggedHeading))
    const end = centre(await cardBox(dropHeading))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + 14, { steps: 4 })
    await page.waitForTimeout(220)
    await page.mouse.move(end.x, end.y, { steps: 20 })
    await page.waitForTimeout(320)
    await page.mouse.up()
    await page.waitForTimeout(1600)

    const afterDrag = await orderIds()
    check('the drop reached the database', afterDrag[2], orderSnapshot[0])
    /* arrayMove(0 → 2) puts the drop target first and the dragged row third. */
    const expectedHead = [headings[1], dropHeading, draggedHeading]
    check('the list agrees with the database', (await rowHeadings()).slice(0, 3), expectedHead)

    /* A real edit, not a no-op save — a changed name, which is the exact thing
     * the bug report described doing before the order collapsed. */
    const editedName = `${beforeEdit?.name || editable.name} ZZ`
    await searchBox().fill(editable.sku)
    await page.waitForTimeout(800)
    /* Filtered to one 货号, so "the first Edit button" is the right one — and it
     * sidesteps building a selector out of a product name that may contain
     * quotes or brackets. */
    await page.locator('button[aria-label^="Edit "]').first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page
      .locator('[role="dialog"] input[placeholder="Wool-Blend Wide-Leg Trousers"]')
      .fill(editedName)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(2200)

    const { data: saved } = await db
      .from('products')
      .select('name')
      .eq('id', editable.id)
      .single()
    check('the edit itself saved', saved?.name, editedName)
    check('the save wrote no sort_order anywhere', await orderIds(), afterDrag)

    await searchBox().fill('')
    await page.waitForTimeout(900)
    check('the list still shows the dragged order', (await rowHeadings()).slice(0, 3), expectedHead)

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    check('and it survives a reload', (await rowHeadings()).slice(0, 3), expectedHead)
  } finally {
    await db
      .from('products')
      .update({ name: beforeEdit?.name ?? editable.name })
      .eq('id', editable.id)
    const ok = await restoreOrder(orderSnapshot, 'reorder-then-save order')
    console.log(ok ? '  · (cleanup: catalogue order restored)' : '  ⚠ order not restored')
  }
}

/* ── 5l. Size order ──
 *
 * `specs.Size` is import order, and about a third of the catalogue has it
 * scrambled (`XXL,S,L,M,XL`, `2,12,14,6,4,8,10`). Sizes are ordinal, so every
 * surface that shows them has to sort — and none of them may rewrite the stored
 * array, because a legacy v1/v2 selection code resolves options by POSITION.
 *
 * So this section asserts three things on a genuinely scrambled product:
 *   · the stock grid's columns read S → XXL
 *   · the ASIN list reads S → XXL inside each colour block
 *   · the option chips do too, without moving under the caret while typing
 * and then that the database row is byte-identical afterwards.
 *
 * No writes here, so no cleanup.
 */
console.log('\n[5l] Size order')

const scrambledRows = catalogueRows.filter(
  (row) =>
    row.sku &&
    !row.hidden &&
    Array.isArray(row.specs?.Size) &&
    row.specs.Size.length > 1 &&
    !isSortedSizes(row.specs.Size),
)

if (!scrambledRows.length) {
  console.log('  · every size list is already in order — nothing to compare against')
} else {
  const mixed = scrambledRows[0]
  const expectedSizes = sortSizes(mixed.specs.Size)
  console.log(`  · using ${mixed.sku} — stored ${JSON.stringify(mixed.specs.Size)}`)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('input[placeholder^="搜索货号"]').fill(mixed.sku)
  await page.waitForTimeout(800)
  await page.locator('button[aria-label^="Edit "]').first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(700)

  const chipValues = (labelPrefix) =>
    page
      .locator(`[role="dialog"] input[aria-label^="${labelPrefix}"]`)
      .evaluateAll((els) => els.map((el) => el.value))

  check('the option chips are in size order', await chipValues('Size value '), expectedSizes)

  /* Typing must not move the field: the display order is snapshotted while the
   * group has focus. Put the value back before leaving so nothing is written. */
  const slot = await page
    .locator('[role="dialog"] input[aria-label^="Size value "]')
    .evaluateAll((els) =>
      els.map((el, index) => ({
        label: el.getAttribute('aria-label'),
        value: el.value,
        index,
        /* The label carries the STORED index, not the position on screen —
         * that is what keeps each input bound to its own option. */
        storedIndex: Number(el.getAttribute('aria-label').replace('Size value ', '')) - 1,
      })),
    )
  const middle = slot[Math.floor(slot.length / 2)]
  const field = page.locator(`[role="dialog"] input[aria-label="${middle.label}"]`)
  await field.click()
  await page.waitForTimeout(250)
  const afterFocus = await chipValues('Size value ')
  check('focusing the group does not reshuffle it', afterFocus, expectedSizes)

  await page.keyboard.press('End')
  await page.keyboard.type('X')
  await page.waitForTimeout(250)
  const whileTyping = await page.evaluate(
    ([label]) => {
      const el = document.querySelector(`[role="dialog"] input[aria-label="${label}"]`)
      const all = [...document.querySelectorAll('[role="dialog"] input[aria-label^="Size value "]')]
      return { focused: document.activeElement === el, value: el?.value, position: all.indexOf(el) }
    },
    [middle.label],
  )
  check('the caret stays in the field being typed into', whileTyping.focused, true)
  check('and the field stays where it was', whileTyping.position, middle.index)
  check('with the typed text in it', whileTyping.value, `${middle.value}X`)

  /* Click away → the list settles into size order. What happens to the typed
   * value depends on the value, and the expectation has to follow `sortSizes`
   * rather than a guess: appending X to "L" makes "LX", which no rule knows,
   * so it parks at the end — but appending X to "8" makes "8X", which still
   * parses as a number and sorts between 6 and 10. Both are correct; asserting
   * "always last" made this check pass or fail depending on which scrambled
   * product happened to be first in the catalogue. */
  await page.evaluate(() => document.activeElement?.blur())
  await page.waitForTimeout(400)
  const typedStored = mixed.specs.Size.map((value, index) =>
    index === middle.storedIndex ? `${value}X` : value,
  )
  check(
    'leaving the group settles the display into size order',
    await chipValues('Size value '),
    sortSizes(typedStored),
  )

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
  await page.waitForTimeout(300)

  const { data: afterCancel } = await db.from('products').select('specs').eq('id', mixed.id).single()
  check('the stored size list is untouched', afterCancel.specs.Size, mixed.specs.Size)

  /* Stock grid + ASIN list live in the same dialog, one reopen away. */
  await page.locator('button[aria-label^="Edit "]').first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.locator('[role="dialog"]').getByRole('button', { name: /^库存/ }).click()
  await page.waitForTimeout(500)

  const columns = await page
    .locator('[role="dialog"] table thead th button')
    .evaluateAll((els) => els.map((el) => el.textContent.trim()))
  check('the stock grid columns run smallest → largest', columns, expectedSizes)

  const asinSizes = await page
    .locator('[role="dialog"] input[aria-label^="ASIN for "]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label').replace('ASIN for ', '')))
  const firstColour = asinSizes[0]?.split(' / ')[0]
  check(
    'the ASIN list runs smallest → largest inside a colour',
    asinSizes
      .filter((label) => label.startsWith(`${firstColour} / `))
      .map((label) => label.split(' / ')[1]),
    expectedSizes,
  )

  /* Colours are explicitly NOT sorted — the declared order is the one the admin
   * recognises, and reordering them would relabel the photos beside them. */
  check(
    'colours keep the declared order',
    asinSizes.map((label) => label.split(' / ')[0]).filter((c, i, all) => all.indexOf(c) === i),
    mixed.specs.Colour,
  )

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
}

/* Kept for [7]: the storefront half of the same assertion, checked after the
 * logout with no admin session in the way. */
const storefrontSizeProbe = scrambledRows[0] || null

/* ── 5m. Renaming a colour carries its ASINs ──
 *
 * `asins.variants` is keyed by the option TEXT (`"Brown|M"`), so fixing a
 * translation in the editor (藏青色 → Navy) is a key migration. Without one,
 * every listing under the old spelling is orphaned and the panel reads "Missing
 * ASIN" for combinations that were complete a second earlier.
 *
 * The second half is the other way people do the same thing: delete the old
 * colour and add the new one. That must NOT be treated as a rename — a guess
 * here binds one colour's listing to another — so the requirement is that it
 * stays calm: new rows read "Missing ASIN", the old ASINs wait in the extras
 * block, and nothing throws.
 *
 * Both edits happen on a real product. The rename is undone through the UI and
 * repaired at the database level in `finally`, so a half-finished run does not
 * leave a product called ZZ-…
 */
console.log('\n[5m] Colour rename keeps its ASINs')

if (asinTarget) {
  const targetColours = axisOf(asinTarget.specs, /colou?r|颜色/i)
  const targetColourType = axisTypeOf(asinTarget.specs, /colou?r|颜色/i)
  const targetVariants = asinBySku.get(asinTarget.sku) || {}
  const originalSpecs = JSON.parse(JSON.stringify(asinTarget.specs))

  const colourIndex = targetColours.findIndex((colour) =>
    Object.keys(targetVariants).some((key) =>
      key.toLowerCase().startsWith(`${String(colour).toLowerCase()}|`),
    ),
  )

  check('a colour with stored ASINs exists to rename', colourIndex > -1, true)

  if (colourIndex > -1) {
    const oldColour = targetColours[colourIndex]
    const carriedKeys = Object.keys(targetVariants).filter((key) =>
      key.toLowerCase().startsWith(`${oldColour.toLowerCase()}|`),
    )
    const tempColour = `ZZ-REN-${String(Date.now()).slice(-5)}`

    const openTarget = async () => {
      await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
      await page.locator('input[placeholder^="搜索货号"]').fill(asinTarget.sku)
      await page.waitForTimeout(700)
      await page.locator(`[aria-label="Edit ${asinTarget.name}"]`).first().click()
      await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
      await page.waitForTimeout(600)
    }

    const fields = () => page.locator('[role="dialog"] input[aria-label^="ASIN for "]')
    const snapshot = async () => {
      const values = await fields().evaluateAll((els) => els.map((el) => el.value))
      const labels = await fields().evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
      return {
        rows: values.length,
        filled: values.filter(Boolean).length,
        missing: values.filter((value) => !value).length,
        extras: await page.locator('[role="dialog"] [aria-label^="Clear ASIN for "]').count(),
        labels,
        values,
      }
    }

    /* Saving is two round trips (product, then ASINs) and the dialog closes only
     * after both. Polling for that beats a fixed sleep: a snapshot read while
     * the write is still in flight is how this section failed the first time. */
    const saveAndWait = async () => {
      await page.getByRole('button', { name: '保存修改', exact: true }).click()
      await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 20000 })
      await page.waitForTimeout(500)
    }

    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await openTarget()
      const before = await snapshot()
      const slotsPerColour = before.labels.filter((label) =>
        label.startsWith(`ASIN for ${oldColour} /`),
      ).length

      await page
        .locator(`[role="dialog"] input[aria-label="${targetColourType} value ${colourIndex + 1}"]`)
        .fill(tempColour)
      await page.waitForTimeout(600)
      const typed = await snapshot()

      check('renaming a colour keeps every field filled', typed.filled, before.filled)
      check('and adds no "Missing ASIN"', typed.missing, before.missing)
      check('and leaves nothing stranded in the extras block', typed.extras, before.extras)
      check(
        'the panel says which ASINs travel with the new name',
        await page.locator('[data-rename-note]').innerText(),
        `已改名 ${oldColour} → ${tempColour} —— ${carriedKeys.length} 个 ASIN 跟着新名字走，会以新名字保存。`,
      )
      const renamedRows = typed.labels
        .map((label, i) => ({ label, value: typed.values[i] }))
        .filter((row) => row.label.startsWith(`ASIN for ${tempColour} /`))
      check('every size of that colour is now listed under the new name', renamedRows.length, slotsPerColour)
      check(
        'and shows exactly the ASINs the old name had',
        renamedRows
          .map((row) => row.value)
          .filter(Boolean)
          .sort(),
        carriedKeys
          .map((key) => targetVariants[key])
          .filter(Boolean)
          .sort(),
      )

      await saveAndWait()

      const { data: savedProduct } = await db
        .from('products')
        .select('specs')
        .eq('id', asinTarget.id)
        .single()
      check('the product saved the new colour name', savedProduct.specs[targetColourType][colourIndex], tempColour)

      const { data: savedAsin } = await db
        .from('asins')
        .select('variants')
        .eq('sku', asinTarget.sku)
        .single()
      const savedKeys = Object.keys(savedAsin.variants)
      check(
        'the ASIN map has the new keys',
        savedKeys.filter((key) => key.startsWith(`${tempColour}|`)).length,
        carriedKeys.length,
      )
      check(
        'and none of the old ones',
        savedKeys.filter((key) => key.toLowerCase().startsWith(`${oldColour.toLowerCase()}|`)).length,
        0,
      )
      check(
        'every ASIN value survived the move',
        carriedKeys.map((key) => savedAsin.variants[`${tempColour}|${key.split('|')[1]}`]),
        carriedKeys.map((key) => targetVariants[key]),
      )

      /* And back, through the same editor — the rename has to be reversible or
       * it is a migration with no way home. */
      await openTarget()
      await page
        .locator(`[role="dialog"] input[aria-label="${targetColourType} value ${colourIndex + 1}"]`)
        .fill(oldColour)
      await page.waitForTimeout(500)
      await saveAndWait()

      const { data: backProduct } = await db
        .from('products')
        .select('specs')
        .eq('id', asinTarget.id)
        .single()
      const { data: backAsin } = await db
        .from('asins')
        .select('variants')
        .eq('sku', asinTarget.sku)
        .single()
      check('renaming back restores the specs exactly', backProduct.specs, originalSpecs)
      check('renaming back restores the ASIN map exactly', fingerprint(backAsin.variants), fingerprint(targetVariants))

      /* ── delete the colour, add a new one: no rename, no crash ── */
      await openTarget()
      const again = await snapshot()
      const alreadyMissing = carriedKeys.filter((key) => !targetVariants[key]).length

      /* The colour group is not necessarily the first one — the spec keys are
       * whatever order the sheet had — so find its card by the type name. */
      const groupLabels = await page
        .locator('[role="dialog"] input[aria-label^="Option group "]')
        .evaluateAll((els) =>
          els.map((el) => ({ label: el.getAttribute('aria-label'), value: el.value })),
        )
      const colourGroupLabel = groupLabels.find((group) => group.value === targetColourType)?.label
      const card = page
        .locator('[role="dialog"] div.rounded-xl')
        .filter({ has: page.locator(`input[aria-label="${colourGroupLabel}"]`) })
      await card.locator('button[aria-label="Remove option"]').nth(colourIndex).click()
      await page.waitForTimeout(400)
      await card.getByRole('button', { name: '添加颜色', exact: true }).click()
      await page.waitForTimeout(400)
      const optionCount = await page
        .locator(`[role="dialog"] input[aria-label^="${targetColourType} value "]`)
        .count()
      await page
        .locator(`[role="dialog"] input[aria-label="${targetColourType} value ${optionCount}"]`)
        .fill(tempColour)
      await page.waitForTimeout(600)

      const replaced = await snapshot()
      const missingSlotsBefore = slotsPerColour - (carriedKeys.length - alreadyMissing)
      check('the replaced colour has no rename note', await page.locator('[data-rename-note]').count(), 0)
      check(
        'every size of the new colour reads "Missing ASIN"',
        replaced.missing - again.missing,
        slotsPerColour - missingSlotsBefore,
      )
      check(
        'and says so in every field',
        await page.locator('[role="dialog"] input[placeholder="缺 ASIN"]').count(),
        replaced.missing,
      )
      check(
        'the new rows are flagged as new',
        (await page.locator('[role="dialog"] [data-new="true"]').count()) > 0,
        true,
      )
      check(
        'the deleted colour keeps its ASINs in the extras block',
        replaced.extras - again.extras,
        carriedKeys.length,
      )
      check('the old combination count is unchanged', replaced.rows, again.rows)

      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.waitForTimeout(800)
      const { data: afterCancelAsin } = await db
        .from('asins')
        .select('variants')
        .eq('sku', asinTarget.sku)
        .single()
      const { data: afterCancelProduct } = await db
        .from('products')
        .select('specs')
        .eq('id', asinTarget.id)
        .single()
      check('cancel writes nothing to the ASIN map', fingerprint(afterCancelAsin.variants), fingerprint(targetVariants))
      check('cancel writes nothing to the specs', afterCancelProduct.specs, originalSpecs)
    } finally {
      /* Database-level repair: if the browser died mid-rename, the UI cannot be
       * trusted to undo it. */
      const { data: product } = await db
        .from('products')
        .select('id, specs')
        .eq('id', asinTarget.id)
        .maybeSingle()
      if (product && JSON.stringify(product.specs) !== JSON.stringify(originalSpecs)) {
        await db.from('products').update({ specs: originalSpecs }).eq('id', asinTarget.id)
        console.log('  · repaired products.specs')
      }
      const { data: asinRow } = await db
        .from('asins')
        .select('variants')
        .eq('sku', asinTarget.sku)
        .maybeSingle()
      if (asinRow && fingerprint(asinRow.variants) !== fingerprint(targetVariants)) {
        await db.from('asins').update({ variants: targetVariants }).eq('sku', asinTarget.sku)
        console.log('  · repaired asins.variants')
      }
      await page.setViewportSize({ width: 900, height: 1000 })
    }
  }
}

/* ── 5g. Renaming a 货号 moves its ASIN row ──
 *
 * `asins.sku` is a primary key, so a rename is a MOVE, not a copy — otherwise
 * the map stays behind under the old code and the new one shows every
 * combination as missing.
 *
 * Two things have to hold:
 *   1. renaming moves the row (both tables agree afterwards)
 *   2. renaming onto a 货号 that already has ASINs is REFUSED before anything is
 *      written — merging two variant maps needs a human
 *
 * Both renames happen on a real product and are undone in `finally` at the
 * database level, not through the UI: if the browser dies halfway, the repair
 * still runs.
 */
console.log('\n[5g] Rename migration')

if (asinTarget) {
  const originalSku = asinTarget.sku
  const tempSku = `ZZ-TEST-${String(Date.now()).slice(-6)}`

  /* A 货号 that already owns ASINs, to prove the refusal. Never the target. */
  const occupied = [...asinBySku.keys()].find(
    (sku) => sku && sku !== originalSku && Object.keys(asinBySku.get(sku) || {}).length,
  )

  const searchBox = () => page.locator('input[placeholder^="搜索货号"]')
  const skuField = () => page.locator('[role="dialog"] input[placeholder="AMZ-1003"]')

  async function openEditorFor(sku) {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await searchBox().fill(sku)
    await page.waitForTimeout(700)
    await page.locator('[aria-label^="Edit "]').first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(400)
  }

  async function skuOf(id) {
    const { data } = await db.from('products').select('id, sku').eq('id', id).maybeSingle()
    return data?.sku ?? null
  }

  async function asinSkus() {
    const { data } = await db.from('asins').select('sku')
    return (data || []).map((row) => row.sku)
  }

  try {
    await openEditorFor(originalSku)
    await skuField().fill(tempSku)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(1500)

    check('the product took the new 货号', await skuOf(asinTarget.id), tempSku)
    const movedSkus = await asinSkus()
    check('its ASIN row moved with it', movedSkus.includes(tempSku), true)
    check('nothing was left under the old 货号', movedSkus.includes(originalSku), false)

    /* Onto an occupied 货号: must refuse, and must write nothing. */
    if (occupied) {
      await openEditorFor(tempSku)
      await skuField().fill(occupied)
      await page.getByRole('button', { name: '保存修改', exact: true }).click()
      await page.waitForTimeout(900)
      check('a rename onto existing ASINs is refused', await page.locator('text=/已经有 ASIN/').count(), 1)
      check('the editor stays open so it can be fixed', await page.locator('[role="dialog"]').count(), 1)
      check('the product was not renamed', await skuOf(asinTarget.id), tempSku)
      const afterRefusal = await asinSkus()
      check('the occupied 货号 keeps its own ASINs', afterRefusal.includes(occupied), true)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }

    /* And back. */
    await openEditorFor(tempSku)
    await skuField().fill(originalSku)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.waitForTimeout(1500)
    check('the 货号 is back', await skuOf(asinTarget.id), originalSku)
    const restoredSkus = await asinSkus()
    check('the ASIN row came back with it', restoredSkus.includes(originalSku), true)
    check('the temporary 货号 is gone', restoredSkus.includes(tempSku), false)
  } finally {
    /* Repairs whatever the UI left behind, in either table. */
    const { data: product } = await db
      .from('products')
      .select('id, sku')
      .eq('id', asinTarget.id)
      .maybeSingle()
    if (product && product.sku !== originalSku) {
      await db.from('products').update({ sku: originalSku }).eq('id', asinTarget.id)
      console.log(`  · repaired products.sku → ${originalSku}`)
    }

    const { data: asinRows } = await db.from('asins').select('sku').eq('sku', tempSku)
    if (asinRows?.length) {
      const { data: clash } = await db.from('asins').select('sku').eq('sku', originalSku)
      if (!clash?.length) {
        await db.from('asins').update({ sku: originalSku }).eq('sku', tempSku)
        console.log(`  · repaired asins.sku → ${originalSku}`)
      }
    }
  }

  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

/* ── 5n. The category filter, next to the search box ──
 *
 * Three things have to hold, and only the first is obvious:
 *
 *   1. picking a category shows exactly that category — the count is compared
 *      against the database, not against whatever the page happens to render
 *   2. it combines with the search box with AND, in both orders (a 货号 from the
 *      chosen category matches; one from another category matches nothing)
 *   3. it combines with the bulk actions — "Select all" after filtering ticks
 *      only the rows on screen. That is the one with teeth: bulk Hide/Delete
 *      operate on the selection, so a filter that leaked would delete rows the
 *      admin never saw.
 */
console.log('\n[5n] Category filter')

/* `reload`, not just `goto`: the hash is already `#/admin/products`, so a goto
 * is a no-op for a hash router and every scrap of state survives — including the
 * search text the previous section left in the box, which made the "unfiltered"
 * count read 0. A reload is the only way to get a clean component. */
await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

const { data: catRows } = await db
  .from('products')
  .select('id, sku, name, category')
  .order('sort_order', { ascending: true })

const totalProducts = catRows?.length || 0
const countByCategory = new Map()
for (const row of catRows || []) {
  countByCategory.set(row.category, (countByCategory.get(row.category) || 0) + 1)
}
const [biggestCategory, biggestCount] = [...countByCategory.entries()].sort((a, b) => b[1] - a[1])[0] || []

const categoryPicker = page.locator('select[aria-label="Filter by category"]')
const rowsOnScreen = () => page.locator('[aria-label^="Edit "]').count()

if (!biggestCategory || biggestCount === totalProducts) {
  console.log('  · skipped — the catalogue has no usable category split')
} else {
  check('there is a category dropdown next to the search box', await categoryPicker.count(), 1)
  const offered = (
    await categoryPicker.locator('option').evaluateAll((els) => els.map((el) => el.value))
    /* `__deal_items__` 是伪选项（秒杀视图），不是分类 —— 下面这条断言比的是
     * "目录里真有商品的那些分类"，所以把它排除掉再比。 */
  ).filter((value) => value !== DEAL_ITEMS)
  check('it offers the "all" option first', offered[0], 'All')
  check(
    'and every category the catalogue actually uses',
    offered.slice(1).sort(),
    [...countByCategory.keys()].sort(),
  )
  check('unfiltered, every product is listed', await rowsOnScreen(), totalProducts)

  await categoryPicker.selectOption(biggestCategory)
  await page.waitForTimeout(700)
  check(
    `picking "${biggestCategory}" lists exactly its ${biggestCount} products`,
    await rowsOnScreen(),
    biggestCount,
  )

  const summary = page.locator('p', { hasText: `/ ${totalProducts} 件` }).first()
  check('the list says how much is hidden', await summary.count(), 1)
  check('with the filtered count first', /^(\d+) \//.exec(await summary.innerText())?.[1], String(biggestCount))
  check('and names the category', /·/.test(await summary.innerText()), true)

  /* Search AND category, both directions. */
  const searchBox = page.locator('input[placeholder^="搜索货号"]')
  const inside = (catRows || []).find((row) => row.category === biggestCategory && row.sku)
  const outside = (catRows || []).find((row) => row.category !== biggestCategory && row.sku)

  await searchBox.fill(inside.sku)
  await page.waitForTimeout(700)
  check('a 货号 from this category matches', await rowsOnScreen(), 1)

  if (outside) {
    await searchBox.fill(outside.sku)
    await page.waitForTimeout(700)
    check('the same search under another category matches nothing', await rowsOnScreen(), 0)
    check('and the empty state is explained, not blank', await page.getByText(/没有匹配这个搜索的商品/).count(), 1)
  }
  await searchBox.fill('')
  await page.waitForTimeout(700)

  /* Select all ticks the filtered view only. */
  await page.locator('input[aria-label="Select all products on this screen"]').click()
  await page.waitForTimeout(500)
  const selected = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((node) =>
      /^\d+ selected$/.test(node.textContent.trim()),
    )
    return el ? Number(el.textContent.trim().split(' ')[0]) : 0
  })
  check('select-all ticks only the rows the filter left on screen', selected, biggestCount)
  await page.locator('button[aria-label="Clear selection"]').click()
  await page.waitForTimeout(300)

  await categoryPicker.selectOption('All')
  await page.waitForTimeout(700)
  check('clearing the filter brings the whole catalogue back', await rowsOnScreen(), totalProducts)
}

/* ── 5o. "View on Amazon" in the editor ──
 *
 * Sourcing a photo means looking at the listing, so the link sits directly
 * under the image URL field. Three things must hold:
 *   · it points at the FIRST ASIN the panel shows — not at whatever key jsonb
 *     handed back first (`asins.variants` is jsonb; key order is storage, not
 *     meaning). Asserted against the render order derived here, not reusing the
 *     component's own helper.
 *   · it opens in a new tab and cannot reach back into the admin tab.
 *   · a product with no ASINs gets no link at all — and typing a truncated ASIN
 *     does not conjure one, because a link to the wrong listing is worse than
 *     no link.
 */
console.log('\n[5o] View on Amazon link')

if (asinTarget) {
  const linkSel = '[role="dialog"] a[href^="https://www.amazon.com/dp/"]'
  const stored = asinBySku.get(asinTarget.sku) || {}
  const storedByLower = new Map(
    Object.entries(stored).map(([key, asin]) => [key.toLowerCase(), String(asin || '').trim().toUpperCase()]),
  )
  const combos = combinationsOf({ specs: asinTarget.specs })
  const firstHit = combos
    .map((combo) => ({ combo, asin: storedByLower.get(combo.key.toLowerCase()) || '' }))
    .find((entry) => /^[A-Z0-9]{10}$/.test(entry.asin))

  check('the test product has a usable first ASIN', Boolean(firstHit), true)

  const openEditor = async (sku) => {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    await page.locator('input[placeholder^="搜索货号"]').fill(sku)
    await page.waitForTimeout(800)
    await page.locator('button[aria-label^="Edit "]').first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(700)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await openEditor(asinTarget.sku)

  const link = page.locator(linkSel)
  check('the editor offers one Amazon link', await link.count(), 1)
  check(
    'it points at the first ASIN the panel shows',
    await link.getAttribute('href'),
    `https://www.amazon.com/dp/${firstHit?.asin}`,
  )
  /* If the stored map happens to lead with a different variant, the href must
   * still be the panel's first — that is the whole point of not trusting key
   * order. Only asserted when the two actually differ, otherwise it proves
   * nothing. */
  const storedFirst = String(Object.values(stored)[0] || '').trim().toUpperCase()
  if (storedFirst && storedFirst !== firstHit?.asin) {
    check(
      'it does not follow the stored key order instead',
      await link.getAttribute('href') !== `https://www.amazon.com/dp/${storedFirst}`,
      true,
    )
  }
  check('it opens in a new tab', await link.getAttribute('target'), '_blank')
  check('with noopener so the Amazon page cannot touch this tab', /noopener/.test((await link.getAttribute('rel')) || ''), true)

  /* The label names the variant, so a photo cannot land on the wrong swatch. */
  const expectedLabel = [firstHit?.combo.colour, firstHit?.combo.size].filter(Boolean).join(' / ')
  check('the pill names the variant the listing belongs to', (await link.innerText()).includes(expectedLabel), true)

  /* Placement is the whole point of the request: under the image URL field. */
  const boxes = await page.evaluate((selector) => {
    const input = document.querySelector('[role="dialog"] input[placeholder^="https://"]')
    const anchor = document.querySelector(selector)
    if (!input || !anchor) return null
    const a = input.getBoundingClientRect()
    const b = anchor.getBoundingClientRect()
    return { inputBottom: Math.round(a.bottom), linkTop: Math.round(b.top), sameColumn: Math.abs(a.left - b.left) < 40 }
  }, linkSel)
  check('it sits below the image URL field', boxes && boxes.linkTop >= boxes.inputBottom, true)
  check('in the same column as that field', boxes?.sameColumn, true)

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
  await page.waitForTimeout(300)

  /* ── a product with nothing stored ──
   *
   * Every one of the 195 live products has a filled ASIN map (measured), so the
   * empty state cannot be reached without writing fiction into `asins`. It is
   * simulated at the network layer instead — the `asins` response is rewritten
   * in flight so one product comes back with `variants: {}`. Read-only: the
   * database is never touched, and the cancellation check at the end reads the
   * table directly, past the route. */
  const bareSource = catalogueRows.find(
    (row) =>
      row.sku &&
      row.sku !== asinTarget.sku &&
      Object.keys(asinBySku.get(row.sku) || {}).length > 0 &&
      combinationsOf({ specs: row.specs }).length > 0,
  )

  if (!bareSource) {
    console.log('  · no second product with ASINs to blank out — hidden state not checked')
  } else {
    const blankVariants = async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        response,
        body: JSON.stringify(
          Array.isArray(body)
            ? body.map((row) => (row.sku === bareSource.sku ? { ...row, variants: {} } : row))
            : body,
        ),
      })
    }

    /* Snapshot first: the check at the end is about the write, not the shape. */
    const { data: bareBefore } = await db
      .from('asins')
      .select('sku, variants')
      .eq('sku', bareSource.sku)
      .maybeSingle()

    await page.route('**/rest/v1/asins*', blankVariants)
    try {
      await openEditor(bareSource.sku)
      const bareLink = page.locator(linkSel)
      check('a product with no ASINs gets no link', await bareLink.count(), 0)
      check(
        'but the image field is there (so the absence is real, not a failed render)',
        await page.locator('[role="dialog"] input[placeholder^="https://"]').count(),
        1,
      )

      /* Typing is enough — no save needed. A truncated paste must NOT link. */
      const asinInput = page.locator('[role="dialog"] input[aria-label^="ASIN for "]').first()
      await asinInput.fill('B0SHORT')
      await page.waitForTimeout(400)
      check('a truncated ASIN does not produce a link', await page.locator(linkSel).count(), 0)

      const typedAsin = `B0TEST${String(Date.now()).slice(-4)}`
      await asinInput.fill(typedAsin)
      await page.waitForTimeout(400)
      check('a complete ASIN produces the link before saving', await page.locator(linkSel).count(), 1)
      check(
        'and it points at the value just typed',
        await page.locator(linkSel).getAttribute('href'),
        `https://www.amazon.com/dp/${typedAsin}`,
      )

      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
      await page.waitForTimeout(600)
    } finally {
      await page.unroute('**/rest/v1/asins*', blankVariants)
    }

    const { data: afterCancelAsin } = await db
      .from('asins')
      .select('sku, variants')
      .eq('sku', bareSource.sku)
      .maybeSingle()
    check('cancelling wrote nothing for that 货号', afterCancelAsin, bareBefore)
  }
}

/* ── 5q. badge quick-fill templates ──
 *
 * Five pills that fill the text AND the colour in one click. What matters is
 * not that they exist but that (a) the click writes both fields, (b) editing
 * the text afterwards leaves the colour alone — "Trending" → "Trending Now"
 * must not turn the badge grey, and (c) the row wraps inside its own column
 * instead of squeezing the fields beside it or spilling into the ASIN column.
 * Nothing is saved: every assertion is on the draft, then Cancel.
 */
console.log('\n[5q] Badge quick-fill templates')

{
  /* Read the real list, never a hand-copied one — a new template (Coming Soon)
   * must not silently make this section disagree with the editor. */
  const TEMPLATES = BADGE_TEMPLATES

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  await page.locator('button[aria-label^="Edit "]').first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(700)

  const tagInput = page.locator('[role="dialog"] input[aria-label="Badge text"]')
  const colourInput = page.locator('[role="dialog"] input[aria-label="Badge colour"]')
  /* The aria-label carries the colour name too ("Badge template Trending
   * (Violet)"), so match on the prefix — an exact match would miss it. */
  const pill = (text) =>
    page.locator(`[role="dialog"] button[aria-label^="Badge template ${text} ("]`)

  check(
    'the template pills are offered, in this order',
    await page
      .locator('[role="dialog"] button[aria-label^="Badge template "]')
      .evaluateAll((els) => els.map((el) => el.textContent.trim())),
    TEMPLATES.map((t) => t.text),
  )

  /* Start from a known state: whatever this product had, clear it. */
  await tagInput.fill('')
  await page.waitForTimeout(300)

  /* `input[type=color]` normalises its value to lower case in the DOM, so read
   * it back through the same upper-casing the draft uses before comparing. */
  const colourValue = async () => (await colourInput.inputValue()).toUpperCase()

  await pill('Trending').click()
  await page.waitForTimeout(300)
  check('clicking a pill fills the text', await tagInput.inputValue(), 'Trending')
  check('and the colour', await colourValue(), '#7C3AED')
  check('and marks itself pressed', await pill('Trending').getAttribute('aria-pressed'), 'true')

  const pillStyle = await pill('Trending').evaluate((el) => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, color: style.color }
  })
  check('the pill is drawn in its own colour', pillStyle.background, 'rgb(124, 58, 237)')
  check('with the readable text colour on top', pillStyle.color, 'rgb(250, 248, 245)')

  const preview = page.locator('[role="dialog"] [data-badge-preview]')
  check('the editor preview shows the badge', await preview.count(), 1)
  check(
    'and it is painted with the same colour',
    await preview.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(124, 58, 237)',
  )

  /* The requirement that is easiest to break later: a template is a starting
   * point, not a lock. Typing over the text must not reset the colour. */
  await tagInput.fill('Trending Now')
  await page.waitForTimeout(300)
  check('editing the text keeps the colour', await colourValue(), '#7C3AED')
  check('and the pill is no longer "pressed"', await pill('Trending').getAttribute('aria-pressed'), 'false')
  check('the preview follows the edited text', await preview.innerText(), 'Trending Now')

  /* A second click replaces both halves — a template must not merge with a
   * previously typed word ("Trending NowRestock"). */
  await pill('Restock').click()
  await page.waitForTimeout(300)
  check('another pill replaces the text', await tagInput.inputValue(), 'Restock')
  check('and the colour', await colourValue(), '#2470AE')

  /* Geometry: the row belongs to the badge area. It must sit under the text
   * field and stay inside the form column — that is what "does not squeeze the
   * other inputs" means in pixels. (The badge block used to be a half-width cell
   * next to Category; the pills there wrapped into ragged rows, which is why it
   * is full width now. With six templates the full-width row wraps to at most
   * two rows; the assertions below keep it from overflowing.) */
  const box = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const row = dialog.querySelector('button[aria-label^="Badge template "]').parentElement
    const input = dialog.querySelector('input[aria-label="Badge text"]')
    const asins = dialog.querySelector('section[aria-label="ASINs"]')
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const pillTops = [...row.querySelectorAll('button')].map((el) =>
      Math.round(el.getBoundingClientRect().top),
    )
    return {
      row: rect(row),
      input: rect(input),
      asins: rect(asins),
      pillCount: pillTops.length,
      pillRows: new Set(pillTops).size,
    }
  })
  check('the row sits under the text field', box.row.top >= box.input.bottom - 1, true)
  check('and does not spill into the ASIN column', box.row.right <= box.asins.left + 1, true)
  check('every template pill is offered in the row', box.pillCount, BADGE_TEMPLATES.length)
  check('and they wrap to at most two rows', box.pillRows <= 2, true)

  /* "Does not squeeze" measured rather than assumed: hide the row, re-measure
   * the text field, put it back. If a later change moves the pills inline
   * next to the input, the width drops and this fails. */
  const widthDelta = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const input = dialog.querySelector('input[aria-label="Badge text"]')
    const row = dialog.querySelector('button[aria-label^="Badge template "]').parentElement
    const before = Math.round(input.getBoundingClientRect().width)
    row.style.display = 'none'
    const after = Math.round(input.getBoundingClientRect().width)
    row.style.display = ''
    return { before, after }
  })
  /* Passes only when the two widths are equal: the label prints both numbers
   * so a failure says "312px with the row vs 430px without" instead of just
   * "false". */
  check(
    'the template row does not squeeze the text field',
    widthDelta.before === widthDelta.after ? 'same width' : `${widthDelta.before}px vs ${widthDelta.after}px`,
    'same width',
  )

  /* Five words plus the label must not force a horizontal scrollbar. */
  const overflow = await page.evaluate(() => {
    const row = document
      .querySelector('[role="dialog"] button[aria-label^="Badge template "]')
      .parentElement
    return row.scrollWidth - row.clientWidth
  })
  check('the row wraps instead of overflowing', overflow <= 0, true)

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
  await page.waitForTimeout(400)
}

/* ── 5r. drag a colour photo onto the main image ──
 *
 * The gesture is HTML5 drag-and-drop, which Playwright's mouse actions do not
 * produce — `dragAndDrop` synthesises mouse events and Chrome ignores them
 * for DnD. So the events are dispatched with a REAL `DataTransfer` handle:
 * `dragstart` on the card (the handler puts the payload on it), `dragover` on
 * the main image (it decides whether it is a target), `drop` (it reads the
 * payload back). That exercises the same code path a mouse does, including the
 * part where the payload is only readable in `drop`.
 *
 * Also checked: the drop zone is inert for anything that is not a colour card,
 * and the click fallback (the arrow on each card) does the same thing without
 * a mouse. Nothing is saved — Cancel, then the row is compared byte-for-byte.
 */
console.log('\n[5r] Drag a colour photo onto the main image')

{
  const { data: dndRows } = await db
    .from('products')
    .select('id, sku, name, image, variant_images, specs')
    .order('sort_order', { ascending: true })

  const openEditor = async (sku) => {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    await page.locator('input[placeholder^="搜索货号"]').fill(sku)
    await page.waitForTimeout(800)
    await page.locator('button[aria-label^="Edit "]').first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(700)
  }

  /* Every colour card with a photo, read from the fields the editor itself
   * uses — not from `variant_images`, whose shape is the parser's business. */
  const colourCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] [data-drag-colour]')].map((card) => ({
        colour: card.getAttribute('data-drag-colour'),
        url: card.querySelector('input[aria-label^="Image URL for "]')?.value || '',
      })),
    )

  const mainImageInput = page.locator('[role="dialog"] input[placeholder^="https://"]')
  const dropZone = page.locator('[role="dialog"] [data-main-image-drop]')

  /* Pre-filter the candidates before opening a single editor.
   *
   * A third of this catalogue has its main image set to one of its colour
   * photos (the main shot usually IS the first colour's), and dragging a card
   * that is already the main image is a no-op that proves nothing. Opening the
   * editor for all 142 rows before the first usable one costs ten minutes, so
   * the shape rules from `variantImage.js` ({ SpecType: { Option: url } }) are
   * applied here to rank the candidates, and the DOM still has the last word —
   * `colourCards()` below reads the editor's own fields, and a pre-filter that
   * guessed wrong fails loudly instead of quietly testing the wrong product. */
  const photoUrlsOf = (row) => {
    const urls = []
    for (const byOption of Object.values(row.variant_images || {})) {
      if (!byOption || typeof byOption !== 'object' || Array.isArray(byOption)) continue
      for (const url of Object.values(byOption)) {
        const value = String(url || '').trim()
        if (value) urls.push(value)
      }
    }
    return urls
  }
  const candidates = (dndRows || []).filter((row) => {
    const urls = photoUrlsOf(row)
    const main = String(row.image || '').trim()
    return urls.length >= 2 && main && !urls.includes(main)
  })

  let dndTarget = null
  let cards = []
  for (const row of candidates) {
    await openEditor(row.sku)
    cards = (await colourCards()).filter((card) => card.url)
    if (cards.length >= 2 && !cards.some((card) => card.url === String(row.image || '').trim())) {
      dndTarget = row
      break
    }
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
  }

  if (!dndTarget) {
    console.log('  · no product with two colour photos — nothing to drag')
  } else {
    const { data: before } = await db
      .from('products')
      .select('image, variant_images, specs')
      .eq('id', dndTarget.id)
      .maybeSingle()

    const donor = cards[0]
    const second = cards[1]
    check('the test product has colour photos to drag', cards.length >= 2, true)
    check(
      'and neither of them is already the main image',
      [donor.url, second.url].includes(String(dndTarget.image || '').trim()),
      false,
    )

    /* ── the drag ── */
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await page
      .locator(`[role="dialog"] [data-drag-colour="${donor.colour}"]`)
      .dispatchEvent('dragstart', { dataTransfer })
    await dropZone.dispatchEvent('dragover', { dataTransfer })

    check(
      'the main image lights up while a card is over it',
      await page.locator('[role="dialog"] [data-drop-hint]').count(),
      1,
    )

    await dropZone.dispatchEvent('drop', { dataTransfer })
    await page.waitForTimeout(500)

    check(
      'dropping fills the main image with that colour photo',
      await mainImageInput.inputValue(),
      donor.url,
    )
    check(
      'the preview shows it too',
      await dropZone.locator('img').first().getAttribute('src'),
      donor.url,
    )
    check(
      'and it says where the photo came from',
      await page.locator('[role="status"]').filter({ hasText: '主图已换成' }).innerText(),
      `主图已换成的${donor.colour}那张`,
    )
    check(
      'the hint is gone again',
      await page.locator('[role="dialog"] [data-drop-hint]').count(),
      0,
    )

    /* ── dropping it a second time is a no-op, and says so ── */
    await dropZone.dispatchEvent('drop', { dataTransfer })
    await page.waitForTimeout(400)
    check(
      'dropping the same photo again changes nothing',
      await mainImageInput.inputValue(),
      donor.url,
    )
    check(
      'and says it is already the main image',
      await page.locator('[role="status"]').filter({ hasText: '已经是主图了' }).count(),
      1,
    )

    /* ── somewhere else: no reaction ── */
    const foreign = await page.evaluateHandle(() => new DataTransfer())
    await page
      .locator(`[role="dialog"] [data-drag-colour="${second.colour}"]`)
      .dispatchEvent('dragstart', { dataTransfer: foreign })
    await page
      .locator('[role="dialog"] input[placeholder="AMZ-1003"]')
      .dispatchEvent('drop', { dataTransfer: foreign })
    await page.waitForTimeout(400)
    check(
      'dropping on a field that is not the drop zone does nothing',
      await mainImageInput.inputValue(),
      donor.url,
    )

    /* ── the same action without a mouse ── */
    await page
      .locator(`[role="dialog"] [data-drag-colour="${second.colour}"] button[aria-label^="Use "]`)
      .click()
    await page.waitForTimeout(500)
    check(
      'the arrow on a card does the same thing',
      await mainImageInput.inputValue(),
      second.url,
    )
    check(
      'with its own toast',
      await page.locator('[role="status"]').filter({ hasText: '主图已换成' }).innerText(),
      `主图已换成的${second.colour}那张`,
    )

    /* ── making the card draggable must not break the inputs inside it ──
     * A `draggable` ancestor used to be the classic way to stop being able to
     * type into a field: some browsers start a drag instead of a text
     * selection. Assert it here, on the real card, because the alternative is
     * finding out from ops. */
    const nameBefore = await page.evaluate((colour) => {
      const card = document.querySelector(`[role="dialog"] [data-drag-colour="${colour}"]`)
      return card?.querySelector('input')?.value || ''
    }, donor.colour)
    await page
      .locator(`[role="dialog"] [data-drag-colour="${donor.colour}"] input`)
      .first()
      .click()
    await page.keyboard.press('End')
    await page.keyboard.type('-X')
    await page.waitForTimeout(400)
    check(
      'the inputs inside a draggable card still take typing',
      await page.evaluate((colour) => {
        const card = document.querySelector(`[role="dialog"] [data-drag-colour="${colour}-X"]`)
        return card?.querySelector('input')?.value || ''
      }, donor.colour),
      `${nameBefore}-X`,
    )

    /* ── nothing was written ── */
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })
    await page.waitForTimeout(500)

    const { data: after } = await db
      .from('products')
      .select('image, variant_images, specs')
      .eq('id', dndTarget.id)
      .maybeSingle()
    check('cancelling left the row untouched', after, before)
  }
}

/* ── 5s. the web import ──
 *
 * A real CSV goes through the real file input and is allowed to write. The
 * unit suite proves the rules; this proves the browser path that reaches them:
 *   · the input reads the bytes and the header is recognised
 *   · the preview shows the four counts BEFORE anything is written
 *   · 确认导入 writes — new 货号 hidden, merged 货号 appended to and nothing
 *     else touched, ASIN keys the sheet never mentioned still there
 *   · 取消 writes nothing at all
 *
 * The merge target is read from the database rather than hard-coded, and the
 * colour/size it is given are chosen to be ones it does not already have —
 * otherwise "appended" and "ignored as a duplicate" are indistinguishable.
 */
console.log('\n[5s] Import (CSV/XLSX)')

{
  /* 后台已汉化，弹窗的 aria-label 就是标题本身（Modal 把 title 传下去）。 */
  const preview = page.locator('[role="dialog"][aria-label="导入预览"]')
  const result = page.locator('[role="dialog"][aria-label="导入完成"]')
  /* The admin page now has two hidden file inputs — the product importer and
     the deal importer. Target the product one explicitly. */
  const fileInput = page.locator('input[type="file"][data-file-role="products"]')

  const upload = async (csv, name) => {
    await fileInput.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
    await preview.waitFor({ timeout: 20000 })
  }
  const statOf = async (tone) =>
    Number((await preview.locator(`[data-import-stat="${tone}"] [data-import-value]`).innerText()).replace(/\D/g, ''))

  let mergeTarget = null
  let beforeRow = null
  let beforeVariants = null
  let newSku = ''

  try {
    const { data: allRows } = await db
      .from('products')
      .select(
        'id, sku, name, image, category, tag, hidden, specs, variant_images, sold_out_variants, badge_color, sort_order',
      )
      .order('sort_order', { ascending: true })

    /* Needs both axes spelled the way the importer writes them, or the merge
       would land in `ignored` and there would be nothing to append to. */
    mergeTarget = (allRows || []).find(
      (row) => row.sku && Array.isArray(row.specs?.Colour) && Array.isArray(row.specs?.Size),
    )

    if (!mergeTarget) {
      console.log('  · no product with a Colour/Size spec pair — nothing to merge into')
    } else {
      beforeRow = { ...mergeTarget }
      const { data: asinRow } = await db
        .from('asins')
        .select('variants')
        .eq('sku', mergeTarget.sku)
        .maybeSingle()
      beforeVariants = asinRow?.variants || {}

      /* A 货号 no previous run of this section could have left behind. */
      const { data: taken } = await db.from('products').select('sku').like('sku', 'ZZGATE%')
      const used = new Set((taken || []).map((row) => row.sku))
      let n = 1
      while (used.has(`ZZGATE${n}`)) n++
      newSku = `ZZGATE${n}`

      const newColour = ['Blue', 'Teal', 'Plum', 'Clay'].find(
        (value) => !mergeTarget.specs.Colour.includes(value),
      )
      const newSize = ['M', 'L', 'XL', 'One Size'].find(
        (value) => !mergeTarget.specs.Size.includes(value),
      )

      const csv = [
        '货号,ASIN,颜色,尺寸',
        `${newSku},B000TEST01,Camel,M`, // new 货号, with an ASIN
        `${newSku},,Camel,L`, // new 货号, no ASIN — must still be built
        `${mergeTarget.sku},B000TEST02,${newColour},${newSize}`, // merge
        ',B000TEST03,Black,M', // no 货号 — fatal
        `${mergeTarget.sku},,Black,`, // no 尺寸 — fatal
      ].join('\n')

      await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(2000)
      await upload(csv, 'gate-import.csv')

      /* ── the preview, before anything is written ── */
      check('the preview names the file', await preview.innerText().then((t) => t.includes('gate-import.csv')), true)
      check('one brand-new 货号', await statOf('new'), 1)
      check('one existing 货号 to merge', await statOf('merge'), 1)
      check('two rows that cannot become variants', await statOf('error'), 2)
      check('one row missing its ASIN', await statOf('warn'), 1)
      check(
        'the skipped rows are listed with their line numbers',
        await preview.innerText().then((t) => t.includes('第 5 行') && t.includes('第 6 行')),
        true,
      )
      check(
        'the merge target appears in the per-货号 list',
        await preview.innerText().then((t) => t.includes(mergeTarget.sku)),
        true,
      )
      check(
        'nothing was written while the preview was open',
        (await db.from('products').select('id').eq('sku', newSku)).data?.length,
        0,
      )

      /* ── 取消 first: the safe exit has to be safe ── */
      await preview.getByRole('button', { name: '取消' }).click()
      await preview.waitFor({ state: 'detached', timeout: 10000 })
      await page.waitForTimeout(600)
      check(
        'cancelling wrote nothing',
        (await db.from('products').select('id').eq('sku', newSku)).data?.length,
        0,
      )

      /* ── and now for real ── */
      await upload(csv, 'gate-import.csv')
      await preview.getByRole('button', { name: '确认导入' }).click()
      await result.waitFor({ timeout: 30000 })
      const resultText = await result.innerText()
      check('the result counts the new product', /新建 1 个货号/.test(resultText), true)
      check('the result counts the merge', /合并 1 个货号/.test(resultText), true)
      check('the result counts the ASINs it filled', /补填 2 条 ASIN/.test(resultText), true)
      check(
        'the result points at the variant still missing an ASIN',
        /还有 1 个变体没有 ASIN/.test(resultText),
        true,
      )
      await result.getByRole('button', { name: '完成' }).click()
      await result.waitFor({ state: 'detached', timeout: 10000 })

      /* ── what the database actually holds now ── */
      const { data: created } = await db
        .from('products')
        .select('*')
        .eq('sku', newSku)
        .maybeSingle()
      check('the new 货号 exists', Boolean(created), true)
      check('and is hidden', created?.hidden, true)
      check('with the placeholder image', created?.image, './placeholders/placeholder.svg')
      check('and the 货号 as its name', created?.name, newSku)
      check('in the default category', created?.category, 'Uncategorised')
      check('with both variants built', created?.specs, { Colour: ['Camel'], Size: ['M', 'L'] })

      const { data: createdAsins } = await db
        .from('asins')
        .select('variants')
        .eq('sku', newSku)
        .maybeSingle()
      check(
        'its ASIN row holds the filled key and not the empty one',
        createdAsins?.variants,
        { 'Camel|M': 'B000TEST01' },
      )

      const { data: afterRow } = await db
        .from('products')
        .select('*')
        .eq('id', mergeTarget.id)
        .maybeSingle()
      for (const field of [
        'name',
        'image',
        'category',
        'tag',
        'hidden',
        'variant_images',
        'sold_out_variants',
        'badge_color',
        'sort_order',
        'sku',
      ]) {
        check(`the merged product's ${field} is untouched`, afterRow?.[field], beforeRow[field])
      }
      check(
        'its specs are the old ones plus the two new options',
        afterRow?.specs,
        {
          ...beforeRow.specs,
          Colour: [...beforeRow.specs.Colour, newColour],
          Size: [...beforeRow.specs.Size, newSize],
        },
      )

      const { data: afterAsins } = await db
        .from('asins')
        .select('variants')
        .eq('sku', mergeTarget.sku)
        .maybeSingle()
      const mergedVariants = afterAsins?.variants || {}
      check(
        'every key the sheet never mentioned is still there, unchanged',
        Object.fromEntries(Object.entries(mergedVariants).filter(([key]) => key in beforeVariants)),
        beforeVariants,
      )
      check(
        'and exactly one key was added',
        Object.keys(mergedVariants).filter((key) => !(key in beforeVariants)),
        [`${newColour}|${newSize}`],
      )
      check(
        'with the ASIN from the sheet',
        mergedVariants[`${newColour}|${newSize}`],
        'B000TEST02',
      )
    }
  } finally {
    /* Whatever happened above, the catalogue goes back to what it was. */
    if (mergeTarget) {
      await db.from('products').update({ specs: beforeRow.specs }).eq('id', mergeTarget.id)
      if (Object.keys(beforeVariants).length) {
        await db.from('asins').update({ variants: beforeVariants }).eq('sku', mergeTarget.sku)
      }
    }
    if (newSku) {
      await db.from('asins').delete().like('sku', 'ZZGATE%')
      await db.from('products').delete().like('sku', 'ZZGATE%')
      console.log(`  · (cleanup: ${newSku} removed, merge target restored)`)
    }
  }
}

/* ── 5p. the admin list ignores the storefront's badge pin ──
 *
 * Storefront pins badged styles to the top; admin must not. This is the screen
 * where rows are dragged into place, so if it reordered itself the next drag
 * would silently rewrite the catalogue in the pinned order. Checked by index:
 * a badged product sitting at rank 191 has to still be at row 191 here.
 */
console.log('\n[5p] Admin list keeps sort_order')

const { data: orderRows } = await db
  .from('products')
  .select('id, sku, name, tag, sort_order')
  .order('sort_order', { ascending: true })
  .order('id', { ascending: true })

await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* The row heading is the 货号 (`heading = product.sku || product.name`) and it
 * is also the checkbox's label, so the per-row checkbox list is the only
 * reliable way to read the row ORDER — the Edit button's textContent is just
 * "Edit", not the row. */
const adminHeadings = await page.evaluate(() =>
  [...document.querySelectorAll('input[aria-label^="Select "]')]
    .map((el) => el.getAttribute('aria-label'))
    .filter((label) => !/^Select all\b/.test(label))
    .map((label) => label.replace(/^Select /, '')),
)
const expectedHeadings = (orderRows || []).map((row) => row.sku || row.name)

check('the admin list has every product', adminHeadings.length, expectedHeadings.length)
check('and its order is exactly sort_order', adminHeadings.slice(0, 5), expectedHeadings.slice(0, 5))

/* The product that the storefront lifts from rank 191 to the front. */
const deepRow = (orderRows || []).find(
  (row, index) => index > 100 && String(row.tag || '').trim() && row.sku,
)
if (deepRow) {
  const expectedIndex = orderRows.indexOf(deepRow)
  check(
    `the badged ${deepRow.sku} is still at row ${expectedIndex}, not pinned`,
    adminHeadings.indexOf(deepRow.sku),
    expectedIndex,
  )
} else {
  console.log('  · no badged product below rank 100 — the "not pinned" check is vacuous')
}

/* ── 6. log out ── */console.log('\n[6] Log out')
await page.getByRole('button', { name: '退出登录', exact: true }).click()
await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })
check('gate is back', await gate().count(), 1)
check('session cleared', await sessionKeys(), [])
check('admin content gone', await productLibrary().count(), 0)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('input[aria-label="Email"]', { timeout: 15000 })
check('still locked after reload', await gate().count(), 1)

/* ── 7. storefront is untouched ── */
console.log('\n[7] Storefront')
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
check('no gate on the storefront', await gate().count(), 0)
check('product cards still render', (await page.locator('article[aria-label^="View "]').count()) > 0, true)

/* The detail sheet is the surface the bug report started from: size buttons in
 * the order the array happened to have. Same rule as the admin grid — sorted
 * for display, and the colour row keeps its declared order. */
if (storefrontSizeProbe) {
  const probe = storefrontSizeProbe
  await page.setViewportSize({ width: 1280, height: 900 })
  await page
    .locator('input[aria-label="Search by style number or name"]')
    .fill(probe.sku)
  await page.waitForTimeout(900)
  // The product name can contain characters (e.g. a literal '"') that break a
  // CSS attribute selector, so match on the accessible name instead. The card is
  // an `<article role="button">`, so its exposed role is button, not article. The
  // probe is an optional diagnostic: if that 货号 is hidden/offline and not on
  // the storefront right now, skip rather than crash the whole gate.
  const probeCard = page.getByRole('button', { name: `View ${probe.name}` }).first()
  if ((await probeCard.count()) === 0) {
    console.log(`  · skipped — "${probe.name}" is not on the storefront right now`)
  } else {
  await probeCard.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)

  const groups = await page
    .locator('[role="dialog"] [data-spec-group]')
    .evaluateAll((els) =>
      els.map((el) => ({
        type: el.getAttribute('data-spec-group'),
        values: [...el.querySelectorAll('button')].map((button) =>
          button.textContent.replace(/\(Sold out\)/, '').trim(),
        ),
      })),
    )

  const sizeGroup = groups.find((group) => /size|尺码|尺寸/i.test(group.type))
  const colourGroup = groups.find((group) => /colou?r|颜色/i.test(group.type))

  check('the sheet has a size row', Boolean(sizeGroup), true)
  check('sizes run smallest → largest on the sheet', sizeGroup?.values, sortSizes(probe.specs.Size))
  check('colours keep the declared order on the sheet', colourGroup?.values, probe.specs.Colour)

  await page.locator('[role="dialog"] button[aria-label="Close"]').first().click()
  await page.waitForTimeout(400)
  await page
    .locator('input[aria-label="Search by style number or name"]')
    .fill('')
  await page.waitForTimeout(600)
  }
}

/* ── 7b. The storefront paints the badge colour, inline ──
 *
 * Reported as "the colour is set in the admin but the card ignores it". The card
 * has always applied it as an inline `style` (a Tailwind arbitrary-class would be
 * purged at build time), so what this proves is the *render* half in isolation:
 * the response is rewritten on the way in — one product gets a `badge_color`, its
 * neighbour does not — and the assertion is on the computed background.
 *
 * Written this way on purpose: it passes whether or not the database has the
 * column yet. If it passes and the feature still does not work, the missing half
 * is the write, not the paint. (`[5i.1]` covers that half.)
 */
console.log('\n[7b] Badge paint')

const { data: tagRows } = await db
  .from('products')
  .select('id, sku, name, tag, hidden, sort_order')
  .order('sort_order', { ascending: true })
  .order('id', { ascending: true })

/* `badge_color` is an optional column (`07-badge-color.sql`), so it is read
 * separately: the section must still run on a database without it — it only
 * needs to know which badges are SUPPOSED to have no colour. */
let storedColours = new Map()
{
  const { data: colourRows, error: colourError } = await db.from('products').select('id, badge_color')
  if (!colourError) storedColours = new Map((colourRows || []).map((row) => [row.id, row.badge_color]))
}

/* What is on screen is no longer "the first 24 by sort_order": the storefront
 * pins badged styles to the top (section [7c]), so the first page mixes the
 * whole badge block with the head of the catalogue. Same partition, reproduced
 * here so a card can be addressed by INDEX — reading "the first span with this
 * text" broke the moment three styles shared the badge word "New". */
const visibleByOrder = (tagRows || []).filter((row) => !row.hidden)
const onScreen = [
  ...visibleByOrder.filter((row) => String(row.tag || '').trim()),
  ...visibleByOrder.filter((row) => !String(row.tag || '').trim()),
].slice(0, 24)

const taggedRows = onScreen.filter((row) => String(row.tag || '').trim())
const colourTarget = taggedRows[0]
/* A badge with no colour of its own — the charcoal default. Before the
 * migration every badge is in this state, so this degrades cleanly. */
const plainTarget = taggedRows.find(
  (row) => row.id !== colourTarget?.id && !String(storedColours.get(row.id) ?? '').trim(),
)

if (!colourTarget) {
  console.log('  · skipped — no visible product on the first page carries a badge')
} else {
  const INJECT_HEX = '#4A6B52'
  const INJECT_RGB = 'rgb(74, 107, 82)'
  const CREAM_RGB = 'rgb(250, 248, 245)'
  const DEFAULT_RGB = 'rgba(43, 43, 43, 0.8)'
  let served = 0

  /* A RegExp, not a glob: `?` is a single-character wildcard in Playwright's
   * glob syntax, which makes `products?*` mean something subtly different from
   * "the query string starts here". */
  await page.route(/\/rest\/v1\/products\?/, async (route) => {
    const response = await route.fetch()
    let json = null
    try {
      json = await response.json()
    } catch {
      /* Not JSON (the 400 for a column the database lacks) — replay as-is. */
    }
    if (Array.isArray(json)) {
      served++
      for (const row of json) if (row.id === colourTarget.id) row.badge_color = INJECT_HEX
      await route.fulfill({ response, json })
    } else {
      await route.fulfill({ response })
    }
  })

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  /* The catalogue store is an in-memory cache and this is the same hash route
   * the previous section was on — without a document reload no fetch happens, so
   * the route above would sit unused. Reload = empty store = a read to intercept. */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)

  /* Scoped to the product's OWN card: a document-wide "first span with this
   * text" reads a different style's badge as soon as two share a word. */
  const cardIndexOf = (id) => onScreen.findIndex((row) => row.id === id)
  const paintOf = (row) =>
    page.evaluate(
      ({ index, tag }) => {
        const card = document.querySelectorAll('article[aria-label^="View "]')[index]
        if (!card) return null
        const el = [...card.querySelectorAll('span')].find((node) => node.textContent.trim() === tag)
        if (!el) return null
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, color: style.color }
      },
      { index: cardIndexOf(row.id), tag: row.tag },
    )

  const painted = await paintOf(colourTarget)
  check('the catalogue response the browser used carried badge_color', served > 0, true)
  check('a badge with a stored colour paints it', painted?.background, INJECT_RGB)
  check('with the readable text colour on top', painted?.color, CREAM_RGB)

  if (plainTarget) {
    const plain = await paintOf(plainTarget)
    check('a badge without a colour keeps the default charcoal', plain?.background, DEFAULT_RGB)
  } else {
    console.log('  · every badge on the first page has a stored colour — default check skipped')
  }

  await page.unroute(/\/rest\/v1\/products\?/)
  /* Reload again so nothing after this section reads the injected colour out of
   * the store cache and mistakes it for real data. */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

/* ── 7c. storefront: badged styles first ──
 *
 * The rule is "badged styles lead, both groups keep the catalogue order", and
 * the interesting part is that it has to cross the page boundary: on the live
 * catalogue three of the 7 badged styles sit at rank 191/194/196, i.e. eight
 * batches down. Ordering after the slice would look correct in a fixture and do
 * nothing in production — so this compares the whole first batch against an
 * order derived here from the database, and separately checks that the deepest
 * badge is on screen at position 6 of the badged block.
 *
 * Same hash-route trap as [7b]: reload so the in-memory catalogue is refetched.
 */
console.log('\n[7c] Badge first on the storefront')

/* `is_teaser` is an operator step (08-teaser.sql) and may not exist yet, so the
 * read falls back to the four-column shape rather than failing the gate. When
 * it does exist, teasers must be excluded from `badgedLive`: a Coming Soon
 * style carries a tag but belongs to tier 3, not to the tier-1 block this
 * section measures. */
const orderQuery = (columns) =>
  db
    .from('products')
    .select(columns)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

const withTeaser = await orderQuery('id, sku, name, tag, category, hidden, sort_order, is_teaser')
const liveOrder = withTeaser.error
  ? (await orderQuery('id, sku, name, tag, category, hidden, sort_order')).data
  : withTeaser.data

const visibleRows = (liveOrder || []).filter((row) => !row.hidden && row.is_teaser !== true)
const badgeTextOf = (row) => String(row.tag ?? '').trim()
const badgedLive = visibleRows.filter(badgeTextOf)

/** Independent of `badgeFirst`: badged block, then the rest, both in the input order. */
const pinBadged = (rows) => [
  ...rows.filter((row) => badgeTextOf(row)),
  ...rows.filter((row) => !badgeTextOf(row)),
]

const gridNames = () =>
  page
    .locator('article[aria-label^="View "]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label').replace(/^View /, '')))

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

check('the catalogue has badged styles to pin', badgedLive.length > 0, true)

const openStorefront = async () => {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
}

await page.setViewportSize({ width: 1280, height: 900 })
await openStorefront()

const firstBatch = pinBadged(visibleRows).slice(0, 24)
check(
  'the first batch is every badged style, then the catalogue in order',
  await gridNames(),
  firstBatch.map((row) => row.name),
)
check(
  'the badged block is the size of the badge list',
  (await gridNames()).slice(0, badgedLive.length).every((name) => badgedLive.some((row) => row.name === name)),
  true,
)

const deepest = badgedLive[badgedLive.length - 1]
const deepestRank = visibleRows.indexOf(deepest)
check(`the badge at catalogue rank ${deepestRank} is on the first screen`, (await gridNames()).includes(deepest.name), true)
if (badgedLive.length <= 24) {
  /* The catalogue contains duplicate names, so `indexOf(deepest.name)` can find
   * an EARLIER card that happens to share the name and read "somewhere random".
   * Assert the last slot of the badged block directly instead — that is the
   * property this check is actually about. */
  check(
    'at the end of the badged block, not somewhere random',
    (await gridNames())[badgedLive.length - 1],
    deepest.name,
  )
}

/* Category: narrowing first, pinning second. */
const deepestCategory = deepest.category
if (deepestCategory) {
  await page
    .getByRole('button', { name: new RegExp(`^${escapeRegex(deepestCategory)}\\b`) })
    .first()
    .click()
  await page.waitForTimeout(800)

  const inCategory = pinBadged(visibleRows.filter((row) => String(row.category) === String(deepestCategory)))
  check(
    `inside "${deepestCategory}" the badged styles still lead`,
    (await gridNames()).slice(0, Math.min(3, inCategory.length)),
    inCategory.slice(0, 3).map((row) => row.name),
  )
  check('and the whole category is still ordered that way', await gridNames(), inCategory.slice(0, 24).map((row) => row.name))

  await page.getByRole('button', { name: /^All\b/ }).first().click()
  await page.waitForTimeout(700)
  check('clearing the category brings the pinned order back', (await gridNames()).slice(0, 3), firstBatch.slice(0, 3).map((row) => row.name))
}

/* Search: the pinned product is still findable, and a lone hit is a lone hit. */
await page.locator('input[aria-label="Search by style number or name"]').fill(deepest.sku)
await page.waitForTimeout(900)
check('searching a badged 货号 finds exactly that card', await gridNames(), [deepest.name])
await page.locator('input[aria-label="Search by style number or name"]').fill('')
await page.waitForTimeout(600)

/* Clearing the badge sends it back to its own place in the catalogue.
 * Simulated in the response rather than by writing `tag` and restoring it: the
 * reorder is a pure function of what the browser received, and this test is
 * read-only everywhere else. Requirement 1 of the brief, both halves. */
const clearedTarget = badgedLive[0]
const blankTag = async (route) => {
  /* `goto` → `reload` in `openStorefront` can abort a request that is still in
   * flight, and a route whose request was aborted throws on `fulfill`
   * ("Route is already handled!"). That is not a finding about the storefront —
   * it is a navigation — so it must not take the whole gate down with it. */
  try {
    const response = await route.fetch()
    let json = null
    try {
      json = await response.json()
    } catch {
      /* a 400 for an absent optional column — replay untouched */
    }
    if (Array.isArray(json)) {
      for (const row of json) if (row.id === clearedTarget.id) row.tag = ''
      await route.fulfill({ response, json })
    } else {
      await route.fulfill({ response })
    }
  } catch {
    /* aborted by the navigation — nothing left to answer */
  }
}

await page.route(/\/rest\/v1\/products\?/, blankTag)
try {
  await openStorefront()
  const afterClear = pinBadged(
    visibleRows.map((row) => (row.id === clearedTarget.id ? { ...row, tag: '' } : row)),
  )
  check(
    'clearing a badge puts the style back where sort_order says',
    await gridNames(),
    afterClear.slice(0, 24).map((row) => row.name),
  )
  check(
    'it no longer sits in the badged block',
    (await gridNames()).indexOf(clearedTarget.name) >= afterClear.filter(badgeTextOf).length,
    true,
  )
} finally {
  await page.unroute(/\/rest\/v1\/products\?/, blankTag)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
}

/* ── 8. console ── */
console.log('\n[8] Console')
const strayBadRequest = badRequestUrls.filter(
  (url) => !/sold_out_variants|badge_color/.test(url),
)
const pendingMigration = badRequestUrls.length > 0 && strayBadRequest.length === 0

check('no unexpected 400s', strayBadRequest, [])
if (pendingMigration) {
  console.log(`  ⚠ ${badRequestUrls.length} × 400 —— 有可选列还没建，相关功能未生效`)
  console.log('      05-sold-out.sql（断货）/ 07-badge-color.sql（角标颜色）/ 08-teaser.sql（商品预告）在 Supabase SQL Editor 跑一次即可')
}

const realErrors = consoleErrors.filter((text) => {
  if (/favicon|404 \(Not Found\)|Invalid login credentials/i.test(text)) return false
  if (/status of 400/i.test(text) && pendingMigration) return false
  return true
})
if (toleratedErrors.length) {
  console.log(
    `  · tolerated ${toleratedErrors.length} × 404 (optional tables not created yet: product_links / settings)`,
  )
}
check('no runtime errors', realErrors, [])


/* ── 9. Collateral damage ──
 *
 * Every section above repairs what it breaks, and every one of those repairs is
 * checked — but only against what that section saw when it started. So a slow
 * write that lands *after* a cleanup, or a repair that restores a snapshot which
 * was itself already wrong, passes every local check while the live table drifts.
 * (It happened: a run ended green with the catalogue rotated by one row.)
 *
 * This section compares the table against the order captured before [5b] touched
 * anything. It is the only check in the file that can fail because of a section
 * that finished a minute earlier.
 */
/* ── 5t. Shield 1 — single-delete needs a confirmation modal ──
 *
 * A slip of the mouse must not destroy a 货号. The row's trash icon opens a
 * modal that names the exact product; Cancel walks away and writes nothing; only
 * the red Delete button performs the deletion. A throwaway ZZGATE product is
 * created for this and removed by the end, so the catalogue order [9] compares
 * is untouched.
 */
console.log('\n[5t] Shield 1 — single delete needs a confirmation modal')

await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
// [6] deliberately logged out; this section needs a live admin session. Safe to
// call when already signed in (it no-ops).
await signInAdmin(page)
await page.waitForTimeout(600)

// Clear any leftovers a previously-interrupted run may have left behind, so the
// [9] catalogue-order snapshot is not polluted by a stray test row.
await db.from('products').delete().like('sku', 'ZZGATE-S1-%')

// A disposable product, parked at the very end so it never disturbs the order of
// the real catalogue (and [9] won't see it once we delete it).
const shieldSku = `ZZGATE-S1-${Date.now()}`
await db.from('products').insert({
  sku: shieldSku,
  name: 'Shield1Temp',
  category: 'Uncategorised',
  image: './placeholders/placeholder.svg',
  specs: { Colour: ['Camel'], Size: ['M'] },
  variant_images: {},
  hidden: false,
  sort_order: 9_999_999,
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

const searchBox5t = page.locator('input[placeholder^="搜索货号"]')
await searchBox5t.fill(shieldSku)
await page.waitForTimeout(700)
check('the throwaway product is listed', await page.locator(`[aria-label="Edit Shield1Temp"]`).count(), 1)
check('it exists in the database', (await db.from('products').select('sku').eq('sku', shieldSku).maybeSingle()).data?.sku, shieldSku)

const singleModal = page.locator('[role="dialog"][aria-label="永久删除商品"]')

// Clicking trash must NOT delete — it must open a confirmation modal instead.
await page.locator('button[aria-label="Delete Shield1Temp"]').click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除商品"]', { timeout: 15000 })
check('a confirmation modal opens instead of deleting', await singleModal.count(), 1)
check(
  'it names the exact product (sku + name)',
  /确定要删除 ZZGATE-S1-\d+ \(Shield1Temp\) 吗？/.test(await singleModal.innerText()),
  true,
)
check('it warns that this cannot be undone', /此操作不可撤销。/.test(await singleModal.innerText()), true)
check('it offers a Cancel button', await singleModal.getByRole('button', { name: '取消' }).count(), 1)
check('it offers a red Delete button', await singleModal.getByRole('button', { name: '删除', exact: true }).count(), 1)
check('opening the modal did NOT delete the product', (await db.from('products').select('sku').eq('sku', shieldSku).maybeSingle()).data?.sku, shieldSku)

// Cancel must walk away and write nothing.
await singleModal.getByRole('button', { name: '取消' }).click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除商品"]', { state: 'detached', timeout: 8000 })
check('Cancel closes the modal without deleting', (await db.from('products').select('sku').eq('sku', shieldSku).maybeSingle()).data?.sku, shieldSku)

// Now the real path: the red button actually writes the deletion.
await page.locator('button[aria-label="Delete Shield1Temp"]').click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除商品"]', { timeout: 15000 })
await singleModal.getByRole('button', { name: '删除', exact: true }).click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除商品"]', { state: 'detached', timeout: 8000 })
await page.waitForTimeout(800)
check('the red Delete button actually removes the product', (await db.from('products').select('sku').eq('sku', shieldSku).maybeSingle()).data, null)
await searchBox5t.fill('')
await page.waitForTimeout(400)

/* ── 5u. Shield 2 — bulk delete circuit breaker over 30% ──
 *
 * Selecting more than 30% of the catalogue must not be a one-click delete. The
 * modal forces a typed "DELETE" before its confirm button arms. We select all,
 * open the bulk delete, verify the guard, then Cancel — nothing is written.
 */
console.log('\n[5u] Shield 2 — bulk delete circuit breaker above 30%')

await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await signInAdmin(page) // no-op if [5t] left us signed in
await page.waitForTimeout(600)

const totalBefore = (await db.from('products').select('id', { count: 'exact', head: true })).count
check('catalogue has products to select', totalBefore > 0, true)

// Select every row on screen.
await page.locator('input[aria-label="Select all products on this screen"]').click()
await page.waitForTimeout(500)
const selectedCount = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((n) => /^\d+ selected$/.test(n.textContent.trim()))
  return el ? Number(el.textContent.trim().split(' ')[0]) : 0
})
check('select-all ticks the whole catalogue', selectedCount, totalBefore)
check('selection is over 30% of the catalogue', selectedCount / totalBefore > 0.3, true)

// Open the bulk delete dialog.
await page.getByRole('button', { name: '删除', exact: true }).click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除所选商品"]', { timeout: 15000 })
const bulkModal = page.locator('[role="dialog"][aria-label="永久删除所选商品"]')
check('the bulk delete modal opens', await bulkModal.count(), 1)
check(
  'it shows the circuit-breaker warning',
  /这会永久删除 \d+ 件商品（占全库 \d+%）/.test(await bulkModal.innerText()),
  true,
)
const confirmBtn = bulkModal.getByRole('button', { name: '永久删除', exact: true })
check('the confirm button is DISABLED until DELETE is typed', await confirmBtn.isDisabled(), true)

// Typing DELETE arms it.
await bulkModal.locator('input[aria-label="Type DELETE to confirm bulk deletion"]').fill('DELETE')
await page.waitForTimeout(300)
check('typing DELETE enables the confirm button', await confirmBtn.isDisabled(), false)

// Cancel — nothing is written.
await bulkModal.getByRole('button', { name: '取消' }).click()
await page.waitForSelector('[role="dialog"][aria-label="永久删除所选商品"]', { state: 'detached', timeout: 8000 })
const totalAfter = (await db.from('products').select('id', { count: 'exact', head: true })).count
check('Cancel left the catalogue untouched', totalAfter, totalBefore)

// Clear the selection so later sections start clean.
await page.locator('button[aria-label="Clear selection"]').click()
await page.waitForTimeout(400)

console.log('\n[9] Collateral damage')
const orderAtEnd = await orderIds()
/* 运营可能同时在后台改货架（新增 / 删除 / 拖拽）。这条断言守的是"**这次跑测试
 * 有没有打乱顺序**"，所以只比较两次都在的 id 的相对顺序 —— 别人新加的或删掉的
 * 商品不该让这条挂掉，但任何一次真实的错位都会被抓住。 */
const survived = new Set(orderAtEnd)
const common = catalogueOrderAtStart.filter((id) => survived.has(id))
const commonAtEnd = orderAtEnd.filter((id) => catalogueOrderAtStart.includes(id))
check('the catalogue order the run started with is still the order', commonAtEnd, common)
if (JSON.stringify(commonAtEnd) !== JSON.stringify(common)) {
  const drift = commonAtEnd
    .map((id, i) => (id === common[i] ? null : `${i}: ${common[i]} → ${id}`))
    .filter(Boolean)
  console.log(`      ${drift.length} slot(s) moved, first: ${drift.slice(0, 3).join(' | ')}`)
  console.log('      restoring from the snapshot…')
  await restoreOrder(catalogueOrderAtStart, 'catalogue order')
}

/* ── 5v. Shield 3 — idle session auto-logout ──
 *
 * After 480 minutes (8 hours) of no real activity the session is dropped and the gate
 * reclaims the screen. The timeout is a configurable constant; here we shorten it
 * via localStorage.adminIdleMs (capped in code to a sane band) so the test can
 * fire it in seconds instead of two hours. We confirm the operator is still signed
 * in right after load (the override must not log them out on mount), then go idle
 * and watch the gate return. This is the last section — it intentionally signs
 * the session out.
 */
/* ── 5w. Coming Soon (Teaser) — storefront lock ──
 *
 * The `is_teaser` column is an operator step (supabase/08-teaser.sql) and may
 * not exist yet, so this test injects `is_teaser: true` into the catalogue
 * response for one real product. That exercises the exact UI path the flag
 * drives — single-badge priority, every size disabled, the add button replaced
 * by a disabled Coming Soon — without depending on the migration.
 */
console.log('\n[5w] Coming Soon (Teaser) — storefront lock')

const { data: teaserCandidates } = await db
  .from('products')
  .select('id, sku, name, tag, specs, hidden')
  .eq('hidden', false)
  .order('sort_order', { ascending: true })

const teaserProduct = (teaserCandidates || []).find(
  (row) =>
    row.sku &&
    row.name &&
    row.specs &&
    Object.keys(row.specs).some((type) => /size|尺码|尺寸/i.test(type)),
)

if (!teaserProduct) {
  console.log('  · skipped — no visible product with a size axis')
} else {
  const teaserId = String(teaserProduct.id)
  const originalTag = String(teaserProduct.tag || '').trim()
  const storefrontRoute = '**/rest/v1/products**'

  await page.route(storefrontRoute, async (route) => {
    /* Same navigation race as [7c]: an aborted request throws on fulfill, and
     * a route handler that rejects takes the whole run down. */
    try {
      const response = await route.fetch()
      try {
        const body = await response.json()
        const rows = Array.isArray(body) ? body : [body]
        const patched = rows.map((row) =>
          String(row.id) === teaserId ? { ...row, is_teaser: true } : row,
        )
        await route.fulfill({ response, json: Array.isArray(body) ? patched : patched[0] })
      } catch {
        await route.fulfill({ response })
      }
    } catch {
      /* aborted by the navigation */
    }
  })

  // Full reload (not just a hash change) so the storefront refetches through
  // the route above instead of rendering a previously cached catalogue.
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)

  await page.locator('input[aria-label="Search by style number or name"]').fill(teaserProduct.sku)
  await page.waitForTimeout(900)

  // `<article role="button">` — its exposed role is button, not article.
  const teaserCard = page.getByRole('button', { name: `View ${teaserProduct.name}` }).first()
  check('the teaser is still visible on the storefront', await teaserCard.count(), 1)
  const cardText = await teaserCard.innerText()
  check('the card shows the Coming Soon badge', /Coming Soon/.test(cardText), true)
  if (originalTag && originalTag !== 'Coming Soon' && !teaserProduct.name.includes(originalTag)) {
    check(
      'Coming Soon overrides the original badge (single badge)',
      cardText.includes(originalTag),
      false,
    )
  }

  await teaserCard.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)
  const teaserDialog = page.locator('[role="dialog"]')

  const sizeGroup = teaserDialog
    .locator('[data-spec-group]')
    .filter({ hasText: /size|尺码|尺寸/i })
    .first()
  const sizeButtons = sizeGroup.locator('button')
  const sizeCount = await sizeButtons.count()
  check('the sheet has size buttons', sizeCount > 0, true)
  let allSizesDisabled = sizeCount > 0
  for (let i = 0; i < sizeCount; i++) {
    if (!(await sizeButtons.nth(i).isDisabled())) allSizesDisabled = false
  }
  check('every size button is disabled', allSizesDisabled, true)

  const colourGroup = teaserDialog
    .locator('[data-spec-group]')
    .filter({ hasText: /colou?r|颜色/i })
    .first()
  if ((await colourGroup.count()) > 0) {
    const colourButtons = colourGroup.locator('button')
    let anyColourEnabled = false
    for (let i = 0; i < (await colourButtons.count()); i++) {
      if (!(await colourButtons.nth(i).isDisabled())) anyColourEnabled = true
    }
    check('colours stay pickable', anyColourEnabled, true)
  }

  const teaserFooter = teaserDialog.getByRole('button', { name: 'Coming Soon', exact: true })
  check('the add button is replaced by Coming Soon', await teaserFooter.count(), 1)
  check('and it is disabled', await teaserFooter.isDisabled(), true)
  check(
    '"Add to my selection" is gone',
    await teaserDialog.getByRole('button', { name: /Add to my selection/i }).count(),
    0,
  )

  await page.locator('[role="dialog"] button[aria-label="Close"]').first().click()
  await page.waitForTimeout(300)

  /* ── legacy cart: added before the style was marked ──
   * The line cannot be created through the UI any more (`makeLine` refuses a
   * teaser), so seed localStorage exactly as a browser that added it earlier
   * would hold it, then reload. The drawer must NAME it, disable Generate, and
   * offer a one-tap remove — never silently drop it. */
  const teaserSpecs = {}
  for (const [type, values] of Object.entries(teaserProduct.specs || {})) {
    const list = Array.isArray(values) ? values : [values]
    if (list.length) teaserSpecs[type] = list[0]
  }
  await page.evaluate(
    ({ productId, specs }) => {
      localStorage.setItem(
        'mako_lines_v1',
        JSON.stringify({
          v: 2,
          updatedAt: Date.now(),
          lines: [{ key: `${productId}::`, productId, qty: 1, specs }],
        }),
      )
    },
    { productId: teaserId, specs: teaserSpecs },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('button[aria-label="View your selection"]').click()
  await page.waitForSelector('[role="dialog"][aria-label="Your selection"]', { timeout: 15000 })
  await page.waitForTimeout(400)
  const teaserCart = page.locator('[role="dialog"][aria-label="Your selection"]')
  const teaserCartText = await teaserCart.innerText()
  check('a legacy teaser line is named in the cart', /Coming Soon/.test(teaserCartText), true)
  check(
    'the cart says to remove it before generating',
    /Remove (it|them) before generating/i.test(teaserCartText),
    true,
  )
  const teaserGenerate = teaserCart.getByRole('button', { name: /Generate my code/i })
  check('Generate is disabled while a teaser is in the cart', await teaserGenerate.isDisabled(), true)
  await teaserCart.getByRole('button', { name: /Remove Coming Soon/i }).click()
  await page.waitForTimeout(500)
  check(
    'the one-tap remove clears the teaser line',
    /Your selection is empty/i.test(await teaserCart.innerText()),
    true,
  )
  await page.locator('[role="dialog"] button[aria-label="Close"]').first().click()
  await page.waitForTimeout(300)
  await page.evaluate(() => localStorage.removeItem('mako_lines_v1'))

  await page.unroute(storefrontRoute)
}

/**
 * [5x] Limited Deal — the deals tab, the discount bands, and the tier rule that
 * keeps Coming Soon off the first screen.
 *
 * Everything is injected through one route handler, so none of it depends on
 * `09-deal.sql` having been run: what is exercised is the real storefront code
 * against real product rows. Four products are used — three deals covering three
 * different discount bands (one of them scheduled), plus a teaser that also has
 * a deal window, which must stay out of the tab and out of the first batch.
 */
console.log('\n[5x] Limited Deals — tab, price bands, Coming Soon sinks')

const dealRoute = '**/rest/v1/products**'
const { data: dealCandidates } = await db
  .from('products')
  .select('id, sku, name, tag, hidden, sort_order')
  .eq('hidden', false)
  .order('sort_order', { ascending: true })
  .order('id', { ascending: true })

const dealRows = dealCandidates || []
/* The first visible product is the one the storefront would otherwise show
 * first — the strongest possible test of "a teaser sinks". */
const [sinkRow, cardA, cardB, cardC] = dealRows

if (!cardC) {
  console.log('  · skipped — need four visible products')
} else {
  const stamp = (offsetHours) => {
    const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const window = (from, to) => ({ sale_start: stamp(from), sale_end: stamp(to) })

  /* Discounts are deliberately left for the storefront to compute
   * (`discount_label: ''`), so this also proves the auto-label works end to end.
   *   25% → band 20-30 | 35% → band 30-40 | 50% → band 40+ (scheduled) */
  /* 角标也一起隔离：库里 41 件商品正挂着 `Black Friday` 大促标（运营真在跑
   * 黑五），不抹掉的话"货架上的第一行是 Limited Deal"会随机失败。cardA 例外
   * —— 它拿到一枚和专区 Tab 同名的活动标，用来验证"专区里不重复挂自己的
   * 名字"这条规则。 */
  const { data: labelRow } = await db
    .from('settings')
    .select('value')
    .eq('key', 'deals_tab_label')
    .maybeSingle()
  const tabName = String(labelRow?.value || 'Limited Deals').trim()
  /* Tab 名允许带 emoji（库里现在是 `🔥Black Friday`），而运营填的大促标不会
   * 带。抹掉符号正好证明归一化认得出"同一场活动"。 */
  const tabWord = tabName.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() || 'Black Friday'

  const dealFields = {
    [sinkRow.id]: { ...window(-1, 3), sale_price: '19.99', original_price: '39.99', discount_label: '', is_teaser: true, tag: '', sub_tag: null },
    [cardA.id]: { ...window(-1, 3), sale_price: '30', original_price: '40', discount_label: '', tag: '', sub_tag: tabWord },
    [cardB.id]: { ...window(-1, 4), sale_price: '65', original_price: '100', discount_label: '', tag: '', sub_tag: null },
    [cardC.id]: { ...window(30, 54), sale_price: '25', original_price: '50', discount_label: '', tag: '', sub_tag: null },
  }

  await page.route(dealRoute, async (route) => {
    try {
      const response = await route.fetch()
      try {
        const body = await response.json()
        const rows = Array.isArray(body) ? body : [body]
        /* 只让这四个 fixture 有秒杀窗口：其余行把 `sale_*` 抹掉。库里可能
         * 已经有运营真在跑的活动，不隔离的话"专区恰好 3 件"会随业务数据漂移
         * —— 这条测试要验证的是代码，不是目录里有多少活动。 */
        const blank = {
          sale_start: null,
          sale_end: null,
          sale_price: null,
          original_price: null,
          discount_label: null,
        }
        const patched = rows.map((row) =>
          dealFields[row.id] ? { ...row, ...dealFields[row.id] } : { ...row, ...blank },
        )
        await route.fulfill({ response, json: Array.isArray(body) ? patched : patched[0] })
      } catch {
        await route.fulfill({ response })
      }
    } catch {
      /* aborted by a navigation */
    }
  })

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)

  const cardText = async (name) =>
    (await page.getByRole('button', { name: `View ${name}` }).first().innerText()).replace(/\s+/g, ' ')

  /* ── the first screen is still all shoppable ── */
  const firstScreen = await gridNames()
  check('the first screen is a full batch', firstScreen.length, 24)
  if (dealRows.filter((row) => row.name === sinkRow.name).length === 1) {
    check('the Coming Soon style is not on it', firstScreen.includes(sinkRow.name), false)
  } else {
    console.log('  · 第一个商品重名，位置断言改用下面的角标计数')
  }
  check(
    'and no card on it wears a Coming Soon badge',
    await page
      .locator('article[aria-label^="View "]')
      .evaluateAll((els) => els.filter((el) => /Coming Soon/.test(el.textContent || '')).length),
    0,
  )

  /* ── the chip, and the normal catalogue's restraint ── */
  /* Tab 名可配置（`settings.deals_tab_label`，后台可改成 Black Friday Deals）。
   * 这里读实时值来定位和断言 —— 否则运营一改名，冒烟就会"假失败"。 */
  const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const dealsLabel = await page.evaluate(
    () => window.SAODIMALLSU?.settings?.().dealsTabLabel || 'Limited Deals',
  )
  const dealsChip = page.getByRole('button', { name: new RegExp(escapeRe(dealsLabel)) })
  check('the deals tab exists', await dealsChip.count(), 1)
  check(
    'the chip shows the configured name',
    (await dealsChip.innerText()).includes(dealsLabel),
    true,
  )
  check(
    'and counts the three buyable deals (the teaser is not one)',
    new RegExp(`${escapeRe(dealsLabel)}\\s*3\\b`).test(
      (await dealsChip.innerText()).replace(/\s+/g, ' '),
    ),
    true,
  )

  const allTabCard = await cardText(cardA.name)
  /* cardB 没有大促标，用来断言"系统派生的身份"。
   * 常规货架：只说身份（Limited Deal），**不出折扣数字** —— 货架上每件都在
   * 被比较，一行 25% OFF 会把视线从"这是什么"拉到"多少钱"。 */
  const allTabPlainDeal = await cardText(cardB.name)
  check('a deal card names the deal on the catalogue', allTabPlainDeal.includes('Limited Deal'), true)
  check('but keeps the percentage for the deals tab', allTabPlainDeal.includes('35% OFF'), false)
  check('with no emoji left in the badge', /[⚡🔥💰]/.test(allTabPlainDeal), false)
  check('and shows no price outside the tab', allTabPlainDeal.includes('$65'), false)

  /* cardA 挂着一枚和专区 Tab 同名的活动标：货架上它必须在。 */
  check('a campaign badge shows on the catalogue', allTabCard.includes(tabWord), true)
  check('and it outranks the derived deal identity', allTabCard.includes('Limited Deal'), false)

  /* ── the deals tab ── */
  await dealsChip.click()
  await page.waitForTimeout(900)
  check('the tab lists exactly the deals', await page.locator('article').count(), 3)
  check('with prices', (await cardText(cardA.name)).includes('$30'), true)

  /* 专区：整区都在秒杀，第一行不再写 Limited Deal；折扣自己占一行。 */
  const dealsTabCard = await cardText(cardA.name)
  check('the deals tab drops the redundant identity', dealsTabCard.includes('Limited Deal'), false)
  check('and shows the number instead', dealsTabCard.includes('25% OFF'), true)
  /* 这条是"点进 Black Friday 目录还顶着一枚 Black Friday"的回归测试：
   * 专区自己的名字不重复挂，哪怕 Tab 名带 emoji、角标不带。 */
  check('the tab does not repeat its own name on every card', dealsTabCard.includes(tabWord), false)
  check('and the scheduled one is in there too', (await gridNames()).includes(cardC.name), true)

  /* ── discount bands ── */
  await page.getByRole('button', { name: '30% - 40%', exact: true }).click()
  await page.waitForTimeout(700)
  check('a band narrows the tab to one style', await page.locator('article').count(), 1)
  check('the 35% one', (await gridNames())[0], cardB.name)

  await page.getByRole('button', { name: '10% - 20%', exact: true }).click()
  await page.waitForTimeout(600)
  check('a band with nothing in it is empty, not broken', await page.locator('article').count(), 0)

  /* ── a scheduled deal counts the other way ── */
  await page.getByRole('button', { name: 'All deals', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: `View ${cardC.name}` }).first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(700)
  const scheduledSheet = (await page.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ')
  check('a scheduled deal says "starts in"', /Deal starts in/.test(scheduledSheet), true)
  /* 30 小时后开始 —— 超过 24 小时就说"1 day"，不是连秒针都不用看的 29:59:59。 */
  check('more than a day out, it counts days', /Deal starts in 1 day(\s|$)/.test(scheduledSheet), true)
  check('and shows no clock at that distance', /\d{2}:\d{2}:\d{2}/.test(scheduledSheet), false)
  check('and repeats the price', scheduledSheet.includes('$25'), true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  /* ── Coming Soon still wins over the deal ──
   * The tab excluding the teaser is already proven by the count above; this part
   * is about the card and the sheet. `/^All \d/` targets the category chip —
   * `^All\b` would also match the "All deals" band button next to it. */
  await page.getByRole('button', { name: /^All \d/ }).first().click()
  await page.waitForTimeout(600)

  await page.locator('input[aria-label="Search by style number or name"]').fill(sinkRow.sku)
  await page.waitForTimeout(900)
  const teaserCard = page.getByRole('button', { name: `View ${sinkRow.name}` }).first()
  check('the teaser is still findable (sunk, not hidden)', await teaserCard.count(), 1)
  const teaserText = (await teaserCard.innerText()).replace(/\s+/g, ' ')
  check('Coming Soon wins over the deal badge', /Coming Soon/.test(teaserText), true)
  check('and no deal price is shown', teaserText.includes('$19.99'), false)

  await page.locator('input[aria-label="Search by style number or name"]').fill('')
  await page.waitForTimeout(700)
  await page.unroute(dealRoute)
}

console.log('\n[5z] ACC commission — badge, detail card, copy, and the admin switch')

/* Same technique as [5x]: fields are injected into the REST response, so none of
 * this depends on `10-acc.sql` having been run. A fifth product is used so the
 * deal/teaser assertions above keep their own rows intact. */
const { data: accCandidates } = await db
  .from('products')
  .select('id, sku, name, tag, hidden, sort_order')
  .eq('hidden', false)
  .order('sort_order', { ascending: true })
  .order('id', { ascending: true })

const accRows = accCandidates || []
const accRow = accRows.find(
  (row) => ![sinkRow?.id, cardA?.id, cardB?.id, cardC?.id].includes(row.id),
)

if (!accRow) {
  console.log('  · skipped — need a fifth visible product')
} else {
  const ACC_CAMPAIGN = 'ZZACC-9C1D-4E2F'
  const accRoute = '**/rest/v1/products**'

  await page.route(accRoute, async (route) => {
    try {
      const response = await route.fetch()
      try {
        const body = await response.json()
        const rows = Array.isArray(body) ? body : [body]
        const patched = rows.map((row) =>
          row.id === accRow.id
            ? { ...row, has_acc: true, acc_id: ACC_CAMPAIGN, tag: 'ZZTAG', badge_color: null }
            : row,
        )
        await route.fulfill({ response, json: Array.isArray(body) ? patched : patched[0] })
      } catch {
        await route.fulfill({ response })
      }
    } catch {
      /* aborted by a navigation */
    }
  })

  /* Chromium gates clipboard reads behind a permission; the write itself comes
   * from a real click, which is the gesture the API wants. */
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  } catch {
    console.log('  · 剪贴板权限未授予，复制回读会跳过')
  }

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await page.locator('input[aria-label="Search by style number or name"]').fill(accRow.sku)
  await page.waitForTimeout(900)

  const accCard = page.getByRole('button', { name: `View ${accRow.name}` }).first()
  check('the product is on the storefront', await accCard.count(), 1)
  /* ACC 从卡片上撤掉了：佣金是点进去才判断的事，卡片上那枚只是噪音。
   * 卡片上只剩运营填的普通标。 */
  const accBadges = (await accCard.locator('[data-badge-stack]').innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  check('the card no longer wears an ACC badge', accBadges.includes('ACC'), false)
  check('only the ops label is left', accBadges, ['ZZTAG'])

  await accCard.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(700)

  const accSheet = page.locator('[role="dialog"]')
  const accSheetText = (await accSheet.innerText()).replace(/\s+/g, ' ')
  /* 详情页仍然给：角标身份 + 一整块 ACC 卡片。 */
  const sheetBadges = (await accSheet.locator('[data-badge-stack]').innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  check('the sheet still wears the ACC badge', sheetBadges[0], 'ACC')
  check('the sheet has a dedicated ACC card', await accSheet.locator('[data-acc-card]').count(), 1)
  check('with the campaign ID on it', accSheetText.includes(ACC_CAMPAIGN), true)

  const copyButton = accSheet.getByRole('button', { name: 'Copy campaign ID' })
  check('and a copy button', await copyButton.count(), 1)
  await copyButton.click()
  await page.waitForTimeout(350)
  check('clicking it confirms', (await copyButton.innerText()).trim(), 'Copied')
  const clipText = await page
    .evaluate(() => navigator.clipboard.readText().catch(() => ''))
    .catch(() => '')
  if (clipText) check('the clipboard holds exactly the ID', clipText, ACC_CAMPAIGN)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.locator('input[aria-label="Search by style number or name"]').fill('')
  await page.waitForTimeout(400)
  await page.unroute(accRoute)

  /* ── the editor's card ──
   * Opened without saving: before 10-acc.sql is run the columns are absent, and
   * a save would be stripped — that case is what the card's amber warning says
   * out loud, so the test only proves the controls are there. */
  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('button[aria-label^="Edit "]').first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await page.waitForTimeout(600)
  check(
    'the editor has an ACC switch',
    await page.getByRole('switch', { name: 'Amazon Creator Connections' }).count(),
    1,
  )
  await page
    .getByRole('button', { name: /Amazon 创作者计划/ })
    .first()
    .click()
  await page.waitForTimeout(400)
  check(
    'and a campaign ID field',
    await page.locator('input[aria-label="ACC campaign ID"]').count(),
    1,
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

console.log('\n[5ab] Category rail — wheel pans sideways, drag pans, clicks still land')

/* A narrow viewport is how this bug shows up in real life: the rail overflows and
 * a mouse has no way to reach the right-hand categories. Touch is deliberately
 * not exercised here — the hook ignores every non-mouse pointer. */
await page.setViewportSize({ width: 480, height: 900 })
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1600)

const categoryRail = page.locator('[data-rail="categories"]')
const railMetrics = await categoryRail.evaluate((el) => ({
  max: el.scrollWidth - el.clientWidth,
  cursor: getComputedStyle(el).cursor,
}))
const activeCategoryLabel = async () =>
  ((await page.locator('[data-rail="categories"] button[aria-pressed="true"]').first().innerText()) ||
    '')
    .split('\n')[0]
    .trim()

if (railMetrics.max <= 1) {
  console.log('  · skipped — this catalogue fits the rail even at 480px')
} else {
  const railBox = await categoryRail.boundingBox()
  const railY = railBox.y + railBox.height / 2
  check('the rail overflows at this width', railMetrics.max > 40, true)
  check('and shows a grab cursor', railMetrics.cursor, 'grab')

  /* ── wheel down = scroll right, and the page does not move ── */
  await page.mouse.move(railBox.x + railBox.width / 2, railY)
  const pageBefore = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 320)
  await page.waitForTimeout(400)
  const afterWheel = await categoryRail.evaluate((el) => el.scrollLeft)
  check('the vertical wheel panned the rail', afterWheel > 200, true)
  check(
    'and the page itself stayed put',
    await page.evaluate(() => window.scrollY),
    pageBefore,
  )

  /* ── at the right edge the wheel goes back to the page ── */
  await categoryRail.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await page.waitForTimeout(200)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(400)
  check(
    'at the edge the rail stops',
    await categoryRail.evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1),
    true,
  )
  check('and the page scrolls instead', (await page.evaluate(() => window.scrollY)) > 0, true)
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await page.waitForTimeout(300)

  /* ── drag pans, and does not select a category on release ── */
  await categoryRail.evaluate((el) => {
    el.scrollLeft = 0
  })
  await page.waitForTimeout(200)
  const beforeDrag = await activeCategoryLabel()
  const dragBox = await categoryRail.boundingBox()
  const dragFrom = { x: dragBox.x + dragBox.width - 60, y: dragBox.y + dragBox.height / 2 }
  await page.mouse.move(dragFrom.x, dragFrom.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(dragFrom.x - step * 20, dragFrom.y)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(350)
  check('dragging left pans the rail', (await categoryRail.evaluate((el) => el.scrollLeft)) > 140, true)
  check('and releasing did not switch category', await activeCategoryLabel(), beforeDrag)

  /* ── a plain click still works after all of that ── */
  const clickTarget = page.locator('[data-rail="categories"] button').nth(2)
  const clickLabel = ((await clickTarget.innerText()) || '').split('\n')[0].trim()
  await clickTarget.click()
  await page.waitForTimeout(500)
  check('a click still selects its category', await activeCategoryLabel(), clickLabel)
  check(
    'and the same chip is marked pressed',
    await clickTarget.getAttribute('aria-pressed'),
    'true',
  )

  /* Put the filter back: the next section searches by 货号, and a leftover
   * category would hide a product that lives in another one. */
  await page.getByRole('button', { name: /^All \d/ }).first().click()
  await page.waitForTimeout(400)
}

await page.setViewportSize({ width: 900, height: 1000 })
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
/* A hash-only navigation does not remount the page, so the storefront keeps its
 * React state (active category, search). Reload for a clean slate. */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)

console.log('\n[5ac] Product sheet — split panes on desktop, sticky photo on mobile')

/* The sheet used to be one scroll column: by the time the size pickers came into
 * view, the photo was long gone. These assertions are about geometry, because
 * "can you see the photo while picking" is exactly a geometry question. */
const { data: sheetRows } = await db
  .from('products')
  .select('sku, name, specs, variant_images')
  .eq('hidden', false)

const sheetRow = (sheetRows || []).find((row) => {
  const groups = Object.keys(row.specs || {})
  if (groups.length < 2) return false
  const byOption = (row.variant_images || {})[groups[0]] || {}
  return new Set(Object.values(byOption).filter(Boolean)).size >= 2
})

if (!sheetRow) {
  console.log('  · skipped — no product with a per-colour photo set')
} else {
  const openSheet = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
    /* Reset the storefront state (category + search) before each size, and make
     * sure the new viewport is actually laid out before measuring boxes. */
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    await page.locator('input[aria-label="Search by style number or name"]').fill(sheetRow.sku)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: `View ${sheetRow.name}` }).first().click()
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
    await page.waitForTimeout(700)
  }

  const firstImage = () => page.locator('[data-detail-photo] img').first().getAttribute('src')

  /* ── desktop: two panes, photo pinned, action bar only under the info ── */
  await openSheet(1280, 800)
  const dPhoto = await page.locator('[data-detail-photo]').boundingBox()
  const dInfo = await page.locator('[data-detail-pane="info"]').boundingBox()
  const dFooter = await page.locator('[data-detail-footer]').boundingBox()
  check('desktop lays the sheet out in two panes', dPhoto.x + dPhoto.width <= dInfo.x + 1, true)
  check('photo on the left, full height', dPhoto.height > dInfo.height, true)
  check('the action bar sits under the info pane, not the photo', dFooter.x >= dInfo.x - 1, true)
  check(
    'and the info pane owns its own scroll',
    await page.locator('[data-detail-pane="info"]').evaluate((el) => getComputedStyle(el).overflowY),
    'auto',
  )

  const beforeSwap = await firstImage()
  let swapped = false
  const options = page.locator('[data-spec-group]').first().locator('button')
  const optionCount = await options.count()
  for (let index = 1; index < Math.min(optionCount, 5) && !swapped; index += 1) {
    await options.nth(index).click()
    await page.waitForTimeout(800)
    swapped = (await firstImage()) !== beforeSwap
  }
  check('picking another colour swaps the photo in place', swapped, true)
  check(
    'the crossfade layer is cleaned up afterwards',
    await page.locator('[data-detail-photo] img').count(),
    1,
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ── phone: the photo sticks, and shrinks only when there is room to give ── */
  await openSheet(375, 568)
  const mobileOverflow = await page
    .locator('[data-detail-scroll]')
    .evaluate((el) => el.scrollHeight - el.clientHeight)
  const mPhoto = await page.locator('[data-detail-photo]').boundingBox()
  if (mobileOverflow > 100) {
    await page.locator('[data-detail-scroll]').evaluate((el) => {
      el.scrollTop = 160
    })
    await page.waitForTimeout(700)
  } else {
    console.log(`  · 内容只超出 ${Math.round(mobileOverflow)}px，跳过吸顶断言`)
  }
  const mStuck = await page.locator('[data-detail-photo]').boundingBox()
  if (mobileOverflow > 100) {
    check('the photo stays pinned while the specs scroll', Math.abs(mStuck.y - mPhoto.y) < 2, true)
    check('and gets shorter to give the specs room', mStuck.height < mPhoto.height - 20, true)
  }
  /* Back to the top before tapping: a chip that has scrolled under the pinned
   * photo is not clickable by a human either, and this test is about the swap,
   * not about clicking through a header. */
  await page.locator('[data-detail-scroll]').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(400)
  const beforeMobile = await firstImage()
  await page.locator('[data-spec-group]').first().locator('button').nth(1).click()
  await page.waitForTimeout(800)
  if ((await firstImage()) === beforeMobile) {
    /* The second colour may share the main photo; try one more before failing. */
    await page.locator('[data-spec-group]').first().locator('button').nth(2).click()
    await page.waitForTimeout(800)
  }
  check('a colour tap still swaps the photo on the phone layout', (await firstImage()) !== beforeMobile, true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ── sideways phone: same two panes, nothing spills horizontally ── */
  await openSheet(844, 390)
  const lPhoto = await page.locator('[data-detail-photo]').boundingBox()
  const lInfo = await page.locator('[data-detail-pane="info"]').boundingBox()
  check('a landscape phone gets the split too', lPhoto.x + lPhoto.width <= lInfo.x + 1, true)
  check(
    'and the sheet never scrolls sideways',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 900, height: 1000 })
}

console.log('\n[5v] Shield 3 — idle auto-logout')

// [6] logged out and this is the last section, so re-authenticate first — the
// idle guard only runs inside a live admin shell.
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await signInAdmin(page)
await page.waitForTimeout(700)

// Shorten the idle window before the admin shell mounts.
await page.evaluate(() => localStorage.setItem('adminIdleMs', '10000'))
await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// Still signed in immediately after load — the override must not fire on mount.
check('still signed in right after load (no premature logout)', await page.locator('input[aria-label="Email"]').count(), 0)

// Go idle. No clicks/keys/scrolls for longer than the 10s window.
let toastSeen = false
let gateSeen = false
for (let i = 0; i < 100; i++) {
  await page.waitForTimeout(250)
  if (!toastSeen && (await page.getByText('长时间没有操作，已自动退出').count()) > 0) toastSeen = true
  if ((await page.locator('input[aria-label="Email"]').count()) > 0) {
    gateSeen = true
    break
  }
}
check('a "Session expired" toast was shown', toastSeen, true)
check('the login gate returns after inactivity', gateSeen, true)


/* ── 5ad. Batch ops ────────────────────────────────────────────────────────
 * The flow this section exists for: paste a list of 货号 → Select all → one
 * batch action. Select-all reads `visible`, which is the filtered set, so the
 * two assertions that matter are "the bar says 2" and "the write landed on
 * exactly those two".
 *
 * The deal write is undone in a `finally`. The category and badge dialogs are
 * only opened, not applied: both create rows that a crash could leave behind,
 * and the deal path already proves the builder + writer work end to end. */
console.log('\n[5ad] Batch ops — pasted list, Select all, deal / category / badge')

{
  await page.setViewportSize({ width: 1440, height: 1000 })
  /* [5v]/[5w] leave the session expired and the login gate on screen. A hash
   * navigation would not remount the app, so reload: that guarantees the gate
   * is freshly rendered and `signInAdmin` has a form to fill. */
  await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await signInAdmin(page)
  await page.waitForTimeout(2200)
  if ((await page.getByPlaceholder(/搜索货号/).count()) === 0) {
    await page.goto(`${BASE}/#/admin/products`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
  }

  const { data: picks } = await db
    .from('products')
    .select('id, sku, sale_start, sale_end, sale_price, original_price, discount_label')
    .not('specs', 'is', null)
    .order('sort_order')
    .limit(2)

  try {
    check('two products to work on', picks.length, 2)

    await page.getByPlaceholder(/搜索货号/).fill(picks.map((p) => p.sku).join(' '))
    await page.waitForTimeout(1200)
    await page.getByLabel('Select all products on this screen').check()
    await page.waitForTimeout(400)
    check(
      'the pasted list narrowed to two rows',
      await page.getByLabel(/^Edit /).count(),
      2,
    )
    check(
      'the batch bar carries the three edit actions',
      (await page.getByRole('button', { name: '批量改角标' }).count()) +
        (await page.getByRole('button', { name: '批量改秒杀' }).count()) +
        (await page.getByRole('button', { name: '批量改分类' }).count()),
      3,
    )

    /* ── deal ── */
    await page.getByRole('button', { name: '批量改秒杀' }).click()
    await page.waitForTimeout(300)
    check(
      'Select all took the pasted list, not the catalogue',
      (await page.locator('[role="dialog"]').innerText()).includes('2 件商品'),
      true,
    )
    await page.getByLabel('Batch original price').fill('49.99')
    await page.getByLabel('Batch sale price').fill('29.99')
    await page.getByLabel('Batch sale start').fill('2026-11-27')
    await page.getByLabel('Batch sale end').fill('2026-11-30')
    await page.waitForTimeout(300)
    const dealDialog = page.locator('[role="dialog"]')
    check(
      'the preview shows the completed day boundaries',
      (await dealDialog.innerText()).includes('2026-11-30T23:59:59'),
      true,
    )
    await dealDialog.getByRole('button', { name: /^应用到 2 件/ }).click()
    await page.waitForTimeout(2200)
    check('the dialog closes itself', await page.locator('[role="dialog"]').count(), 0)

    const { data: after } = await db
      .from('products')
      .select('sku, sale_start, sale_end, sale_price')
      .in('id', picks.map((p) => p.id))
    check(
      'both rows got the same window',
      after.every(
        (row) => row.sale_start === '2026-11-27T00:00:00' && row.sale_end === '2026-11-30T23:59:59',
      ),
      true,
    )
    check('and the sale price', after.every((row) => row.sale_price === '29.99'), true)

    /* ── category ── */
    await page.getByLabel('Select all products on this screen').check()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '批量改分类' }).click()
    await page.waitForTimeout(300)
    const catDialog = page.locator('[role="dialog"]')
    const catText = await catDialog.innerText()
    check('category offers overwrite', catText.includes('全部覆盖'), true)
    check('and "only fill uncategorised"', catText.includes('只补没有分类的'), true)
    check('a new name can be created', catText.includes('新建分类'), true)
    await catDialog.getByRole('button', { name: '取消' }).click()
    await page.waitForTimeout(300)

    /* ── badge, with the optional secondary column ── */
    await page.getByRole('button', { name: '批量改角标' }).click()
    await page.waitForTimeout(300)
    const badgeDialog = page.locator('[role="dialog"]')
    check(
      'the secondary badge is opt-in',
      await page.getByLabel('Batch secondary badge text').count(),
      0,
    )
    await page.getByLabel('Also update secondary badge').check()
    await page.waitForTimeout(250)
    check(
      'ticking it reveals the field',
      await page.getByLabel('Batch secondary badge text').count(),
      1,
    )
    await page.getByLabel('Batch secondary badge text').fill('Black Friday')
    await page.waitForTimeout(250)
    /* 11-*.sql 是可选的迁移。库里有 sub_tag 时"只改副角标"应该可提交；没有时
     * 输入框仍然存在，但必须**明说存不进去**并禁用提交 —— 两种都是正确答案，
     * 所以这里断言"行为和列状态一致"，而不是死写一个值。 */
    const subMissing = (await badgeDialog.innerText()).includes('sub_tag 列不存在')
    check(
      subMissing
        ? 'a missing sub_tag column is called out instead of pretending to save'
        : 'a secondary-only update is applicable',
      subMissing
        ? await badgeDialog.getByRole('button', { name: /^应用到 2 件/ }).isDisabled()
        : !(await badgeDialog.getByRole('button', { name: /^应用到 2 件/ }).isDisabled()),
      true,
    )
    await badgeDialog.getByRole('button', { name: '取消' }).click()
    await page.waitForTimeout(300)

    /* ── ⚡ Deal Items：一个伪分类，不是真分类 ──
     * 秒杀状态是算出来的，分类下拉里本来没有它 —— 这就是运营以前只能把
     * 100 个货号贴进搜索框的原因。 */
    await page.getByPlaceholder(/搜索货号/).fill('')
    await page.waitForTimeout(400)
    const categoryFilter = page.getByLabel('Filter by category')
    check(
      'the dropdown offers a Deal Items view',
      (await categoryFilter.innerText()).includes('秒杀商品'),
      true,
    )
    await categoryFilter.selectOption(DEAL_ITEMS)
    await page.waitForTimeout(700)
    /* 库里可能有运营真在跑的活动（黑五可以提前一周排期），所以"恰好 2 件"
     * 会随业务数据漂移。改成和数据库现算的同一个数字比：这既证明了筛选器
     * 的规则，又不依赖目录里此刻有多少活动。 */
    const { data: dealRowsAll } = await db
      .from('products')
      .select('id, sale_start, sale_end')
    const nowMs = Date.now()
    const liveDealCount = (dealRowsAll || []).filter(
      (row) =>
        row.sale_start &&
        row.sale_end &&
        new Date(row.sale_end).getTime() > nowMs,
    ).length
    check(
      'it lists every product inside a deal window right now',
      await page.getByLabel(/^Edit /).count(),
      liveDealCount,
    )
    check('and the two just written are among them', liveDealCount >= 2, true)
    await categoryFilter.selectOption('All')
    await page.waitForTimeout(400)
  } finally {
    /* Put the two windows back the way they were found. This client is signed
     * in as an admin, so RLS lets the update through (an anon client would
     * silently affect zero rows and leave the deal behind). */
    for (const row of picks) {
      await db
        .from('products')
        .update({
          sale_start: row.sale_start,
          sale_end: row.sale_end,
          sale_price: row.sale_price,
          original_price: row.original_price,
          discount_label: row.discount_label,
        })
        .eq('id', row.id)
    }
    const { data: leaked } = await db
      .from('products')
      .select('sku')
      .in('id', picks.map((p) => p.id))
      .not('sale_start', 'is', null)
    const stillSet = (leaked || []).filter((row) => {
      const original = picks.find((p) => p.sku === row.sku)
      return original && original.sale_start === null
    })
    check('cleanup restored both windows', stillSet.length, 0)

    /* Never let cleanup mask the real failure: if the page already navigated
     * away, this fill throws and the original error disappears. */
    await page
      .getByPlaceholder(/搜索货号/)
      .fill('')
      .catch(() => {})
    await page.waitForTimeout(300)
  }
}


/* ── 5y. Onboarding guide ──────────────────────────────────────────────────
 * A fresh context, because that is the only honest way to test "first visit":
 * every other section installs `skipGuide` before navigating. The red line in
 * the brief is the scroll lock — a guide that leaves `overflow: hidden` behind
 * makes the grid un-scrollable and the site look broken, so that is asserted
 * on every close path, not just the happy one. */
console.log('\n[5y] Onboarding guide — first visit, five steps, and the scroll lock')

const guideCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const guidePage = await guideCtx.newPage()
const guideDialog = guidePage.locator('[role="dialog"][aria-labelledby="guide-title"]')
const guideButton = (name) => guidePage.getByRole('button', { name, exact: true })
const bodyOverflow = () => guidePage.evaluate(() => document.body.style.overflow)

try {
  await guidePage.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await guidePage.waitForSelector('article', { timeout: 25000 })
  await guideDialog.waitFor({ state: 'visible', timeout: 15000 })

  check('the guide opens by itself on a first visit', await guideDialog.count(), 1)
  check('step 1 is the first one', await guideDialog.getByRole('heading').innerText(), 'Select Category')
  check(
    'with its copy',
    (await guideDialog.innerText()).includes('Select a category to find the items you want.'),
    true,
  )
  check('the counter starts at 01 / 05', (await guideDialog.innerText()).includes('01 / 05'), true)
  check('there is no Back on the first step', await guideButton('Back').count(), 0)
  check('the lock is on while it is open', await bodyOverflow(), 'hidden')

  /* The card has to fit a 390×844 phone without scrolling — a guide that needs
   * a scroll to reach "Next" is worse than no guide. */
  const cardBox = await guidePage.locator('[aria-labelledby="guide-title"] > div').last().boundingBox()
  check('the card fits the viewport height', cardBox.height <= 844, true)
  check('and does not overflow horizontally', cardBox.width <= 390, true)

  await guideButton('Next').click()
  await guidePage.waitForTimeout(220)
  check('step 2', await guideDialog.getByRole('heading').innerText(), 'Choose Pieces & View Spec')
  check('the counter moved to 02', (await guideDialog.innerText()).includes('02 / 05'), true)
  check('Back appears from step 2', await guideButton('Back').count(), 1)

  await guideButton('Back').click()
  await guidePage.waitForTimeout(220)
  check('Back returns to step 1', (await guideDialog.innerText()).includes('Select Category'), true)

  for (const title of [
    'Select Category',
    'Choose Pieces & View Spec',
    'Size, Color & Selection',
    'Review and Generate Code',
  ]) {
    check(`reached "${title}"`, await guideDialog.getByRole('heading').innerText(), title)
    await guideButton('Next').click()
    await guidePage.waitForTimeout(200)
  }
  check('step 5', await guideDialog.getByRole('heading').innerText(), 'Copy and Send Code')
  check('the last step says Got it', await guideButton('Got it').count(), 1)

  await guideButton('Got it').click()
  await guidePage.waitForTimeout(400)
  check('Got it closes the guide', await guideDialog.count(), 0)
  check('the scroll lock is released', await bodyOverflow(), '')
  check(
    'and the visit is remembered',
    await guidePage.evaluate((key) => localStorage.getItem(key), GUIDE_SEEN_KEY),
    GUIDE_SEEN_VALUE,
  )

  await guidePage.reload({ waitUntil: 'networkidle' })
  await guidePage.waitForSelector('article', { timeout: 20000 })
  await guidePage.waitForTimeout(1800)
  check('a second visit does not auto-open it', await guideDialog.count(), 0)
  check('the page scrolls normally again', await guidePage.evaluate(() => document.body.style.overflow), '')

  /* The permanent entry point. */
  await guidePage.getByRole('button', { name: 'How it works' }).click()
  await guideDialog.waitFor({ state: 'visible', timeout: 8000 })
  check('? reopens it', await guideDialog.count(), 1)
  check('at step 1, not where it left off', (await guideDialog.innerText()).includes('01 / 05'), true)
  check('and locks the page again', await bodyOverflow(), 'hidden')

  await guidePage.keyboard.press('Escape')
  await guidePage.waitForTimeout(400)
  check('Esc closes it', await guideDialog.count(), 0)
  check('and releases the lock', await bodyOverflow(), '')

  /* Skip is the third close path and must behave like the other two. */
  await guidePage.getByRole('button', { name: 'How it works' }).click()
  await guideDialog.waitFor({ state: 'visible', timeout: 8000 })
  await guideButton('Skip').click()
  await guidePage.waitForTimeout(400)
  check('Skip closes it', await guideDialog.count(), 0)
  check('Skip releases the lock too', await bodyOverflow(), '')

  /* Overlay click is the fourth. Clicked near the corner so it lands on the
   * backdrop rather than the card. */
  await guidePage.getByRole('button', { name: 'How it works' }).click()
  await guideDialog.waitFor({ state: 'visible', timeout: 8000 })
  await guidePage.mouse.click(12, 12)
  await guidePage.waitForTimeout(400)
  check('a backdrop click closes it', await guideDialog.count(), 0)
  check('and still no lock', await bodyOverflow(), '')
} finally {
  await guideCtx.close()
}

await browser.close()

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
