#!/usr/bin/env node
/**
 * Push the local catalogue into Supabase
 * ═══════════════════════════════════════
 *
 *   node scripts/push-supabase.mjs                  # upsert everything
 *   node scripts/push-supabase.mjs --dry-run        # print the plan, write nothing
 *   node scripts/push-supabase.mjs --fresh          # wipe the three tables first
 *   node scripts/push-supabase.mjs --only=asins     # one table only
 *
 * Source of truth is the shipped files, not localStorage:
 *   src/data/products.js → categories + products
 *   src/data/asins.js    → asins
 *
 * (There is no src/data/categories.js — the category list is a named export
 *  inside products.js, because the importer generates both from one sheet.)
 *
 * Credentials, in order of preference:
 *
 *   1. SUPABASE_SERVICE_ROLE_KEY   — bypasses RLS. Fastest, but that key can do
 *                                    anything, so keep it out of the repo.
 *   2. SUPABASE_ADMIN_EMAIL + SUPABASE_ADMIN_PASSWORD
 *                                  — signs in as your admin account and writes
 *                                    as `authenticated`. This also proves the
 *                                    RLS policies actually work, which is why
 *                                    it is the recommended path.
 *
 * Re-running is safe: everything upserts on the primary key.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { products, categories } from '../src/data/products.js'
import { asins } from '../src/data/asins.js'

/* ── tiny .env reader ──────────────────────────────────────────────────────
 * Zero dependencies and no CLI flag to remember. Values already present in the
 * real environment win, so `SUPABASE_SERVICE_ROLE_KEY=x node …` still works.
 */
function loadEnv() {
  /* ENV_FILE lets one checkout serve two brands — see scripts/cli-common.mjs */
  const path = resolve(process.cwd(), process.env.ENV_FILE || '.env')
  if (!existsSync(path)) return
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
}

loadEnv()

/* ── args ───────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const FRESH = argv.includes('--fresh')
const ONLY = (() => {
  const raw = argv.find((a) => a.startsWith('--only='))
  if (!raw) return new Set(['categories', 'products', 'asins'])
  const picked = raw
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(picked)
})()

const CHUNK = 100

/* ── credentials ────────────────────────────────────────────────────────── */
const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.env.SUPABASE_ADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_ADMIN_PASSWORD

function die(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!URL || !ANON) {
  die(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing.\n' +
      '  Put them in .env at the project root (Vite reads that file too).',
  )
}

// A dry run never writes, so it does not need write credentials
if (!DRY && !SERVICE && !(EMAIL && PASSWORD)) {
  die(
    'No credentials to write with. Pick one:\n\n' +
      '  A) recommended — sign in as your admin account, append to .env:\n' +
      '       SUPABASE_ADMIN_EMAIL=ops@yourbrand.com\n' +
      '       SUPABASE_ADMIN_PASSWORD=your-password\n\n' +
      '  B) service role — append to .env:\n' +
      '       SUPABASE_SERVICE_ROLE_KEY=eyJ…\n' +
      '     (bypasses RLS; never commit it, never put it in a VITE_ variable)',
  )
}

const supabase = createClient(URL, SERVICE || ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/* ── helpers ────────────────────────────────────────────────────────────── */
const out = (text = '') => console.log(text)

function bar(done, total) {
  const width = 24
  const filled = total ? Math.round((done / total) * width) : width
  process.stdout.write(`\r    [${'█'.repeat(filled)}${'·'.repeat(width - filled)}] ${done}/${total}`)
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) {
    out(`    ${table}: nothing to write`)
    return 0
  }

  if (DRY) {
    out(`    ${table}: would upsert ${rows.length} rows (on conflict ${onConflict})`)
    return rows.length
  }

  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).upsert(slice, { onConflict })
    if (error) {
      process.stdout.write('\n')
      throw new Error(`${table} upsert failed — ${error.message}${error.details ? ` (${error.details})` : ''}`)
    }
    done += slice.length
    bar(done, rows.length)
  }
  process.stdout.write('\n')
  return done
}

/* ── build rows ─────────────────────────────────────────────────────────── */
const modeLabel = SERVICE
  ? 'service role (RLS bypassed)'
  : DRY
    ? 'dry run (no credentials needed)'
    : `admin sign-in as ${EMAIL}`

out('')
out('Saodimallsu → Supabase import')
out(`  project  ${URL}`)
out(`  mode     ${modeLabel}`)
out(`  source   ${products.length} products · ${Object.keys(asins).length} ASIN 货号`)
out(`  flags    ${DRY ? 'dry-run · ' : ''}${FRESH ? 'fresh · ' : ''}only=${[...ONLY].join(',')}`)

/**
 * Column mapping. Note `variantImages` → `variant_images`; every other name is
 * identical. `sort_order` is the array index, which is what keeps the grid and
 * the category rail in the order ops arranged them.
 */
const productRows = products.map((p, index) => ({
  id: p.id,
  sku: p.sku ?? null,
  name: p.name ?? '',
  category: p.category || 'Uncategorised',
  image: p.image || './placeholders/placeholder.svg',
  specs: p.specs || {},
  variant_images: p.variantImages || {},
  hidden: p.hidden === true,
  tag: p.tag || '',
  sort_order: index,
}))

/** Category list = shipped order, then anything a product actually uses. */
const categoryNames = []
for (const name of [...categories, ...productRows.map((p) => p.category), 'Uncategorised']) {
  const clean = String(name || '').trim()
  if (clean && !categoryNames.includes(clean)) categoryNames.push(clean)
}

const categoryRows = categoryNames.map((name, index) => ({ name, sort_order: index }))

const asinRows = Object.entries(asins).map(([sku, variants]) => ({
  sku,
  variants: variants || {},
}))

/* ── sanity checks before touching the network ──────────────────────────── */
const problems = []
const seenIds = new Set()
for (const row of productRows) {
  if (seenIds.has(row.id)) problems.push(`duplicate id ${row.id}`)
  seenIds.add(row.id)
  if (!/^p\d{3,}$/.test(row.id)) problems.push(`odd id format: ${row.id}`)
  if (!row.sku) problems.push(`${row.id} has no sku — its ASINs will never resolve`)
}

const specOrders = new Set(productRows.map((p) => Object.keys(p.specs || {}).join('+')))
if (specOrders.size > 1) {
  problems.push(`products disagree on spec key order: ${[...specOrders].join(' | ')}`)
}
if (problems.length) {
  out('')
  out('  ⚠ pre-flight warnings')
  for (const p of problems.slice(0, 10)) out(`      · ${p}`)
  if (problems.length > 10) out(`      · …and ${problems.length - 10} more`)
}

/* ── auth ───────────────────────────────────────────────────────────────── */
if (!SERVICE && !DRY) {
  out('')
  out('  signing in…')
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error) die(`sign-in failed — ${error.message}`)

  const { data: me, error: meError } = await supabase.from('admin_users').select('email')
  if (meError) die(`could not read admin_users — ${meError.message}`)
  if (!me || me.length === 0) {
    die(
      'signed in, but this account is not in public.admin_users — every write would be rejected by RLS.\n' +
        "  Add it in the SQL Editor:\n" +
        "    insert into public.admin_users (user_id, email)\n" +
        "    select id, email from auth.users where email = '…' on conflict do nothing;",
    )
  }
  out(`  ✓ authenticated as ${me[0].email}`)
}

/* ── wipe (optional) ────────────────────────────────────────────────────── */
if (FRESH) {
  out('')
  out('  --fresh: clearing the three tables')
  // Order matters: products reference categories (ON DELETE RESTRICT)
  for (const [table, key] of [
    ['asins', 'sku'],
    ['products', 'id'],
    ['categories', 'name'],
  ]) {
    if (!ONLY.has(table)) continue
    if (DRY) {
      out(`    ${table}: would delete all rows`)
      continue
    }
    const { error } = await supabase.from(table).delete().not(key, 'is', null)
    if (error) die(`could not clear ${table} — ${error.message}`)
    out(`    ${table}: cleared`)
  }
}

/* ── write ──────────────────────────────────────────────────────────────── */
try {
  out('')
  out('  writing')

  if (ONLY.has('categories')) {
    await upsert('categories', categoryRows, 'name')
  }

  if (ONLY.has('products')) {
    await upsert('products', productRows, 'id')
  }

  if (ONLY.has('asins')) {
    await upsert('asins', asinRows, 'sku')
  }
} catch (error) {
  die(error.message)
}

if (DRY) {
  out('')
  out('  dry run — nothing was written.')
  out('')
  process.exit(0)
}

/* ── sequence ───────────────────────────────────────────────────────────── */
out('')
out('  product id sequence')

let seqValue = null
const { data: seq, error: seqError } = await supabase.rpc('sync_product_id_seq')

if (seqError) {
  out('    ⚠ sync_product_id_seq() not available')
  out('      Run supabase/02-import-helpers.sql once in the SQL Editor,')
  out('      or run this by hand:')
  out('')
  out("        select setval('public.products_id_seq',")
  out("          (select max(substring(id from 2)::int) from public.products), true);")
} else {
  seqValue = seq
  out(`    ✓ sequence now sits at ${seqValue} — the next new product becomes p${String(Number(seqValue) + 1).padStart(3, '0')}`)
}

/* ── verify ─────────────────────────────────────────────────────────────── */
out('')
out('  verifying')

const counts = {}
for (const table of ['categories', 'products', 'asins']) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) die(`could not count ${table} — ${error.message}`)
  counts[table] = count
  out(`    ${table.padEnd(11)} ${count}`)
}

/* A second, unauthenticated client — this is exactly what a creator's browser
 * looks like. Products must be visible; ASINs must not. */
const anonClient = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { count: anonProducts } = await anonClient
  .from('products')
  .select('*', { count: 'exact', head: true })

if (anonProducts === products.length) {
  out(`    ✓ anon can read all ${anonProducts} products (storefront works logged-out)`)
} else {
  out(`    ✗ anon sees ${anonProducts} of ${products.length} products — check products_read`)
}

const { count: anonAsins, error: anonAsinError } = await anonClient
  .from('asins')
  .select('*', { count: 'exact', head: true })

if (anonAsinError) {
  out(`    ✓ anon cannot read asins (${anonAsinError.message})`)
} else if (anonAsins === 0) {
  out('    ✓ anon sees 0 ASIN rows')
} else {
  out(`    ✗ anon can read ${anonAsins} ASIN rows — asins_read is too open`)
  out('      Run supabase/03-harden-asins.sql in the SQL Editor.')
}

/* The whole json-vs-jsonb decision hinges on this: specs key order has to come
 * back as Colour,Size. If it ever reads Size,Colour, every v4 code is decoding
 * its values into the wrong slots. */
const { data: probe, error: probeError } = await supabase
  .from('products')
  .select('id, specs, variant_images')
  .eq('id', products[0].id)
  .maybeSingle()

if (probeError) {
  out(`    ⚠ could not probe ${products[0].id} — ${probeError.message}`)
} else if (!probe) {
  out(`    ⚠ ${products[0].id} not found after import`)
} else {
  const order = Object.keys(probe.specs || {}).join(',')
  const expected = Object.keys(products[0].specs || {}).join(',')
  if (order === expected) {
    out(`    ✓ spec key order preserved (${order})`)
  } else {
    out(`    ✗ spec key order changed: expected "${expected}", got "${order}"`)
    out('      The column is jsonb, not json — fix it before using any old code:')
    out('        alter table public.products')
    out('          alter column specs type json using specs::text::json,')
    out('          alter column variant_images type json using variant_images::text::json;')
  }

  const imgOrder = Object.keys(probe.variant_images || {}).join(',')
  if (Object.keys(products[0].variantImages || {}).length) {
    out(`    · variant_images keys: ${imgOrder || '(empty)'}`)
  }
}

/* ── summary ────────────────────────────────────────────────────────────── */
out('')
out('  done')
out(`    products   ${counts.products} in cloud · ${products.length} in file`)
out(`    asins      ${counts.asins} in cloud · ${Object.keys(asins).length} in file`)
out(`    categories ${counts.categories} in cloud · ${categoryRows.length} planned`)

if (counts.products !== products.length) {
  out('')
  out(`  ⚠ product count mismatch — the table had rows the files do not know about.`)
  out('    Use --fresh to make the cloud match the files exactly.')
}

out('')
out('  next: open /#/admin, sign in with the same email + password, and the')
out('        editor will read from Supabase instead of localStorage.')
out('')
