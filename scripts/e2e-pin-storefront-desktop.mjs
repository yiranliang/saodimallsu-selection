import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const skip = page.locator('text=Skip')
if (await skip.count()) {
  await skip.first().click()
}

/* 等目录真的加载出来（首张卡片出现） */
await page.locator('text=View on Amazon').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(800)

const firstTitle = async () => {
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('h3, h2')].map((el) => el.textContent.trim()).filter((t) => t.length > 8),
  )
  return titles[0] || '(none)'
}

console.log('All products 第一件:', await firstTitle())

await page.getByRole('button', { name: 'Shop', exact: true }).first().hover()
await page.waitForTimeout(700)

/* 左栏 Tops → 右栏 Pullover */
const clicked = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')]
  const group = buttons.find((el) => el.textContent.replace(/\s+/g, ' ').trim().startsWith('Tops'))
  if (group) group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return Boolean(group)
})
console.log('找到 Tops 分组:', clicked)
await page.waitForTimeout(700)

const hit = await page.evaluate(() => {
  const target = [...document.querySelectorAll('button')].find(
    (el) =>
      el.textContent.replace(/\s+/g, ' ').trim().startsWith('Pullover') &&
      el.getBoundingClientRect().width > 0,
  )
  if (!target) return false
  target.click()
  return true
})
console.log('点击 Pullover:', hit)
await page.waitForTimeout(2000)
console.log('Pullover 第一件:', await firstTitle())
await page.screenshot({ path: 'shots/pin-storefront.png' })

/* 回 All products 验证不受影响 */
await page.getByRole('button', { name: 'Shop', exact: true }).first().hover()
await page.waitForTimeout(600)
await page.evaluate(() => {
  const back = [...document.querySelectorAll('button')].find((el) =>
    el.textContent.replace(/\s+/g, ' ').trim().startsWith('All products'),
  )
  if (back) back.click()
})
await page.waitForTimeout(1500)
console.log('All products 第一件（应仍是原来那件）:', await firstTitle())
console.log('页面错误:', logs.length ? logs.join('\n') : 'none')
await browser.close()
