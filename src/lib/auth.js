/**
 * Admin auth
 * ──────────
 * Replaces the hard-coded passcode. `signInWithPassword` returns a JWT that
 * supabase-js attaches to every subsequent request, which is what makes the
 * RLS write policies (`public.is_admin()`) pass.
 *
 * Two separate questions, deliberately:
 *   status   — is anyone signed in?      (drives the gate)
 *   isAdmin  — are they on the allowlist? (drives a readable message)
 *
 * Anyone can create a Supabase account if sign-ups are left on, so "signed in"
 * must never be treated as "allowed to edit". The database enforces the real
 * check; this only avoids showing a console that would fail on every save.
 */

import { supabase } from './supabase.js'
import { startRealtime, stopRealtime } from './realtime.js'

const initial = {
  status: supabase ? 'loading' : 'signed-out',
  user: null,
  isAdmin: false,
  /** false until the allowlist lookup has come back — avoids a false "denied" flash */
  adminChecked: false,
  error: '',
}

let state = initial
const listeners = new Set()

function emit() {
  listeners.forEach((fn) => fn())
}

function setState(patch) {
  state = { ...state, ...patch }
  emit()
}

export function getAuthState() {
  return state
}

export function subscribeAuth(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Friendly text for the two failures people actually hit. */
function mapError(message) {
  /* 登录页是后台的一部分（前台不需要登录），所以这里的文案是中文。
   * Supabase 自己的报错是英文，这里把它们折成几句运营看得懂的话；
   * 认不出来的原样透出，至少能搜到。 */
  const text = String(message || '')
  if (/invalid login credentials/i.test(text)) return '邮箱或密码不对。'
  if (/email not confirmed/i.test(text)) return '这个账号还没完成邮箱验证。'
  if (/rate limit|too many/i.test(text)) return '尝试太频繁 —— 等一分钟再试。'
  return text || '登录失败。'
}

/** Ask the DB whether this user is on the allowlist. */
async function checkAdmin() {
  if (!supabase) return
  const { data, error } = await supabase.from('admin_users').select('user_id').limit(1)
  if (error) {
    // A network blip should not silently demote an admin — keep the previous
    // answer and let the write fail loudly if it really is wrong.
    return
  }
  setState({ isAdmin: (data?.length ?? 0) > 0, adminChecked: true })
}

function applySession(session) {
  if (!session) {
    setState({ status: 'signed-out', user: null, isAdmin: false, adminChecked: false })
    stopRealtime()
    return
  }

  const changedUser = state.user?.id !== session.user?.id
  setState({ status: 'signed-in', user: session.user, error: '' })
  if (changedUser || !state.adminChecked) checkAdmin()

  // The realtime socket carries a JWT; after a sign-in it has to be rebuilt so
  // the asins subscription (allowlist-only) can actually see rows.
  startRealtime().catch((err) => console.warn('[mako] realtime restart failed', err))
}

let bootstrapped = false

/** Called once from main.jsx. */
export async function bootstrapAuth() {
  if (bootstrapped || !supabase) return
  bootstrapped = true

  const { data } = await supabase.auth.getSession()
  applySession(data?.session ?? null)

  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase warns against awaiting its own client inside this callback —
    // a setTimeout gets us out of the lock before touching the network.
    setTimeout(() => applySession(session), 0)
  })
}

export async function signIn(email, password) {
  if (!supabase) return { ok: false, error: 'Supabase 还没配置好。' }

  const cleanEmail = String(email || '').trim()
  if (!cleanEmail || !password) return { ok: false, error: '请输入邮箱和密码。' }

  setState({ error: '' })
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  })

  if (error) {
    const message = mapError(error.message)
    setState({ error: message })
    return { ok: false, error: message }
  }

  applySession(data.session)
  return { ok: true }
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
  setState({ status: 'signed-out', user: null, isAdmin: false, adminChecked: false, error: '' })
  stopRealtime()
}
