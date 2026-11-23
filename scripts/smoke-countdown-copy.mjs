import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 找一条"进行中、且剩余超过 1 天"的档期 */
const now = Date.now()
const { data: deals } = await db.from('deals').select('sku, sale_start, sale_end, sale_price').limit(200)
const live = (deals || []).find((d) => {
  const start = Date.parse(d.sale_start)
  const end = Date.parse(d.sale_end)
  return Number.isFinite(start) && Number.isFinite(end) && start < now && end > now + 86400000
})
if (!live) throw new Error('没有合适的进行中档期')
console.log('测试档期:', live.sku, live.sale_start, '→', live.sale_end)

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

/* 搜索该货号并打开详情 */
await page.locator('input[placeholder*="Search"]').first().fill(live.sku)
await page.waitForTimeout(1500)
await page.locator('img').nth(0).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shots/detail-countdown-copy.png' })

const text = await page.locator('body').innerText()
const hit = text.split('\n').find((line) => /Discount ends in|days left|Deal ends in/.test(line))
console.log('倒计时文案:', hit)
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
