/**
 * Guard against the blank-page class of bug.
 *   node scripts/check-jsx-idents.mjs
 *
 * A JSX tag that is neither imported nor defined in the same file throws a
 * ReferenceError at render time and React unmounts the whole subtree — the page
 * goes blank with no error visible to the user. The bundler cannot catch it
 * because it looks like a global.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src'
const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.jsx?$/.test(path)) files.push(path)
  }
})(ROOT)

const INTRINSIC = new Set(['Fragment'])
/* Capitalised JS builtins that are legitimately not imported */
const GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Map', 'Set',
  'Promise', 'Error', 'JSON', 'Math', 'RegExp', 'Symbol', 'WeakMap',
  'WeakSet', 'URL', 'Blob', 'File', 'FormData', 'Intl', 'BigInt',
])
let problems = 0

for (const file of files) {
  /* strip comments first — docs legitimately mention tags like <App/> */
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const used = new Set()
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) used.add(m[1])
  if (!used.size) continue

  const declared = new Set()
  for (const m of code.matchAll(/import\s+([^'"]+?)\s+from/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) declared.add(name)
    }
  }
  for (const m of code.matchAll(/(?:function|const|let|class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    declared.add(m[1])
  }
  /* Destructured and aliased bindings: ({ icon: Icon }) => … */
  for (const m of code.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s*:\s*/).pop().split('=')[0].trim()
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) declared.add(name)
    }
  }

  const missing = [...used].filter(
    (n) => !declared.has(n) && !INTRINSIC.has(n) && !GLOBALS.has(n),
  )
  if (missing.length) {
    problems++
    console.log(`✗ ${file}`)
    console.log(`    not imported or defined: ${missing.join(', ')}`)
  }
}

/* ── 事件处理器指向了不存在的东西 ──
 *
 * `onToggleCategory={toggleCategory}` 在函数被删掉之后仍然"长得像合法代码"：
 * 打包器把它当全局变量，直到运行时才抛 ReferenceError，整页白屏。
 * 只查一类窄而准的写法：prop 的值是一个裸标识符，而它既没声明也没导入。 */
const JS_GLOBALS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'console', 'window',
  'document', 'localStorage', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch',
  'process', 'globalThis', 'parseInt', 'parseFloat', 'isNaN', 'alert',
])

function declaredNames(code) {
  const names = new Set()
  const add = (token) => {
    for (const part of String(token).split(/[,\s]+/)) {
      const name = part.replace(/[:=].*$/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }

  for (const m of code.matchAll(/import\s*\{([^}]*)\}/g)) add(m[1])
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) add(m[1])
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) add(m[1])
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1])
  for (const m of code.matchAll(/function\s*[A-Za-z_$]*\s*\(([^)]*)\)/g)) add(m[1])
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(m[1])

  return names
}

for (const file of files) {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const declared = declaredNames(code)

  for (const m of code.matchAll(/\bon[A-Z][A-Za-z0-9]*=\{([A-Za-z_$][\w$]*)\}/g)) {
    const name = m[1]
    if (declared.has(name) || JS_GLOBALS.has(name)) continue
    problems++
    console.log(`  x handler not declared: on*={${name}} in ${file}`)
  }
}

console.log(problems ? `\n${problems} file(s) with unresolved JSX tags` : '\n✓ every JSX tag resolves')
if (problems) process.exit(1)
