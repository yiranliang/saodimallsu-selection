import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const errors = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/scripts/preview-admin.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(1600)

/* 设置：草稿布局 */
await page.locator('button', { hasText: '设置' }).first().click()
await page.waitForTimeout(700)
console.log('菜单布局（草稿）:', await page.locator('text=菜单布局（草稿）').count())
console.log('保存布局按钮:', await page.locator('button', { hasText: /保存布局|已保存/ }).count())
await page.screenshot({ path: 'shots/admin-layout-draft.png' })

/* 拖动草稿里的分组顺序（点 ↓） */
const down = page.locator('button[aria-label^="下移分组"]').first()
if (await down.count()) {
  await down.click({ force: true })
  await page.waitForTimeout(300)
  console.log('保存布局变为可点:', await page.locator('button', { hasText: '保存布局' }).count())
}

/* 关掉弹窗，再看分类筛选的分组行 */
await page.locator('button[aria-label="关闭设置"]').first().click()
await page.waitForTimeout(400)

const cat = page.locator('button[aria-label="Filter by category"]').first()
await cat.click()
await page.waitForTimeout(400)
console.log('分组行（group:）:', await page.locator('button', { hasText: 'Tops' }).count())
await page.screenshot({ path: 'shots/admin-category-filter.png' })

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
