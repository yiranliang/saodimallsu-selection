import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const { data: pool } = await db
  .from('products')
  .select('id, sku, name, category, sort_order, category_pins')
  .eq('category', 'Pullover')
  .order('sort_order')
  .limit(20)

const target = pool.find((row) => Number(row.category_pins?.Pullover) > 0)
const unpinnedFirst = pool.find((row) => !(Number(row.category_pins?.Pullover) > 0))
console.log('置顶商品:', target?.sku, target?.category_pins)
console.log('未置顶时排第一的:', unpinnedFirst?.sku)

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 430, height: 940 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page.waitForTimeout(300)
}

/* 抽屉 → SHOP → Pullover */
await page.getByRole('button', { name: /menu|导航|打开/i }).first().click()
await page.waitForTimeout(500)
await page.locator('button', { hasText: 'Shop' }).last().click()
await page.waitForTimeout(400)
/* 展开 Tops 分组，再点 Pullover */
await page.locator('button', { hasText: 'Tops' }).last().click()
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'Pullover' }).last().click()
await page.waitForTimeout(1800)
await page.screenshot({ path: 'shots/pin-storefront.png' })

const names = await page.evaluate(() =>
  [...document.querySelectorAll('h3, h2')]
    .map((el) => el.textContent.trim())
    .filter((t) => t.length > 8)
    .slice(0, 4),
)
console.log('首屏前 4 个标题:', names)

const body = await page.locator('body').innerText()
const head = body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12)
console.log('页面开头:', head.join(' | '))
console.log('置顶商品是否排在最前:', names[0]?.includes(target.name.slice(0, 18)))
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
