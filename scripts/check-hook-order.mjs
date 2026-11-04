/**
 * Hook 顺序自检
 *   node scripts/check-hook-order.mjs
 *
 * 这个项目已经因为同一件事白屏过两次（ProductDetail 一次、ProductEditor 一次）：
 *
 *     const [x] = useState(...)
 *     if (!product) return null          // ← 提前 return
 *     const y = useMemo(...)             // ← 永远执行不到
 *
 * 关着的时候少跑一个 hook，打开的时候多跑一个 → React #310
 * "Rendered more hooks than during the previous render"，整页白屏。
 *
 * React 的规则一句话：**同一个组件里，hook 的数量和顺序不能因为 props/state
 * 变化而变**。所以任何 `if (...) return` 之后都不允许再出现 hook。
 *
 * 这个脚本就是那条规则的机械版：
 *   1. 把每个 `function Xxx(` … 列 0 的 `}` 当成一个组件作用域；
 *   2. 找到作用域里第一处"提前 return"（2 空格缩进的 `if (...) return`）；
 *   3. 如果它后面还有 hook 调用 → 报错，列出文件、行号和那行代码。
 *
 * 只做静态扫描，不做 AST —— 宁可漏报，也不要因为一个正则误报把 CI 卡死。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src/components', 'src/pages', 'src/hooks']
const EXTENSIONS = new Set(['.jsx', '.js'])

/* 只认"赋值式"的 hook 调用（`const x = useFoo(`）和几个总是裸调用的 React 内置
 * hook。这样 `useVariantAsMain(url)` 这种名字像 hook、其实是普通函数的调用不会
 * 被误判。 */
const HOOK_ASSIGNED = /^\s*(?:const|let)\s+(?:\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*=\s*use[A-Z]\w*\s*\(/
const HOOK_BARE = /^\s*use(?:Effect|LayoutEffect|Memo|Callback)\s*\(/

/* "提前 return"：组件体缩进（2 空格）下的一行 if … return。 */
const EARLY_RETURN = /^ {2}if\s*\(.*\)\s*return\b|^ {2}if\s*\(.*\)\s*\{\s*$/
/* 作用域结束：列 0 的右花括号。 */
const SCOPE_END = /^\}/

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) walk(full, out)
    else if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) out.push(full)
  }
  return out
}

const problems = []

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let scopeStart = -1
    let scopeName = ''

    const closeScope = (endIndex) => {
      if (scopeStart < 0) return
      let earlyAt = -1
      for (let i = scopeStart; i < endIndex; i++) {
        if (EARLY_RETURN.test(lines[i])) {
          earlyAt = i
          break
        }
      }
      if (earlyAt >= 0) {
        for (let i = earlyAt + 1; i < endIndex; i++) {
          if (HOOK_ASSIGNED.test(lines[i]) || HOOK_BARE.test(lines[i])) {
            problems.push({
              file,
              line: i + 1,
              component: scopeName,
              hook: lines[i].trim(),
              returnLine: earlyAt + 1,
            })
            break
          }
        }
      }
      scopeStart = -1
      scopeName = ''
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const opener = /^(?:export default )?function\s+([A-Z][\w$]*)\s*\(/.exec(line)
      if (opener && !HOOK_ASSIGNED.test(line)) {
        closeScope(i)
        scopeStart = i
        scopeName = opener[1]
        continue
      }
      if (SCOPE_END.test(line)) closeScope(i)
    }
    closeScope(lines.length)
  }
}

if (problems.length) {
  console.error('\n✗ Hook 写在提前 return 之后 —— 打开/关闭组件时会触发 React #310\n')
  for (const problem of problems) {
    console.error(
      `  ${relative(process.cwd(), problem.file)}:${problem.line}  (${problem.component})`,
    )
    console.error(`      第 ${problem.returnLine} 行有提前 return，之后又出现：${problem.hook}`)
  }
  console.error('\n把那个 hook 移到所有 return 之前，或者把提前 return 改成 JSX 里的三元。\n')
  process.exit(1)
}

console.log('✓ hook order: every hook runs before the first early return')
