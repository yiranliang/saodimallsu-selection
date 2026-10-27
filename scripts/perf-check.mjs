/**
 * Storefront performance probe
 * ════════════════════════════
 *
 * Run: node scripts/perf-check.mjs http://localhost:4173 [--delay-fonts] [--warm] [--json]
 *
 * Answers one question: how long does a creator on a bad phone wait before she
 * can see products, and what did she download to get there?
 *
 * Everything is measured under the same two constraints on every run, so the
 * numbers are comparable between commits:
 *   · network — Slow 4G (400 ms RTT, 400 kbit/s down)
 *   · CPU     — 4× slowdown (a mid-range Android, not a laptop)
 *
 * What it records
 *   fcp      first contentful paint — is the skeleton on screen?
 *   cards    first product card mounted (the grid has real data)
 *   images   first card image decoded (the thing the eye waits for)
 *   lcp      largest contentful paint
 *   bytes    total encoded bytes for THIS navigation, split images vs the rest
 *   requests count for this navigation
 *
 * `--delay-fonts` holds `fonts.googleapis.com` for 6 s. Not sabotage: it
 * reproduces a phone where Google Fonts is slow or unreachable, which is the
 * condition the storefront was reported to hang in.
 *
 * `--warm` measures the same page a second time in the same tab. That is the
 * repeat visit, and with the sessionStorage catalogue it is the one that should
 * feel instant.
 */

import { chromium } from 'playwright-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const args = process.argv.slice(2)
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:4173/'
const delayFonts = args.includes('--delay-fonts')
const warm = args.includes('--warm')
const asJson = args.includes('--json')

const browser = await chromium.launch({ executablePath: CHROME })

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()

/* ── what the page measures about itself (re-runs on every navigation) ── */
await page.addInitScript(() => {
  window.__perf = { firstCard: null, firstImage: null, lcp: null }

  const scan = () => {
    if (window.__perf.firstCard == null) {
      const card = document.querySelector('article')
      if (card) window.__perf.firstCard = performance.now()
    }
    if (window.__perf.firstImage == null) {
      const img = document.querySelector('article img')
      if (img && img.complete && img.naturalWidth > 0) window.__perf.firstImage = performance.now()
    }
  }

  const observer = new MutationObserver(scan)
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
  // A timer as well as the observer: an image decoding does not mutate the DOM.
  setInterval(scan, 100)

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) window.__perf.lcp = last.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    /* older engines — lcp stays null */
  }
})

/* ── throttle: same envelope on every run ── */
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 400,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
})
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

/* ── bytes per host, from the wire, not from JSON.stringify ── */
let inFlight = new Map()
let hosts = new Map()
let totalBytes = 0
let imageBytes = 0
let requestCount = 0

function resetCounters() {
  inFlight = new Map()
  hosts = new Map()
  totalBytes = 0
  imageBytes = 0
  requestCount = 0
}

cdp.on('Network.responseReceived', (event) => {
  const { requestId, response, type } = event
  let host = 'other'
  try {
    host = new URL(response.url).host
  } catch {
    /* data: URLs and the like */
  }
  inFlight.set(requestId, { host, type })
  requestCount++
})

cdp.on('Network.loadingFinished', (event) => {
  const meta = inFlight.get(event.requestId)
  if (!meta) return
  const size = event.encodedDataLength || 0
  totalBytes += size
  hosts.set(meta.host, (hosts.get(meta.host) || 0) + size)
  if (meta.type === 'Image') imageBytes += size
})

/* ── the simulated bad-network-to-Google condition ── */
if (delayFonts) {
  await page.route('**fonts.googleapis.com**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000))
    route.continue().catch(() => {})
  })
}

const kb = (n) => Math.round(n / 1024)

async function measure(label) {
  resetCounters()
  const started = Date.now()
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch {
    /* A page that never fires `load` is a result, not a crash. */
  }
  const loadMs = Date.now() - started

  await page
    .waitForFunction(() => window.__perf && window.__perf.firstCard != null, null, { timeout: 45000 })
    .catch(() => {})
  await page
    .waitForFunction(() => window.__perf && window.__perf.firstImage != null, null, { timeout: 45000 })
    .catch(() => {})
  await page.waitForTimeout(600)

  const metrics = await page.evaluate(() => {
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find((e) => e.name === 'first-contentful-paint')
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      firstCard: window.__perf.firstCard == null ? null : Math.round(window.__perf.firstCard),
      firstImage: window.__perf.firstImage == null ? null : Math.round(window.__perf.firstImage),
      lcp: window.__perf.lcp == null ? null : Math.round(window.__perf.lcp),
      cards: document.querySelectorAll('article').length,
      imgs: document.querySelectorAll('article img').length,
    }
  })

  return {
    label,
    ...metrics,
    loadMs,
    totalKB: kb(totalBytes),
    imageKB: kb(imageBytes),
    requests: requestCount,
    hosts: Object.fromEntries([...hosts.entries()].sort((a, b) => b[1] - a[1]).map(([h, b]) => [h, kb(b)])),
  }
}

const runs = [await measure(warm ? 'cold' : 'run')]
if (warm) runs.push(await measure('warm'))

if (asJson) {
  console.log(JSON.stringify({ url, delayFonts, runs }, null, 2))
} else {
  for (const run of runs) {
    console.log(
      `\n${run.label} · ${url}${delayFonts ? '  (fonts.googleapis.com +6 s)' : ''}  ·  Slow 4G / CPU 4×\n`,
    )
    const rows = [
      ['first contentful paint', run.fcp],
      ['first product card', run.firstCard],
      ['first card image', run.firstImage],
      ['largest contentful paint', run.lcp],
      ['dom content loaded', run.domContentLoaded],
      ['page load event', run.loadMs],
    ]
    for (const [label, value] of rows) {
      console.log(`  ${label.padEnd(26)} ${value == null ? '—' : `${value} ms`}`)
    }
    console.log(`  ${'bytes'.padEnd(26)} ${run.totalKB} kB  (images ${run.imageKB} kB)`)
    console.log(`  ${'requests'.padEnd(26)} ${run.requests}`)
    console.log(`  ${'cards / imgs in grid'.padEnd(26)} ${run.cards} / ${run.imgs}`)
    console.log('\n  by host (kB):')
    for (const [host, size] of Object.entries(run.hosts).slice(0, 8)) {
      console.log(`    ${host.padEnd(34)} ${size}`)
    }
  }
  console.log('')
}

await browser.close()
