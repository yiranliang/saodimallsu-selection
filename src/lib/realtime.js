/**
 * Realtime
 * ────────
 * One channel, three tables, one refetch per burst.
 *
 * Why refetch instead of patching the payload into the cache:
 *   · an update can move a row's sort_order, so one event can invalidate the
 *     order of everything else
 *   · a burst (bulk hide, re-import) fires dozens of events; refetching once
 *     after 180 ms is cheaper and always consistent
 *   · 139 rows is ~0.04 MB, so the refetch is cheaper than the bug surface
 *
 * RLS applies to the subscriber, not the table: anon receives product and
 * category events because those policies allow anon SELECT. asins is
 * allowlist-only, so only a signed-in admin sees those — which is exactly the
 * intended split. A denied table does not error, it just stays silent, which
 * is why the channel is rebuilt whenever the session changes.
 *
 * The rebuild has to be serialised. `removeChannel` is async, and a second
 * `channel('mako-catalogue')` created before the first is gone joins a topic
 * that is already subscribed — the new handlers are dropped and the page goes
 * quietly deaf. Signing in triggers two `applySession` calls (one direct, one
 * from onAuthStateChange), so this race was not theoretical: the console would
 * stop receiving events while the storefront kept working. The generation
 * counter makes the last call win and the earlier one bail out.
 */

import { supabase } from './supabase.js'
import { applyProductEvent, isCatalogueLight, loadProducts } from '../store/productStore.js'
import { loadLinks } from '../store/linkStore.js'
import { loadCategories } from '../utils/categoryStore.js'
import { loadSettings } from '../utils/settingsStore.js'
import { loadAsins } from '../utils/asinStore.js'

const CHANNEL_NAME = 'mako-catalogue'
const DEBOUNCE_MS = 180

let channel = null
let generation = 0
let timer = null
const pending = new Set()
/* 每一条 products 事件都把整行带回来，所以正常情况下**不需要重拉目录**：
 * 把这一行打进缓存就够了（见 productStore 的 `applyProductEvent`）。攒起来是
 * 为了 burst（批量改 300 件）时按照到达顺序逐条应用，仍然只 notify 一次。 */
const productEvents = []

function schedule(table, payload) {
  if (table === 'products' && payload) productEvents.push(payload)
  pending.add(table)
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, DEBOUNCE_MS)
}

async function flush() {
  timer = null
  const tables = new Set(pending)
  pending.clear()
  const events = productEvents.splice(0, productEvents.length)

  try {
    if (tables.has('products')) {
      /* 局部更新优先。`applied` 为 false 有两种情况：没有任何 payload（例如
       * 重新订阅后的"补一次"），或者某条事件的形状我们不认识 —— 两种都退回
       * 一次全量刷新，宁可多一次请求也不能让界面停在错的顺序上。 */
      let applied = events.length > 0
      for (const event of events) {
        if (!applyProductEvent(event)) applied = false
      }
      if (!applied) await loadProducts({ silent: true, light: isCatalogueLight() })
      /* A product row carries the 货号, and the Amazon link is derived from it.
       * Refetching the link map keeps the storefront from pointing at the ASIN
       * of a 货号 that was just corrected. */
      await loadLinks({ silent: true })
    }
    if (tables.has('categories')) await loadCategories({ silent: true })
    /* 改名是给红人看的：已经打开着的页面要跟着换 Tab，不能等刷新。 */
    if (tables.has('settings')) await loadSettings({ silent: true })
    if (tables.has('asins')) {
      await loadAsins({ silent: true })
      await loadLinks({ silent: true })
    }
  } catch {
    /* Offline or the token expired — the next manual refresh catches up. */
  }
}

export async function startRealtime() {
  if (!supabase) return

  const myGeneration = ++generation

  const previous = channel
  channel = null
  if (previous) {
    await supabase.removeChannel(previous).catch(() => {})
    /* Someone called startRealtime again while we were awaiting — they own the
     * channel now, and creating a second one on the same topic would break it. */
    if (myGeneration !== generation) return
  }

  const next = supabase
    .channel(CHANNEL_NAME)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      (payload) => schedule('products', payload),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categories' },
      () => schedule('categories'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asins' },
      () => schedule('asins'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settings' },
      () => schedule('settings'),
    )

  channel = next

  next.subscribe((status, error) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[mako] realtime ${status}`, error?.message ?? '')
      return
    }
    /* Re-subscribed after a session change: anything that happened while the
     * socket was down was never delivered, so pull once to converge. The first
     * subscription (generation 1) is skipped — main.jsx is already fetching. */
    if (status === 'SUBSCRIBED' && myGeneration > 1) {
      schedule('products')
      schedule('categories')
      schedule('asins')
    }
  })
}

export function stopRealtime() {
  generation++

  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending.clear()
  productEvents.length = 0

  if (channel && supabase) {
    const old = channel
    channel = null
    supabase.removeChannel(old).catch(() => {})
  }
}
