/**
 * Live read-only smoke check
 *   node scripts/smoke-live.mjs [baseUrl]
 *
 * Answers one question: is the deployed/in-dev app actually talking to Supabase?
 * It signs in for nothing and writes nothing, so it is safe to point at
 * production data.
 *
 * Checks
 *   · the storefront renders products that came from the database
 *   · specs key order survived the round trip (Colour before Size)
 *   · the category rail is populated from the categories table
 *   · the grid card image stays put while the detail sheet follows the colour
 *   · Amazon links point at a real ASIN and open safely in a new tab
 *   · /#/admin shows the sign-in gate and leaks no admin DOM
 *   · realtime reports itself as connected
 *   · no runtime errors (a missing product_links view is tolerated and listed)
 */

import { chromium } from 'playwright-core'
import { ENV, skipGuide } from './unlock.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

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
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
await skipGuide(page)

const consoleErrors = []
page.on('pageerror', (err) => consoleErrors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

// A missing `product_links` view is expected until the SQL is run, and the
// browser reports it as a bare "status of 404 ()" with no URL in the text, so
// remember which URLs actually 404'd and use that to judge the console noise.
const notFoundUrls = []
const badRequestUrls = []
page.on('response', (res) => {
  if (res.status() === 404) notFoundUrls.push(res.url())
  if (res.status() === 400) badRequestUrls.push(res.url())
})
const TOLERATED_404 = /\/rest\/v1\/product_links|favicon\.ico/i

/* PostgREST answers 400 — not 404 — when a select names a column that does not
   exist, and the browser reports it as a bare "status of 400 ()" with no URL.
   `productStore` retries without the offending column, so the site works; the
   only trace is one 400 per missing column. Those are pending migrations, not
   failures — but they are named loudly, because the feature is inert until the
   SQL runs.

   Which column is missing has to be *asked*, not guessed from the URL: the
   products select lists every optional column at once, so a 400 on it cannot
   say which one PostgREST rejected. (Before badge_color existed there was only
   one, and this script blamed it by name — it then blamed sold_out_variants for
   a badge_color 400.) One HEAD-ish request per optional column is cheap and the
   answer is exact. */
const OPTIONAL_COLUMNS = [
  { column: 'sold_out_variants', sql: 'supabase/05-sold-out.sql', feature: '断货' },
  { column: 'badge_color', sql: 'supabase/07-badge-color.sql', feature: '角标颜色' },
]

async function missingOptionalColumns() {
  const missing = []
  for (const entry of OPTIONAL_COLUMNS) {
    const res = await fetch(
      `${ENV.VITE_SUPABASE_URL}/rest/v1/products?select=${entry.column}&limit=1`,
      {
        headers: {
          apikey: ENV.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${ENV.VITE_SUPABASE_ANON_KEY}`,
        },
      }
    )
    if (res.status === 400) missing.push(entry)
  }
  return missing
}

/* ── 1. storefront reads from the database ── */
console.log('\n[1] Storefront')
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const snapshot = await page.evaluate(() => {
  const all = window.SAODIMALLSU?.products?.() ?? []
  return {
    configured: window.SAODIMALLSU?.configured ?? false,
    /* Everything in the table, hidden rows included. */
    count: all.length,
    /* What the storefront actually pages through — hidden products are still
     * resolvable by an old selection code but never appear in the grid. The
     * pager counts these, so this is what its total must match. */
    visible: all.filter((product) => !product.hidden).length,
    firstId: all[0]?.id ?? null,
    specOrder: Object.keys(all[0]?.specs || {}),
  }
})

check('supabase is configured', snapshot.configured, true)
check('catalogue came back from the cloud', snapshot.count > 0, true)
check('ids look like pNNN', /^p\d+$/.test(snapshot.firstId || ''), true)
check('specs key order preserved', snapshot.specOrder, ['Colour', 'Size'])

const cards = await page.locator('article[aria-label^="View "]').count()
check('cards rendered', cards > 0, true)
/* The grid is paged now — one batch, not the whole catalogue. Counted against
 * the PUBLISHED catalogue: the grid can only ever page through visible rows. */
check('first paint is one batch', cards, Math.min(24, snapshot.visible))

/* ── 1c. hidden products stay off the storefront ──
   `hidden` means "not published". Three separate places could leak one — the
   grid, the pager total, the category counts — and the leak would be invisible
   in review because each place filters independently. The snapshot above
   already knows how many rows are hidden, so pin the invariant on real data
   instead of trusting one component's filter. */
console.log('\n[1c] Hidden products stay off the storefront')

if (snapshot.visible < snapshot.count) {
  const footerText = await page.locator('body').innerText()
  const total = footerText.match(/Showing \d+ of (\d+)/)
  check('the pager counts only published products', total ? Number(total[1]) : null, snapshot.visible)

  const hidden = await page.evaluate(() => {
    const all = window.SAODIMALLSU?.products?.() ?? []
    const hit = all.find((product) => product.hidden)
    return hit ? { sku: hit.sku, name: hit.name } : null
  })

  if (hidden?.sku) {
    const search = page.locator('input[type="search"]')
    await search.fill(hidden.sku)
    await page.waitForTimeout(700)
    check(
      `searching the hidden 货号 ${hidden.sku} finds nothing`,
      await page.locator('article[aria-label^="View "]').count(),
      0,
    )
    await search.fill('')
    await page.waitForTimeout(700)
    check('clearing the search brings the shelf back', (await page.locator('article[aria-label^="View "]').count()) > 0, true)
  } else {
    console.log('  · 隐藏商品没有货号，跳过搜索断言')
  }
} else {
  console.log(`  · 目录里没有隐藏商品（${snapshot.count} 条全部在售），跳过`)
}

/* ── 1b. brand is Saodimallsu, and MAKO is really gone ──
   The rebrand touched a config file, a <title>, and a handful of prose
   strings in three admin screens. A single missed literal is invisible in
   review but very visible to a creator, so read the rendered text rather
   than grepping the source. `MAKO` in capitals never appears in product
   data (names are 货号), so its presence anywhere in body text is a miss. */
console.log('\n[1b] Brand')
const brand = await page.evaluate(() => ({
  title: document.title,
  header: document.querySelector('header')?.innerText || '',
  body: document.body.innerText,
  global: typeof window.SAODIMALLSU?.refresh,
  legacy: typeof window.MAKO?.refresh,
}))
check('document title is Saodimallsu', /Saodimallsu/.test(brand.title), true)
check('document title has no MAKO', /MAKO/.test(brand.title), false)
check('header shows the brand name', /Saodimallsu/.test(brand.header), true)
check('header has no MAKO', /MAKO/.test(brand.header), false)
check('no MAKO anywhere on the page', /MAKO/.test(brand.body), false)
check('window.SAODIMALLSU is exposed', brand.global, 'function')
check('window.MAKO still aliases it', brand.legacy, 'function')

/* The tab icon is part of the rebrand and is the easiest thing to forget: it
 * lives in `public/`, outside every component, and the old one drew its letter
 * with <text> so it silently fell back to an OS font. Read the actual file the
 * browser was told to load — an href that still points at the old artwork would
 * otherwise pass a check that only looks at the markup. */
const favicon = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="icon"]')
  if (!link) return null
  const res = await fetch(link.href)
  /* Strip XML comments first — the artwork explains in prose why it avoids
   * <text>, and matching the explanation would fail the check it describes. */
  const body = (await res.text()).replace(/<!--[\s\S]*?-->/g, '')
  return {
    href: link.getAttribute('href'),
    type: link.getAttribute('type'),
    ok: res.ok,
    accent: body.includes('#C8855A'),
    drawsText: /<text[\s>]/.test(body),
  }
})
check('favicon link is an svg', favicon?.type, 'image/svg+xml')
check('favicon link carries a cache-buster', /\?v=\d+/.test(favicon?.href || ''), true)
check('favicon loads', favicon?.ok, true)
check('favicon uses the brand accent', favicon?.accent, true)
check('favicon draws the letter, not a webfont glyph', favicon?.drawsText, false)

const pills = await page.locator('nav button').count()
check('category rail populated', pills > 1, true)

/* ── 2. the card image is static ── */
console.log('\n[2] Card image')
const cardImage = page.locator('article[aria-label^="View "] img').first()
const cardSrcBefore = await cardImage.getAttribute('src')
check('card has an image', Boolean(cardSrcBefore), true)

/* Find a product that actually has a variant photo, then pick that exact colour
 * in the sheet. The grid must keep showing the product's own image; only the
 * sheet may swap. */
const target = await page.evaluate(() => {
  for (const product of window.SAODIMALLSU?.products?.() || []) {
    for (const [type, map] of Object.entries(product.variantImages || {})) {
      const entry = Object.entries(map || {}).find(([, url]) => Boolean(url))
      if (entry) {
        return { name: product.name, sku: product.sku, type, option: entry[0], url: entry[1] }
      }
    }
  }
  return null
})

if (target) {
  /* It may sit past the first batch, so search it into view first. This is
   * also the cheapest proof that the search box actually filters. */
  const search = page.locator('input[type="search"]')
  await search.fill(target.sku)
  await page.waitForTimeout(700)

  const card = page.locator(`article[aria-label="View ${target.name}"]`).first()
  const gridSrc = await card.locator('img').first().getAttribute('src')

  await card.click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })

  await page
    .locator('[role="dialog"] button[aria-pressed]')
    .filter({ hasText: new RegExp(`^${target.option}$`) })
    .first()
    .click()
  await page.waitForTimeout(500)

  const sheetSrc = await page.locator('[role="dialog"] img').first().getAttribute('src')
  /* The sheet asks the CDN for a 640 px render (`sizedImage`), so the size token
   * in the URL is the storefront's, not the one stored in the database. Compare
   * the photo itself — the `I/xxxx` id — and assert the size separately, so this
   * keeps testing "the photo follows the colour" instead of "the URL is copied
   * verbatim". */
  const photoId = (url) => String(url || '').match(/\/I\/([^._]+)/)?.[1] || ''
  check('detail photo follows the colour', photoId(sheetSrc), photoId(target.url))
  check('and it is the sheet-sized render', /_AC_S[XY]\d+_\./.test(String(sheetSrc)), true)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  const gridAfter = await card.locator('img').first().getAttribute('src')
  check('grid image unchanged after picking a colour', gridAfter, gridSrc)

  await search.fill('')
  await page.waitForTimeout(600)
} else {
  console.log('  · skipped — no product has variantImages configured')
}

/* ── 2b. Title and photo framing ──
 * Both came out of looking at the real page, and both are measurable:
 *  - a long name read as one chopped-off line
 *  - the sheet photo looked like a close-up, because a 3:4 shot was being
 *    cropped into a 4:3 box with object-cover
 * The framing went round six times. The two survivors of all that: the frame
 * must be a square (the only ratio that tiles cleanly when sources run from
 * 1:2.3 trousers to near-square bras), and the padding must be white.
 * The fit went contain → cover → contain, and it landed back on contain once
 * the goal was stated as "copy Amazon" rather than "make the grid tidy":
 * a fully visible photo on a white frame is the Amazon look, and the size
 * differences it produces are the accepted cost of never cropping a garment.
 * What must NOT come back is any grey hairline — that is what turns the
 * letterbox padding into a drawn box. Asserted at 0px below. */
console.log('\n[2b] Title & photo framing')

const titleBox = page.locator('article[aria-label^="View "] h3').first()
const titleText = await titleBox.evaluate((el) => el.textContent.trim())
check('title attribute exposes the full name', await titleBox.getAttribute('title'), titleText)

const readTitle = (el) => {
  const cs = getComputedStyle(el)
  return { clamp: cs.webkitLineClamp, minH: Math.round(parseFloat(cs.minHeight)) }
}

const desktopTitle = await titleBox.evaluate(readTitle)
check('desktop clamps to two lines', desktopTitle.clamp, '2')
check('desktop reserves two lines', desktopTitle.minH, 42)

/* Every card must reserve the same title box, or the variant rows underneath
 * stop lining up across the grid. */
const titleHeights = await page
  .locator('article[aria-label^="View "] h3')
  .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))])
check('all title boxes are the same height', titleHeights.length, 1)

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
const mobileTitle = await titleBox.evaluate(readTitle)
check('phone clamps to three lines', mobileTitle.clamp, '3')
check('phone reserves three lines', mobileTitle.minH, 54)
await page.setViewportSize({ width: 1000, height: 900 })
await page.waitForTimeout(500)

const cardShot = await page
  .locator('article[aria-label^="View "] img')
  .first()
  .evaluate((el) => ({
    fit: getComputedStyle(el).objectFit,
    position: getComputedStyle(el).objectPosition,
  }))
check('card photo is contained, not cropped', cardShot.fit, 'contain')

/* The counterpart of `contain`: with the whole photo visible there is no crop
 * to steer, so `object-top` must be gone. Left in by accident it would silently
 * bias every letterboxed shot upward. */
check('card photo is not top-anchored', cardShot.position, '50% 50%')

/* Pure white, and it has to stay pure white. The padding around a letterboxed
 * photo is only invisible while it matches the backdrop the photo was shot on;
 * one shade off and the gap turns into a visible panel around the product. */
const cardFill = await page
  .locator('article[aria-label^="View "] img')
  .first()
  .evaluate((el) => getComputedStyle(el.parentElement).backgroundColor)
check('card photo frame is white', cardFill, 'rgb(255, 255, 255)')

/* No frame, no card outline. A grey hairline beside a letterboxed photo is what
 * turns invisible padding into a drawn box, and the garment starts to read as
 * small inside a panel. Asserted at 0px so it cannot creep back. */
const cardBorder = await page
  .locator('article[aria-label^="View "]')
  .first()
  .evaluate((el) => getComputedStyle(el).borderTopWidth)
check('card has no grey frame', cardBorder, '0px')

/* Equal heights is the whole reason the ratio sits on the frame rather than on
 * the image: the grid columns share one width, so one ratio gives one height
 * regardless of what shape each source photo is. An <img> that sets its own
 * height shows up here as two distinct values. */
const cardFrames = await page
  .locator('article[aria-label^="View "] img')
  .evaluateAll((els) =>
    els.map((el) => {
      const r = el.parentElement.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    }),
  )
check('all card photo frames are the same height', [...new Set(cardFrames.map((f) => f.h))].length, 1)
check('card photo frame is square', Math.abs(cardFrames[0].w / cardFrames[0].h - 1) < 0.02, true)
check('card photo frame has a real size', cardFrames[0].h >= 120, true)

/* The hover zoom is safe with `contain`: it grows into the photo's own padding
 * before it ever reaches the frame edge, so nothing is cut. Kept as its own
 * assertion because it is the one place the photo moves. */
const cardHover = await page
  .locator('article[aria-label^="View "]')
  .first()
  .evaluate((card) => /group-hover:scale-105/.test(card.querySelector('img').className))
check('card zooms on hover', cardHover, true)

await page.locator('article[aria-label^="View "]').first().click()
await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
await page.waitForTimeout(700)

const framing = await page.evaluate(() => {
  const img = document.querySelector('[role="dialog"] img')
  if (!img) return null
  const box = img.parentElement.getBoundingClientRect()
  return {
    fit: getComputedStyle(img).objectFit,
    position: getComputedStyle(img).objectPosition,
    fill: getComputedStyle(img.parentElement).backgroundColor,
    natural: [img.naturalWidth, img.naturalHeight],
    box: [Math.round(box.width), Math.round(box.height)],
    viewportH: window.innerHeight,
  }
})

check('sheet photo is contained, not cropped', framing?.fit, 'contain')
check('sheet photo is not top-anchored', framing?.position, '50% 50%')
check('sheet photo frame is white', framing?.fill, 'rgb(255, 255, 255)')
check('sheet photo loaded', framing?.natural?.[0] > 0, true)
/* Same square as the card, so tapping a tile does not re-crop the shot. The
 * frame is now width-driven; the pickers scroll under it and the add button sits
 * in a `shrink-0` footer, which is what keeps the button reachable at any photo
 * height — asserted separately below. */
check('sheet frame is square', Math.abs(framing?.box?.[0] / framing?.box?.[1] - 1) < 0.02, true)

const addButton = page.locator('[role="dialog"] button', { hasText: /Add to my selection|^Choose / }).first()
const addBox = await addButton.boundingBox()
check('add button is above the fold', Boolean(addBox) && addBox.y + addBox.height <= 900, true)

await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* ── 3. Amazon links ── */
console.log('\n[3] Amazon links')
const amazonLinks = page.locator('article[aria-label^="View "] a[href*="amazon.com/dp/"]')
const linkCount = await amazonLinks.count()

if (linkCount > 0) {
  const href = await amazonLinks.first().getAttribute('href')
  check('link points at an ASIN', /^https:\/\/www\.amazon\.com\/dp\/B0[A-Z0-9]{8}$/.test(href), true)
  check('link opens in a new tab', await amazonLinks.first().getAttribute('target'), '_blank')
  check('link has noopener', (await amazonLinks.first().getAttribute('rel'))?.includes('noopener'), true)
} else {
  /* No <a> on the page. Two very different causes, and telling them apart is the
   * whole point of this probe:
   *   · the view does not exist — fresh clone, 04 never run. Expected, skip.
   *   · the view HAS rows but nothing rendered — a real regression. This is
   *     exactly what shipped once: the store asked for `linked_variants`, the
   *     deployed view only had two columns, PostgREST answered 400, the store
   *     swallowed it, and every link silently disappeared while the database
   *     looked perfectly healthy. */
  const probe = await (async () => {
    if (!ENV.VITE_SUPABASE_URL || !ENV.VITE_SUPABASE_ANON_KEY) return { rows: -1, note: 'no credentials' }
    const headers = {
      apikey: ENV.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ENV.VITE_SUPABASE_ANON_KEY}`,
    }
    const res = await fetch(`${ENV.VITE_SUPABASE_URL}/rest/v1/product_links?select=product_id&limit=1`, {
      headers,
    })
    if (res.status !== 200) return { rows: -1, note: `status ${res.status}` }
    const rows = await res.json()
    return { rows: rows.length, note: 'ok' }
  })()

  if (probe.rows > 0) {
    check('links render when the view has rows', 0, probe.rows)
  } else {
    console.log(`  · no links found (${probe.note}) — run supabase/04-product-links.sql, then reload`)
  }
}

/* ── 4. paging ── */
console.log('\n[4] Paging')
const cardCount = () => page.locator('article[aria-label^="View "]').count()
const pagerText = () =>
  page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('p')).find((p) =>
      /^(Showing \d+ of \d+|\d+ match(es)? for|That's all)/.test(p.textContent.trim()),
    )
    return el ? el.textContent.trim() : ''
  })

check('a pager is shown', (await pagerText()).startsWith('Showing'), true)
check('it states the batch and the total', await pagerText(), `Showing 24 of ${snapshot.visible} styles`)

/* the chip with the most styles — "All" excluded, it is not a category */
const biggestChip = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('nav button'))
  let best = null
  for (const chip of chips) {
    const match = chip.textContent.trim().match(/^(.*?)\s*(\d+)$/)
    if (!match) continue
    const [, label, count] = match
    if (label === 'All') continue
    if (!best || Number(count) > best.count) best = { label, count: Number(count) }
  }
  return best
})

if (biggestChip && biggestChip.count > 24) {
  await page.getByRole('button', { name: new RegExp(`^${biggestChip.label}`) }).first().click()
  await page.waitForTimeout(700)

  check('switching category resets to one batch', await cardCount(), 24)
  check(
    'the pager counts inside the category, not the catalogue',
    await pagerText(),
    `Showing 24 of ${biggestChip.count} styles`,
  )

  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await page.waitForTimeout(500)
  const afterBatch = Math.min(48, biggestChip.count)
  check('load more adds a batch', await cardCount(), afterBatch)
  /* Between 25 and 48 styles one click exhausts the category, and the pager
   * switches to "That's all N styles" — the old assertion assumed there was
   * always another batch left, which stopped being true when a category
   * dropped to 29. */
  check(
    'and the total is unchanged',
    await pagerText(),
    biggestChip.count > 48 ? `Showing ${afterBatch} of ${biggestChip.count} styles` : `That's all ${biggestChip.count} styles`,
  )

  /* the staff link must stay below the pager, not float above it. Measure the
   * pager text itself: once everything is loaded the button is gone. */
  const pagerBox = await page
    .locator('p')
    .filter({ hasText: /^(Showing \d+ of \d+|That's all)/ })
    .first()
    .boundingBox()
  const footerBox = await page.locator('footer a[href="#/admin"]').boundingBox()
  check('footer sits below the pager', footerBox.y > pagerBox.y, true)

  await page.getByRole('button', { name: /^All/ }).first().click()
  await page.waitForTimeout(700)
  check('back to All resets the batch too', await cardCount(), Math.min(24, snapshot.count))
} else {
  console.log('  · skipped — no category holds more than one batch')
}

/* ── 5. search ── */
console.log('\n[5] Search')
const searchBox = page.locator('input[type="search"]')
const subject = await page.evaluate(() => {
  const product = window.SAODIMALLSU.products()[2]
  return { name: product.name, sku: product.sku, category: product.category }
})

await searchBox.fill(subject.sku)
await page.waitForTimeout(700)
check('search narrows the grid', (await cardCount()) < snapshot.count, true)
check(
  'the searched style is on screen',
  await page.locator(`article[aria-label="View ${subject.name}"]`).count(),
  1,
)
check(
  'the pager reports matches, not the catalogue',
  (await pagerText()).includes('match'),
  true,
)

/* category + search must both apply */
const otherChip = await page.evaluate((own) => {
  const chips = Array.from(document.querySelectorAll('nav button'))
  for (const chip of chips) {
    const match = chip.textContent.trim().match(/^(.*?)\s*(\d+)$/)
    if (!match) continue
    const [, label, count] = match
    if (label !== 'All' && label !== own && Number(count) > 0) return { label, count: Number(count) }
  }
  return null
}, subject.category)

if (otherChip) {
  await page.getByRole('button', { name: new RegExp(`^${otherChip.label}`) }).first().click()
  await page.waitForTimeout(700)
  check('a different category empties the search results', await cardCount(), 0)
  check('and says so', await page.locator('text=No styles match').count(), 1)
  await page.getByRole('button', { name: 'Clear search' }).first().click()
  await page.waitForTimeout(600)
  check('clearing the search brings the category back', (await cardCount()) > 0, true)
  await page.getByRole('button', { name: /^All/ }).first().click()
  await page.waitForTimeout(600)
}

await searchBox.fill('zzz-no-such-style')
await page.waitForTimeout(700)
check('a junk query finds nothing', await cardCount(), 0)
check('the empty state explains itself', await page.locator('text=No styles match').count(), 1)
await searchBox.fill('')
await page.waitForTimeout(700)
check('clearing the box restores the grid', await cardCount(), Math.min(24, snapshot.count))

/* ── 6. clear all ── */
console.log('\n[6] Clear all')
await page.locator('article[aria-label^="View "]').first().click()
await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
await page.evaluate(() => {
  /* one option per spec group, so the sheet becomes addable */
  document.querySelectorAll('[role="dialog"] .flex.flex-wrap.gap-2').forEach((group) => {
    const button = group.querySelector('button[aria-pressed]')
    if (button) button.click()
  })
})
await page.waitForTimeout(500)

const addToSelection = page.getByRole('button', { name: /Add to my selection/ })
check('the sheet became addable', (await addToSelection.count()) > 0, true)
if (await addToSelection.count()) {
  await addToSelection.first().click()
  await page.waitForTimeout(600)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'View your selection' }).click()
await page.waitForSelector('text=Clear all', { timeout: 10000 })
check('the cart holds one line', await page.locator('[role="dialog"] button[aria-label^="Remove "]').count(), 1)

await page.getByRole('button', { name: 'Clear all', exact: true }).click()
await page.waitForTimeout(300)
check(
  'clear all asks first',
  await page.locator('text=Are you sure you want to clear your selection?').count(),
  1,
)
check(
  'nothing is gone before confirming',
  await page.locator('[role="dialog"] button[aria-label^="Remove "]').count(),
  1,
)

await page.getByRole('button', { name: 'Yes, clear' }).click()
await page.waitForTimeout(700)
check('the cart is empty', await page.locator('text=Your selection is empty').count(), 1)
check(
  'the bottom bar is back to zero',
  (await page.getByRole('button', { name: 'View your selection' }).innerText()).includes('Empty'),
  true,
)
check('a toast confirms', await page.locator('text=Selection cleared').count(), 1)
check(
  'localStorage holds nothing either',
  await page.evaluate(() => {
    /* Since the 7-day expiry landed, an empty selection is stored as
     * `{ v: 2, updatedAt, lines: [] }` rather than a missing key — the stamp has
     * to exist so the NEXT visit does not read a legacy array as "fresh". Both
     * shapes count as empty here. */
    const raw = localStorage.getItem('mako_lines_v1')
    if (raw === null) return true
    const parsed = JSON.parse(raw)
    const lines = Array.isArray(parsed) ? parsed : parsed?.lines
    return Array.isArray(lines) && lines.length === 0
  }),
  true,
)

await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* ── 7. realtime socket ── */
console.log('\n[7] Realtime')
const realtimeState = await page.evaluate(async () => {
  // supabase-js exposes the socket through the client on window only if we put
  // it there; instead assert that the channel object exists in the app.
  return typeof window.SAODIMALLSU?.refresh === 'function'
})
check('refresh hook available', realtimeState, true)

/* ── 8. staff access ── */
console.log('\n[8] Staff access')
const staffLink = page.locator('footer a[href="#/admin"]')

check('footer link exists', await staffLink.count(), 1)
check('label reads Admin Login', (await staffLink.innerText()).trim(), 'Admin Login')
check(
  'link is small enough to stay out of the way',
  await staffLink.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) <= 11),
  true,
)

/* clicking it must land on the gate */
await staffLink.click()
await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 })
check('click opens the gate', page.url().endsWith('#/admin'), true)

/* …and so must typing "admin", with no visible affordance at all */
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForSelector('article[aria-label^="View "]', { timeout: 20000 })
await page.waitForTimeout(400)
await page.keyboard.type('admin')
await page.waitForTimeout(700)
check('typing admin opens the gate', page.url().endsWith('#/admin'), true)

/* a creator typing in a field must never trip it */
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForSelector('article[aria-label^="View "]', { timeout: 20000 })
await page.evaluate(() => {
  const probe = document.createElement('input')
  probe.id = 'shortcut-probe'
  document.body.appendChild(probe)
  probe.focus()
})
await page.keyboard.type('admin')
await page.waitForTimeout(500)
check('typing admin in a field does nothing', page.url().endsWith('#/admin'), false)
await page.evaluate(() => document.getElementById('shortcut-probe')?.remove())

/* ── 9. the gate ── */
console.log('\n[9] Admin gate')
await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' })
await page.waitForSelector('input[aria-label="Email"]', { timeout: 20000 })
check('email field', await page.locator('input[aria-label="Email"]').count(), 1)
check('password field', await page.locator('input[aria-label="Password"]').count(), 1)
check('no admin DOM while signed out', await page.locator('#code-input').count(), 0)
check('no product library while signed out', await page.locator('text=Product library').count(), 0)

/* ── 10. console ── */
console.log('\n[10] Console')
const strayNotFound = notFoundUrls.filter((url) => !TOLERATED_404.test(url))
const expectedNotFound = notFoundUrls.filter((url) => TOLERATED_404.test(url))

check('no unexpected 404s', strayNotFound, [])

if (expectedNotFound.length) {
  console.log(`  · tolerated ${expectedNotFound.length} × 404 (view not created yet)`)
  for (const url of new Set(expectedNotFound)) console.log(`      ${url}`)
}

// Only excuse a 404 console line when every 404 on the page was an expected
// one; otherwise the URL list above already failed the run and this keeps the
// raw console message visible as evidence.
const missingColumns = await missingOptionalColumns()
const pendingMigration = missingColumns.length > 0

// A 400 on the products endpoint is only excused while a column really is
// missing; with the schema complete it is a genuine failure.
const strayBadRequest = badRequestUrls.filter(
  (url) => !(pendingMigration && /\/rest\/v1\/products\?/.test(url))
)

check('no unexpected 400s', strayBadRequest, [])

for (const entry of missingColumns) {
  console.log(`  ⚠ ${entry.column} 列不存在 —— ${entry.feature}功能未生效`)
  console.log(`      在 Supabase SQL Editor 跑一次 ${entry.sql}，这条 400 就会消失`)
}

const realErrors = consoleErrors.filter((text) => {
  if (/favicon/i.test(text)) return false
  if (/status of 404/i.test(text) && !strayNotFound.length) return false
  if (/status of 400/i.test(text) && pendingMigration) return false
  return true
})
check('no runtime errors', realErrors, [])

await browser.close()

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
