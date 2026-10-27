import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { signInAdmin, ADMIN_EMAIL, ADMIN_PASSWORD } from './unlock.mjs'

const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
await db.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', m => { if (m.type() === 'error') console.log('  [err]', m.text().slice(0,140)) })
await page.goto('http://127.0.0.1:5178/#/admin/products', { waitUntil: 'networkidle' })
await signInAdmin(page)
await page.waitForSelector('text=Product library', { timeout: 20000 })
await page.waitForTimeout(1800)

console.log('rows before:', await page.locator('[aria-label$=" to top"]').count())
await page.getByRole('button', { name: 'View Sold Out' }).click()
await page.waitForTimeout(700)
const rows = await page.$$eval('[aria-label$=" to top"]', els => els.map(e => e.getAttribute('aria-label').replace(/^Move /,'').replace(/ to top$/,'')))
console.log('rows in sold-out view:', rows.length, rows.join(','))
console.log('chips:', await page.locator('text=Sold out').count())
const banner = await page.locator('text=/sold-out variant/').first().textContent()
console.log('banner:', banner.trim().replace(/\s+/g,' '))

/* export → clipboard */
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
await page.getByRole('button', { name: 'Export Sold Out List' }).click()
await page.waitForTimeout(600)
const text = await page.evaluate(() => navigator.clipboard.readText())
console.log('--- clipboard ---\n' + text + '\n--- end ---')

/* clear one mark, then restore it */
const chip = page.locator('button[aria-label*="back in stock"]').first()
const label = await chip.getAttribute('aria-label')
console.log('clicking:', label)
await chip.click()
await page.waitForTimeout(1800)
const { data } = await db.from('products').select('sold_out_variants').eq('sku', 'P9B053').single()
console.log('after clear:', JSON.stringify(data.sold_out_variants))

/* restore the original two marks */
await db.from('products').update({ sold_out_variants: ['Burgundy|XL','Red|S'] }).eq('sku', 'P9B053')
const { data: back } = await db.from('products').select('sold_out_variants').eq('sku', 'P9B053').single()
console.log('restored:', JSON.stringify(back.sold_out_variants))
await browser.close()
