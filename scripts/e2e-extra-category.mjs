import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))

const snapshot = async (label) => {
  const { data: product } = await db.from('products').select('id, category').eq('sku', 'C8P407').maybeSingle()
  const { data: rows } = await db.from('product_categories').select('category').eq('product_id', product?.id || '')
  console.log(`${label}: 主分类=${product?.category} 额外=${(rows || []).map((r) => r.category)}`)
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const s = m.text()
  if (s.includes('[extras-save]')) logs.push(s)
})

await page.goto('http://localhost:5199/#/admin', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
if (await page.locator('text=Admin access').count()) {
  await page.locator('input[type="email"]').fill(pick('SUPABASE_ADMIN_EMAIL'))
  await page.locator('input[type="password"]').fill(pick('SUPABASE_ADMIN_PASSWORD'))
  await page.locator('button', { hasText: /Sign in/ }).first().click()
  await page.waitForTimeout(3500)
}

await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('input[placeholder*="搜索货号"]').first().fill('C8P407')
await page.waitForTimeout(1500)

await page.locator('button[aria-label^="Edit Color Block"]').first().click()
await page.waitForTimeout(2500)

/* 打开添加器并列出可选项 */
await page.locator('button[aria-label="添加额外分类"]').first().click()
await page.waitForTimeout(500)

const options = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim())
    .filter((t) => t && t.length < 30),
)
console.log('可见按钮文本（片段）:', options.slice(-25).join(' / '))

const striped = page.locator('button').filter({ hasText: /^Striped$/ }).first()
console.log('Striped 选项数量:', await striped.count())
if (await striped.count()) {
  await striped.click({ force: true })
  await page.waitForTimeout(500)
}

const t1 = await page.locator('body').innerText()
const i1 = t1.indexOf('同时归入')
console.log('选完后同时归入:', t1.slice(i1, i1 + 60).replace(/\n/g, ' | '))

await page.screenshot({ path: 'shots/e2e2-chips.png' })
await page.locator('button', { hasText: '保存修改' }).first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots/e2e2-saved.png' })
await browser.close()
await snapshot('保存后')
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
