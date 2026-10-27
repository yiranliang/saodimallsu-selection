/**
 * Shared CLI plumbing for the seasonal batch scripts
 * ═══════════════════════════════════════════════════
 * `batch-upsert.mjs` and `batch-delete.mjs` both need the same four things:
 * a `.env` reader, a Supabase client with admin credentials, a chunked writer,
 * and a way to die with a readable message. Duplicating them twice is how the
 * two scripts end up authenticating differently, and then only one of them
 * exercises RLS.
 *
 * `import-asins.mjs` deliberately keeps its own copy of this code — it is in the
 * middle of live import runs and there is no reason to touch it.
 *
 * NO DEFAULTS THAT WRITE. Nothing here decides to mutate anything; that is each
 * script's job, behind its own `--write` / `--force` flag.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal .env reader — same rules as `push-supabase.mjs`.
 *
 * WHICH FILE
 * ──────────
 * Running two brands out of one machine means two sets of credentials, and the
 * failure mode is silent: point a 26,830-row import at the wrong project and it
 * succeeds. So the file is explicit and overridable, in this order:
 *
 *   loadEnv('.env.brandb')      ← `--env=.env.brandb` on the command line
 *   loadEnv()  + ENV_FILE=…     ← environment variable, for CI
 *   loadEnv()                   ← `.env`, the single-brand default
 *
 * Returns the path that was actually read, so scripts can print it. A path you
 * asked for by name but that does not exist is an error, not a fallback: falling
 * back to `.env` there is exactly how the wrong database gets written.
 */
export function loadEnv(file = '') {
  const requested = String(file || process.env.ENV_FILE || '').trim()
  const path = resolve(process.cwd(), requested || '.env')

  if (!existsSync(path)) {
    if (requested) die(`找不到 env 文件：${path}`)
    return ''
  }

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
    if (!(key in process.env)) process.env[key] = value
  }

  return path
}

/** Host of the project the env file points at — the thing you actually check. */
export function projectHost(url = '') {
  const raw = String(url || process.env.VITE_SUPABASE_URL || '')
  if (!raw) return '(未配置)'
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

/**
 * Three lines that answer "which database am I about to touch?".
 * Printed by every script that can write, before it writes.
 */
export function printTarget(envPath = '') {
  const name = process.env.BRAND_NAME || ''
  const slug = process.env.BRAND_SLUG || ''
  out(`  env      ${envPath || '(none)'}`)
  out(`  品牌     ${name || '—'}${slug ? `  [${slug}]` : ''}`)
  out(`  目标库   ${projectHost()}`)
}

/**
 * `--expect-brand=brandb` — refuse to run when the env file belongs to someone
 * else. Opt-in: without the flag nothing changes, so existing scripts keep
 * working; with it, a mistyped `--env` cannot reach the wrong project.
 */
export function brandGuard(args) {
  const expected = String(args.get('expect-brand', '') || '').trim().toLowerCase()
  if (!expected) return

  const actual = String(process.env.BRAND_SLUG || '').trim().toLowerCase()
  if (!actual) {
    die(
      `--expect-brand=${expected} 需要 env 文件里有一行 BRAND_SLUG=<品牌标识>。\n` +
        '  加上它之后，这条命令才有东西可以核对。',
    )
  }
  if (actual !== expected) {
    die(
      `品牌不符：命令行要的是 ${expected}，当前 env 是 ${actual}。\n` +
        `  目标库是 ${projectHost()} —— 拒绝执行。检查 --env 或 .env 指向。`,
    )
  }
}

/**
 * `--flag` booleans and `--key=value` strings, plus positional args.
 * `has('write')` / `get('sheet', '')` read like the command line does.
 */
export function readArgs(argv = process.argv.slice(2)) {
  const flags = new Set()
  const values = new Map()

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq === -1) flags.add(arg.slice(2))
    else values.set(arg.slice(2, eq), arg.slice(eq + 1))
  }

  return {
    argv,
    flags,
    values,
    has: (name) => flags.has(name),
    get: (name, fallback = '') => (values.has(name) ? values.get(name) : fallback),
    positional: argv.filter((arg) => !arg.startsWith('-')),
  }
}

export function die(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

export const out = (text = '') => console.log(text)
export const pad = (text, width) => String(text ?? '').padEnd(width)

/**
 * Connect with admin credentials, preferring the service role when present.
 *
 * The email/password path is the recommended one: it goes through RLS exactly
 * like the browser does, so a policy mistake fails the nightly job instead of
 * hiding until an operator clicks something.
 */
export async function connectAdmin({ url, anon, service, email, password } = {}) {
  const projectUrl = url || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = anon || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = service || process.env.SUPABASE_SERVICE_ROLE_KEY
  const adminEmail = email || process.env.SUPABASE_ADMIN_EMAIL
  const adminPassword = password || process.env.SUPABASE_ADMIN_PASSWORD

  if (!projectUrl || !anonKey) {
    die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 缺失，检查项目根目录的 .env')
  }

  const supabase = createClient(projectUrl, serviceKey || anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (serviceKey) {
    return { supabase, url: projectUrl, mode: 'service role（绕过 RLS）', who: '' }
  }

  if (!adminEmail || !adminPassword) {
    die(
      '没有可写入的凭据。在 .env 里加 SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD，\n' +
        '  或者 SUPABASE_SERVICE_ROLE_KEY（绕过 RLS，别提交进仓库）。',
    )
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })
  if (error) die(`登录失败 —— ${error.message}`)

  const { data: me, error: meError } = await supabase.from('admin_users').select('email')
  if (meError) die(`读不到 admin_users —— ${meError.message}`)
  if (!me || me.length === 0) {
    die('登录成功，但这个账号不在 public.admin_users 里，所有写入都会被 RLS 拒绝')
  }

  return { supabase, url: projectUrl, mode: `管理员 ${me[0].email}`, who: me[0].email }
}

/** Supabase caps the request size; 100 rows per round trip is the house value. */
export const CHUNK = 100

export function chunks(list, size = CHUNK) {
  const out_ = []
  for (let i = 0; i < list.length; i += size) out_.push(list.slice(i, i + size))
  return out_
}
