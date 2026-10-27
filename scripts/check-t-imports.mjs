#!/usr/bin/env node
/**
 * `t()` 的 import 闸
 * ═══════════════════
 * 用了 `t(...)` 却没 `import { t }` 的组件，esbuild **不报错**、`npm run build`
 * 通过、冒烟里没打开过的页面全部静默 —— 直到运营点进去，ErrorBoundary 兜住
 * 整页，只留一句 `t is not defined`。
 *
 * 这不是假设：后台全中文化那一轮在 `AdminResult.jsx`（查码结果）和
 * `DeveloperPage.jsx`（开发工具）各埋了一个，两个页面此前恰好没人打开过。
 * 这道闸就是那两条事故的回归，跑在 `npm test` 的最前面。
 *
 * 判定刻意保守（只报确定的错误，不猜意图）：
 *   · 已有任何形态的 `import { … t … }` → 跳过
 *   · `i18n/admin.js` 是 `t` 的定义处 → 跳过
 *   · `t(` 前面不能是标识符字符（排除 `text(`、`export(`、对象方法 `.t(`）
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
/* 与下面 `rel` 的形态保持一致（正斜杠）—— Windows 上 join 会给反斜杠。 */
const DEFINE_FILE = 'i18n/admin.js'

let passed = 0
let failed = 0

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(full)
  }
  return out
}

const offenders = []
for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
  if (rel === DEFINE_FILE) continue

  const src = readFileSync(file, 'utf8')
  /* 任何形态的命名导入都算数：import { t } / import { t, x } / 多行。 */
  if (/import\s*\{[^}]*\bt\b[^}]*\}\s*from/.test(src)) continue
  /* 真正调用 `t(`，且不是别的标识符的尾巴、不是对象方法、不是属性定义。 */
  if (/(?<![A-Za-z0-9_$.])t\(/.test(src)) offenders.push(rel)
}

if (offenders.length) {
  failed = offenders.length
  console.log('✗ 用了 t() 但没有 import —— 渲染时会抛 "t is not defined"：')
  for (const file of offenders) console.log(`    src/${file}`)
} else {
  passed = 1
  console.log('✓ every t() call site imports t')
}

console.log(`\n${failed ? '✗ FAILURES' : '✓ ALL PASSED'}: ${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
