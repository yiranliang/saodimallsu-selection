import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { generateCodeFromLines, decodeCode } from '../src/utils/code.js'
import { __setCatalogueForTests } from '../src/store/productStore.js'

const env = readFileSync('.env', 'utf8')
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const db = createClient(pick('VITE_SUPABASE_URL'), pick('VITE_SUPABASE_ANON_KEY'))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* 取两件真实商品，构造成 generateCode 需要的形状 */
const { data: rows } = await db
  .from('products')
  .select('id, sku, name, category, specs')
  .in('id', ['p020', 'p362'])

const catalogue = rows.map((row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  category: row.category,
  specs: row.specs || {},
  image: '',
}))
__setCatalogueForTests(catalogue)

const specsOf = (row) => {
  const specs = row.specs || {}
  const first = {}
  for (const [key, list] of Object.entries(specs)) {
    const values = Array.isArray(list) ? list : [list]
    if (values.length) first[key] = values[0]
  }
  return first
}

const generated = generateCodeFromLines('guest', [
  { productId: rows[0].id, qty: 1, specs: specsOf(rows[0]) },
  { productId: rows[1].id, qty: 2, specs: specsOf(rows[1]) },
])

console.log('新码:', generated.code)
console.log('段数:', generated.code.split('-')[1].split('.').length)
console.log('长度:', generated.code.length)

const back = decodeCode(generated.code)
console.log('解码 ok:', back.ok, '| 行数:', back.items?.length, '| ref:', JSON.stringify(back.ref))

/* 老码对照 */
const legacy = 'sdm-7.guest.s31Q,1Q,2L,2L,2L,2X,2X,2X,3K,3K,3K,43,43,6E,6E.n.JB3gQWTdrmNB02._.1xTsQ3.eqOCgLHw'
const legacyOut = decodeCode(legacy)
console.log('老码 ok:', legacyOut.ok, legacyOut.ok ? `| 行数: ${legacyOut.items.length}` : `| ${legacyOut.error}`)

/* 后台查询页截图 */
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/#/admin', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
if (await page.locator('text=Admin access').count()) {
  await page.locator('input[type="email"]').fill(pick('SUPABASE_ADMIN_EMAIL'))
  await page.locator('input[type="password"]').fill(pick('SUPABASE_ADMIN_PASSWORD'))
  await page.locator('button', { hasText: /Sign in/ }).first().click()
  await page.waitForTimeout(3500)
}

await page.waitForTimeout(1500)

/* 粘新码查询 */
await page.locator('input[placeholder*="粘贴选品码"]').fill(generated.code)
await page.locator('button', { hasText: '查询' }).first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/new-code-decode.png' })

const body = await page.locator('body').innerText()
console.log('查询页能看到商品:', body.includes(rows[0].sku), body.includes(rows[1].sku))

/* 老码解码截图 */
await page.locator('button', { hasText: '再查一个' }).first().click()
await page.waitForTimeout(800)
await page.locator('input[placeholder*="粘贴选品码"]').fill(legacy)
await page.locator('button', { hasText: '查询' }).first().click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/old-code-decode.png' })
console.log('老码解码截图 ok')

await browser.close()
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
