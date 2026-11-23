import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env', 'utf8')
const pick = (key) => {
  const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim() : ''
}
const email = pick('SUPABASE_ADMIN_EMAIL')
const password = pick('SUPABASE_ADMIN_PASSWORD')

const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))

const readMembership = async () => {
  const { data } = await db.from('product_categories').select('category').eq('product_id', 'p362')
  return (data || []).map((row) => row.category)
}
const readPrimary = async () => {
  const { data } = await db.from('products').select('category').eq('id', 'p362').maybeSingle()
  return data?.category
}

console.log('测试前：主分类 =', await readPrimary(), '| 额外 =', await readMembership())

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource|JWT/i.test(text)) {
    errors.push(`console: ${text}`)
  }
})

/* 1. 登录 */
await page.goto('http://localhost:5199/#/admin', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
if (await page.locator('text=Admin access').count()) {
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button', { hasText: /Sign in/ }).first().click()
  await page.waitForTimeout(3000)
}
console.log('登录后页面:', (await page.locator('body').innerText()).slice(0, 40).replace(/\n/g, ' '))

/* 2. 打开商品库并搜索 M7D872 */
await page.goto('http://localhost:5199/#/admin/products', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const search = page.locator('input[placeholder*="搜索货号"]').first()
if (await search.count()) {
  await search.fill('M7D872')
  await page.waitForTimeout(1200)
}

/* 3. 打开编辑器 */
const card = page.locator('text=Striped Cardigan Sweater Vest').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(2500)
}
const dialogText = await page.locator('body').innerText()
console.log('编辑器里能看到 Striped 芯片:', dialogText.includes('Striped'))
await page.screenshot({ path: 'shots/e2e-editor.png' })

/* 4. 保存 */
const save = page.locator('button', { hasText: '保存修改' }).first()
if (await save.count()) {
  await save.click()
  await page.waitForTimeout(3000)
}
await page.screenshot({ path: 'shots/e2e-saved.png' })

await browser.close()

/* 5. 数据库核对 */
const afterPrimary = await readPrimary()
const afterExtra = await readMembership()
console.log('保存后：主分类 =', afterPrimary, '| 额外 =', afterExtra)
console.log('结论：额外分类仍在 =', afterExtra.includes('Striped'))

/* 6. 前台核对 */
const browser2 = await chromium.launch({ executablePath: EDGE, headless: true })
const page2 = await browser2.newPage({ viewport: { width: 1440, height: 900 } })
await page2.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page2.waitForTimeout(1500)
const skip = page2.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
  await page2.waitForTimeout(300)
}
await page2.getByRole('button', { name: 'Shop', exact: true }).first().hover()
await page2.waitForTimeout(500)
await page2.evaluate(() => {
  const btns = [...document.querySelectorAll('.nav-drop button')]
  btns.find((b) => b.textContent.trim().startsWith('Trending'))?.click()
})
await page2.waitForTimeout(500)
const panel = await page2.locator('.nav-drop').first().innerText()
console.log('前台 Trending 内容:', panel.replace(/\n+/g, ' | ').slice(panel.indexOf('TRENDING'), panel.length))
await page2.screenshot({ path: 'shots/e2e-front.png' })
await browser2.close()

console.log('errors:', errors.length ? errors.join('\n') : 'none')
