import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

import { decodeCode, generateCode, MAX_QTY, CODE_PREFIX } from './utils/code.js'
import { getProducts, loadProducts } from './store/productStore.js'
import { getCategories, loadCategories } from './utils/categoryStore.js'
import { getSettings, loadSettings } from './utils/settingsStore.js'
import { loadAsins, getAsinsStatus } from './utils/asinStore.js'
import { loadLinks } from './store/linkStore.js'
import { bootstrapAuth, getAuthState, subscribeAuth } from './lib/auth.js'
import { startRealtime } from './lib/realtime.js'
import { isConfigured } from './lib/supabase.js'

/**
 * Developer surface
 * ──────────────────
 *   SAODIMALLSU.decode('sdm-xxxxx')    → full object with items + quantities
 *   SAODIMALLSU.encode('luna', {p001: 2}) → { code, payload }
 *   SAODIMALLSU.products()                → the catalogue currently in memory
 *   SAODIMALLSU.refresh()                 → re-fetch from Supabase, returns a promise
 *   SAODIMALLSU.codePrefix                → this deployment's brand prefix
 *
 * The prefix is per brand (`CODE_PREFIX` in utils/code.js). Second brand's
 * codes are rejected rather than decoded — both schemas use ids like `p034`,
 * so a foreign code resolves to a plausible but completely wrong order.
 *
 * The decoder is synchronous because it works on the in-memory cache. In a cold
 * console, `await SAODIMALLSU.refresh()` first — otherwise the catalogue is empty and
 * every line decodes as "removed".
 *
 * `window.MAKO` is kept as an alias for one release: the name predates the
 * Aoysky rebrand, and a few saved snippets still reach for it. Delete the alias
 * once nobody asks for it.
 */
window.SAODIMALLSU = {
  decode: decodeCode,
  encode: generateCode,
  products: getProducts,
  /* The ordered list the storefront rail renders. Exposed for the same reason
   * as `products()`: it is the only way to assert "the rail follows the admin's
   * order" without scraping the DOM. */
  categories: getCategories,
  /* 站点设置（目前就是秒杀专区的展示名）。前台 Tab 读它，smoke 也用它来断言
   * "Tab 上写的正是设置里那个名字"，而不是写死一个字符串。 */
  settings: getSettings,
  refresh: async () => {
    await Promise.all([
      loadProducts(),
      loadCategories(),
      loadAsins(),
      loadLinks(),
      loadSettings(),
    ])
    return getProducts()
  },
  maxQty: MAX_QTY,
  /* 当前部署的品牌前缀。粘错品牌时控制台能立刻确认"该生成哪个前缀"，
   * 冒烟脚本也用它构造示例，而不是再写死一遍字符串。 */
  codePrefix: CODE_PREFIX,
  configured: isConfigured,
}
window.MAKO = window.SAODIMALLSU

/**
 * Boot order matters, but not the way it used to.
 *
 * The old sequence was: resolve the session → then fetch → then open realtime,
 * one after another. That put two round trips in front of the first product.
 * On a bad phone connection a round trip is ~400 ms at best, and `getSession()`
 * can itself turn into a token refresh, so the grid started late for no reason:
 * the catalogue only needs the anon key.
 *
 * Now:
 *   1. catalogue + categories + links start immediately (anon-readable)
 *   2. the session resolves alongside them — it only gates the admin UI
 *   3. realtime opens after the first paint (it is a socket + 3 subscriptions,
 *      nothing on screen waits for it)
 */
async function bootstrap() {
  const catalogue = Promise.allSettled([
    loadProducts(),
    loadCategories(),
    loadLinks(),
    loadSettings(),
  ])

  try {
    await bootstrapAuth()
  } catch {
    /* Supabase unreachable — the UI still renders, just with an empty catalogue */
  }

  /* `asins` is readable only by an allowlisted admin (supabase/01-schema.sql).
   * An anonymous creator asking for it can only ever get an empty array back,
   * so the request used to be a guaranteed-useless round trip on every visit.
   * Load it when there is a session, and again whenever one appears. */
  const loadAsinsForStaff = (state) => {
    if (!state?.user) return
    loadAsins({ silent: getAsinsStatus() !== 'idle' }).catch(() => {})
  }
  if (getAuthState().user) loadAsins().catch(() => {})
  subscribeAuth(loadAsinsForStaff)

  await catalogue
  scheduleRealtime()
}

/**
 * Realtime: one websocket, three tables, one refetch per burst.
 * Nothing above the fold depends on it, so it waits for the main thread to go
 * quiet — with a hard deadline, because a phone that never idles would
 * otherwise never receive live updates.
 */
function scheduleRealtime() {
  const start = () =>
    startRealtime().catch((err) => console.warn('[mako] realtime failed', err))

  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 2500 })
  else setTimeout(start, 1500)
}

bootstrap()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
