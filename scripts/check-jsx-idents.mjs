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

console.log(problems ? `\n${problems} file(s) with unresolved JSX tags` : '\n✓ every JSX tag resolves')
if (problems) process.exit(1)
