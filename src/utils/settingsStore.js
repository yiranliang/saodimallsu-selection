/**
 * 站点级设置（settings 表）
 * ═════════════════════
 *
 * 现在只有一项：前台 ⚡ 秒杀专区的展示名（`deals_tab_label`）。
 *
 * 为什么是数据库而不是 localStorage
 * ──────────────────────────────
 * 这个字符串是**给红人看的**。运营在黑五期间把 Tab 改成「Black Friday Deals」，
 * 红人手机上必须跟着变 —— 那不可能靠运营自己浏览器里的 localStorage。
 * 写死成常量则要发一次版才能改名，也不叫"可配置"。
 *
 * 读是全公开的（settings_read 策略 `using (true)`），写只有 admin。没有这一行、
 * 或者 `12-settings.sql` 还没跑时，全部退回默认值 —— 前台永远有一枚正常的药丸，
 * 后台会看到一条"先跑迁移"的提示。
 */

import { isConfigured, requireClient } from '../lib/supabase.js'
import { DEALS_TAB_DEFAULT_LABEL, normaliseDealsTabLabel } from './deal.js'

/** 数据库里的 key。集中在这里，避免字符串散落各处。 */
export const SETTING_KEYS = {
  dealsTabLabel: 'deals_tab_label',
}

/** 一份完整的默认值。`cache` 始终是它的超集，组件可以直接读字段。 */
const DEFAULTS = {
  dealsTabLabel: DEALS_TAB_DEFAULT_LABEL,
}

let cache = { ...DEFAULTS }
/* 'idle' → 还没请求；'loading'；'ready'（含"表不存在、用默认值"）；
 * 'missing' 单列出来，是因为后台要据此提示"先跑 12-settings.sql"。 */
let status = isConfigured ? 'idle' : 'ready'
let inflight = null

const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

/* ── reads ───────────────────────────────────────────────────────────────── */

export function getSettings() {
  return cache
}

export function getSettingsStatus() {
  return status
}

export function subscribeSettings(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 迁移没跑时的报错长这样：`relation "public.settings" does not exist`。 */
function isMissingTable(error) {
  return /does not exist|42P01|not find the table/i.test(String(error?.message || ''))
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function loadSettings({ silent = false } = {}) {
  if (!isConfigured) return cache
  if (inflight) return inflight

  if (!silent) {
    status = 'loading'
    notify()
  }

  inflight = (async () => {
    const { data, error } = await requireClient().from('settings').select('key, value')

    if (error) {
      /* 表不存在 → 用默认值继续，但把状态留住，后台据此提示。
       * 其它错误（离线、token 过期）不降级成 'missing'，否则会误导运营去跑
       * 一条已经跑过的 SQL。 */
      status = isMissingTable(error) ? 'missing' : status === 'idle' ? 'ready' : status
      notify()
      return cache
    }

    const next = { ...DEFAULTS }
    for (const row of data || []) {
      if (row?.key === SETTING_KEYS.dealsTabLabel) {
        /* 库里存空字符串 = 默认名（`normaliseDealsTabLabel` 负责这件事）。 */
        next.dealsTabLabel = normaliseDealsTabLabel(row.value)
      }
    }

    cache = next
    status = 'ready'
    notify()
    return cache
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/* ── writes ──────────────────────────────────────────────────────────────── */

/**
 * 改秒杀专区的展示名。返回真正落库的那个字符串（已规整）。
 *
 * 用 upsert 而不是 update：第一次可能连默认行都还没有（迁移建表成功但
 * insert 被跳过、或者有人删了这行）。
 *
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function setDealsTabLabel(value) {
  const label = normaliseDealsTabLabel(value)

  const { error } = await requireClient()
    .from('settings')
    .upsert(
      {
        key: SETTING_KEYS.dealsTabLabel,
        value: label,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )

  if (error) {
    if (isMissingTable(error)) {
      status = 'missing'
      notify()
      throw new Error('settings 表不存在。先在 Supabase 跑一次 supabase/12-settings.sql。')
    }
    throw new Error(error.message)
  }

  cache = { ...cache, dealsTabLabel: label }
  status = 'ready'
  notify()
  return label
}

/** 恢复默认名。等价于用默认值调一次 `setDealsTabLabel`。 */
export async function resetDealsTabLabel() {
  return setDealsTabLabel(DEALS_TAB_DEFAULT_LABEL)
}

/* 测试用：把缓存塞回默认值（不触网）。 */
export function __resetSettingsForTests() {
  cache = { ...DEFAULTS }
  status = 'ready'
  notify()
}
