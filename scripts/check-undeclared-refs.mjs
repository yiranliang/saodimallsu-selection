#!/usr/bin/env node
/**
 * check-undeclared-refs.mjs
 *
 * 拦住一类反复出现的 bug：**定义删了 / 改名了，引用还留着**。
 * 已经踩过：`toggleCategory`、`dealArmed`、`previewTags`、`tagCounts`、`hasHolidayTag`。
 * 它们都能通过 `vite build`（构建不做作用域检查），只在浏览器里炸成白屏。
 *
 * 做法（保守，宁可漏报）：
 *   1. 收集全仓库被 `export` 的名字；
 *   2. 对每个文件，如果它「调用」或「当作 JSX 标签使用」了某个 export 名字，
 *      但本文件既没 import、也没声明，就报错 —— 那只可能是引用残留。
 *
 * 只看 export 名字：数量有限、命名独特，和局部变量几乎不会撞名，误报率低。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(js|jsx|mjs)$/.test(entry)) files.push(full)
  }
}
walk(SRC)

const raw = new Map()
for (const file of files) raw.set(file, readFileSync(file, 'utf8'))

/* 只去注释：字符串里的名字偶尔会被误判，用下面的 IGNORE 兜一下。 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const ID = /^[A-Za-z_$][\w$]*$/

/* ── 1. 全仓库的导出名 ── */
const exported = new Set()
for (const text of raw.values()) {
  for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1])
  for (const m of text.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1])
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name && ID.test(name)) exported.add(name)
    }
  }
}

/* 运行时/浏览器全局，不算"未声明" */
const GLOBALS = new Set([
  'Image', 'Date', 'Map', 'Set', 'Array', 'Object', 'JSON', 'Math', 'Promise', 'Error',
  'Number', 'String', 'Boolean', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'fetch',
  'URL', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'Intl', 'FormData',
])

/* ── 2. 逐文件检查 ── */
const problems = []

for (const [file, source] of raw) {
  const rel = relative(ROOT, file)
  const code = stripComments(source)

  const declared = new Set()

  /* import 的名字（含 default / 别名 / 多行列表） */
  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name && ID.test(name)) declared.add(name)
    }
  }

  /* 声明：const/let/var/function/class，以及解构赋值/参数的裸名 */
  for (const m of source.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
  for (const m of source.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]/g)) declared.add(m[1])
  for (const m of source.matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*(?:=[^,\n]*)?,?\s*$/gm)) declared.add(m[1])

  for (const name of exported) {
    if (GLOBALS.has(name) || declared.has(name)) continue
    if (new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(source)) continue

    const called = new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(code)
    const asTag = new RegExp(`<${name}[\\s/>]`).test(code)
    if (!called && !asTag) continue

    problems.push(`${rel}: 「${name}」既没有 import 也没有在本文件声明`)
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} 处未声明的引用：\n`)
  for (const line of problems) console.error(`  ${line}`)
  console.error('\n多半是删了定义（或改了导出）却没清引用。')
  process.exit(1)
}

console.log(`✓ no undeclared references (${files.length} files, ${exported.size} exported names)`)
