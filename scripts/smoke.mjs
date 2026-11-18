import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5199/'

const errors = []

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

async function shoot(hash, file, waitFor) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'networkidle' })
  if (waitFor) {
    await page.waitForTimeout(1200)
    const found = await page.locator(waitFor).count()
    console.log(`${hash}: selector ${waitFor} -> ${found}`)
  }
  await page.screenshot({ path: file, fullPage: false })
  console.log(`${hash}: screenshot -> ${file}`)
}

/* 1. 前台 */
await shoot('', 'shots/front.png', 'text=Sale')

/* 2. 后台登录页 */
await shoot('#/admin', 'shots/admin-gate.png', 'text=Admin access')

/* 3. 后台商品库（未登录时应停在登录页；有会话则直接进列表） */
await shoot('#/admin/products', 'shots/admin-products.png', null)

/* 4. 设置对话框：如果已经在后台，点「设置」 */
const inAdmin = await page.locator('text=商品库').count()
if (inAdmin > 0) {
  const btn = page.locator('button', { hasText: '设置' }).first()
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'shots/settings.png' })
    console.log('settings dialog screenshot -> shots/settings.png')
  }
} else {
  console.log('not signed in as admin — settings dialog not reachable headlessly')
}

await browser.close()

console.log('\n=== console/page errors ===')
if (!errors.length) console.log('none')
else errors.forEach((e) => console.log(e))
process.exitCode = errors.length ? 1 : 0
