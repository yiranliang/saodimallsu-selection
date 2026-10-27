/**
 * Shared test helper — sign in to the admin console.
 *
 * The gate is Supabase Auth now, so the tests need a real account. Credentials
 * come from `.env` (the same file the import script uses), which keeps them out
 * of the repo. If they are missing, the browser suites skip instead of failing.
 *
 * Requires a confirmed user that is listed in `public.admin_users`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile() {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fileEnv = loadEnvFile()

/** Parsed `.env` — handy for scripts that also need the Supabase URL / key. */
export const ENV = fileEnv

export const ADMIN_EMAIL = process.env.SUPABASE_ADMIN_EMAIL || fileEnv.SUPABASE_ADMIN_EMAIL || ''
export const ADMIN_PASSWORD =
  process.env.SUPABASE_ADMIN_PASSWORD || fileEnv.SUPABASE_ADMIN_PASSWORD || ''

export function hasAdminCredentials() {
  return Boolean(ADMIN_EMAIL && ADMIN_PASSWORD)
}

/**
 * Fills the gate if it is showing. Safe to call when already signed in — it
 * simply reports false and does nothing.
 *
 * The retry is not cosmetic: right after a rejected attempt the form is still
 * `busy` for a moment, and a click landing on the disabled button is silently
 * swallowed. Retrying is only allowed when the message is NOT a credential
 * rejection, so a genuinely wrong password still fails on the first try instead
 * of burning three attempts against the rate limit.
 */
export async function signInAdmin(page) {
  const emailField = page.locator('input[aria-label="Email"]')
  if ((await emailField.count()) === 0) return false

  if (!hasAdminCredentials()) {
    throw new Error(
      'SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD are missing from .env — ' +
        'the admin console cannot be unlocked in tests without them.',
    )
  }

  const passwordField = page.locator('input[aria-label="Password"]')
  const errorText = page.locator('#access-gate-error')
  let lastMessage = 'no message'

  for (let attempt = 1; attempt <= 3; attempt++) {
    await emailField.fill(ADMIN_EMAIL)
    await passwordField.fill(ADMIN_PASSWORD)
    /* 按钮文案是中文（后台已汉化），忙碌时变成"正在登录…"，所以只匹配前缀。
     * 英文原文也留着 —— 万一哪天把后台语言切回去，这个助手不用改。 */
    await page
      .getByRole('button', { name: /^(Sign(ing)? in|登录|正在登录)/ })
      .click({ timeout: 15000 })

    try {
      await emailField.waitFor({ state: 'detached', timeout: 15000 })
      return true
    } catch {
      lastMessage = await errorText.innerText().catch(() => 'no message')
      if (/wrong email or password|invalid|邮箱或密码|不正确/i.test(lastMessage)) break
      await page.waitForTimeout(1200)
    }
  }

  throw new Error(`sign-in failed: ${lastMessage.replace(/\s+/g, ' ').trim()}`)
}

/** Kept so the older suites keep working — same thing, new name. */
export const unlockAdmin = signInAdmin

/* ── onboarding guide ──────────────────────────────────────────────────────
 *
 * The storefront opens a 5-step guide on the first visit, decided by a
 * localStorage flag. Every Playwright context starts with EMPTY storage, so
 * without this the guide pops up over the grid in every browser test — and the
 * first thing those tests do is click the first product card, which the overlay
 * is covering. That failure looks like "the card disappeared", not like "a
 * modal is in the way", so it costs an hour to diagnose.
 *
 * Call it right after `newPage`, before any navigation: `addInitScript` runs
 * before page scripts on every navigation, so a later `page.reload()` keeps the
 * opt-out.
 *
 * `smoke-gate` deliberately does NOT use this for its `[5y]` section — that one
 * opens a fresh context to test the real first-visit flow.
 */
export const GUIDE_SEEN_KEY = 'mako_seen_guide_v1'
export const GUIDE_SEEN_VALUE = 'v1'

export async function skipGuide(page) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* private mode — the guide would show, and the test will say so */
      }
    },
    { key: GUIDE_SEEN_KEY, value: GUIDE_SEEN_VALUE },
  )
}
