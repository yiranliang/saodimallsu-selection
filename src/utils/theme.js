/**
 * 主题（皮肤）
 * ═══════════
 * 目前只有一套皮肤，靠 `<html data-theme="…">` 标记：
 *
 *   `minimal` —— 极简风（米白 + 炭黑 + 暖棕橘），默认
 *
 * 机制留在这里，是因为它本身很便宜、而且不用它也不会增加任何运行时成本：
 * 将来要做第二套皮肤，只需要
 *   1. 在 `THEMES` 里加个名字；
 *   2. 在 index.css 里给 `[data-theme='新名字']` 覆盖那十来个 `--c-*` 变量
 *      （必要时再加几段装饰规则）。
 * 组件一个类名都不用改 —— 调色板已经是 `rgb(var(--c-*) / <alpha-value>)`。
 *
 * 优先级：localStorage（`SAODIMALLSU.setTheme()` 写的）> brandConfig.theme
 * > 'minimal'。**URL 参数不参与** —— 皮肤是站点设定，不该让一条带参数的链接
 * 改变别人看到的样子。当前默认就是 `minimal`。
 */

export const THEMES = ['minimal']
export const DEFAULT_THEME = 'minimal'
export const THEME_STORAGE_KEY = 'sdm-theme'

/** 任意输入 → 一个已知主题名（不认识的一律回默认）。 */
export function normaliseTheme(value) {
  const name = String(value ?? '').trim().toLowerCase()
  return THEMES.includes(name) ? name : DEFAULT_THEME
}

/**
 * 这一次打开页面该用哪个主题。纯函数，方便在 Node 里测。
 *
 * **URL 参数已经取消**：皮肤是站点设定，不该让一个 `?theme=` 改变别人看到的样子
 * （红人把带参数的链接转出去，别人就跟着换了皮）。唯一的运行时覆盖是
 * `localStorage`，它只由 `SAODIMALLSU.setTheme()` 写入 —— 也就是"人工临时切换"，
 * 关掉浏览器标签就回到配置默认。
 *
 * 优先级：localStorage > brandConfig.theme > 'minimal'。
 *
 * @param {{ stored?: string, fallback?: string }} [input]
 * @returns {'minimal'|'cross-stitch'}
 */
export function resolveTheme({ stored = '', fallback = '' } = {}) {
  if (stored) return normaliseTheme(stored)
  return normaliseTheme(fallback)
}

/** 把主题画到 <html> 上。`persist` 时同时记住选择（"一键切回"要能记住）。 */
export function applyTheme(theme, { persist = true, doc = globalThis.document } = {}) {
  const name = normaliseTheme(theme)
  if (doc?.documentElement) doc.documentElement.dataset.theme = name
  if (persist) {
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, name)
    } catch {
      /* 隐私模式/被禁用：主题仍然生效，只是记不住 */
    }
  }
  return name
}

/** 当前实际生效的主题（读 <html data-theme>）。 */
export function currentTheme(doc = globalThis.document) {
  return normaliseTheme(doc?.documentElement?.dataset?.theme)
}
