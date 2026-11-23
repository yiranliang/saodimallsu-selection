import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  const text = m.text()
  if (m.type() === 'error' && !/favicon|Failed to load resource|Supabase|JWT|fetch/i.test(text)) {
    errors.push(`console: ${text}`)
  }
})

await page.goto('http://localhost:5199/scripts/preview-admin.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

console.log('商品库:', await page.locator('text=商品库').count())

const settings = page.locator('button', { hasText: '设置' }).first()
if (await settings.count()) {
  await settings.click()
  await page.waitForTimeout(700)
  console.log('设置弹窗:', await page.locator('text=一级分组').count())
  console.log('分类行下拉(InlineSelect):', await page.locator('button[aria-haspopup="true"][aria-label*="一级分组"]').count())
  await page.screenshot({ path: 'shots/admin-groups.png' })

  /* 打开一个分类的分组下拉，验证自定义面板 */
  const firstSelect = page.locator('button[aria-label*="一级分组"]').first()
  if (await firstSelect.count()) {
    await firstSelect.click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'shots/admin-groups-open.png' })
  }
}

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
