/**
 * 后台中文化 self-check
 *   node scripts/test-admin-i18n.mjs
 *
 * 三件事，少一件就会在某个时刻悄悄失效：
 *
 *   [1] 字典本身      —— 没有重复 key、每条都有中文、`t()` 的兜底和插值正确
 *   [2] 后台漏翻      —— 扫源码里还没进 `t()` 的英文文案
 *   [3] 前台红线      —— Storefront 一个 `t()` 都不许引，一个汉字都不许出现
 *
 * [3] 是这条测试存在的真正理由：后台汉化最典型的翻车方式是"顺手改了一个
 * 共用组件"，于是海外红人在商品卡上看到「已售罄」。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADMIN_ZH, hasTranslation, t } from '../src/i18n/admin.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

const CJK = /[\u4e00-\u9fff]/

/** 去掉注释再找汉字/文案 —— 这些文件的注释本来就是中文写的。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/* ── 1. 字典 ── */
console.log('\n[1] the dictionary itself')

const entries = Object.entries(ADMIN_ZH)
check('it has entries', entries.length > 100, true)
check(
  'every value is Chinese',
  entries.filter(([, value]) => !CJK.test(value)).map(([key]) => key),
  [],
)
check(
  'no value is the English key itself',
  entries.filter(([key, value]) => value === key).map(([key]) => key),
  [],
)

/* 对象字面量会静默吞掉重复 key —— 只能回到源码里数一次。 */
{
  const src = read('src/i18n/admin.js')
  const body = src.slice(src.indexOf('export const ADMIN_ZH'))
  const keys = [...body.matchAll(/^\s{2}'((?:[^'\\]|\\.)+)':/gm)].map((m) => m[1])
  const seen = new Set()
  const dupes = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
  check('no duplicate keys', dupes, [])
  check('every key is a real string', keys.length > 100, true)
}

check('a known key translates', t('Cancel'), '取消')
check('an unknown key falls back to itself', t('Some untranslated string'), 'Some untranslated string')
check('hasTranslation agrees', [hasTranslation('Cancel'), hasTranslation('nope')], [true, false])
check('interpolation fills the hole', t('{n} 件商品', { n: 3 }), '3 件商品')
check('a missing variable keeps the placeholder', t('{n} 件商品', {}), '{n} 件商品')
check('no vars leaves the text alone', t('已保存'), '已保存')

/* ── 2. 后台漏翻 ── */
console.log('\n[2] admin copy that never reached t()')

const ADMIN_FILES = [
  'src/pages/admin/ProductsPage.jsx',
  'src/pages/admin/AdminLayout.jsx',
  'src/pages/admin/AdminNotFound.jsx',
  'src/pages/admin/LookupPage.jsx',
  'src/pages/admin/DeveloperPage.jsx',
  'src/components/admin/ProductEditor.jsx',
  'src/components/admin/AccessGate.jsx',
  'src/components/admin/AdminQuery.jsx',
  'src/components/admin/AdminResult.jsx',
]

/* 这些是代码标识符或格式名，本来就该保持原样：
 * 列名（badge_color）、迁移文件名、必须照打的关键字、文件格式。 */
const CODE_TOKENS = new Set([
  'badge_color',
  'sub_tag',
  'deal_priority',
  'supabase/07-badge-color.sql',
  'supabase/11-sub-badge-deal-priority.sql',
  'DELETE',
  'CSV',
  'JSON',
  'ASIN',
  'ASINs',
  'ACC',
])

/* 这些是"示例值"占位符（商品名、价格、邮箱格式），故意保持原样：
 * 它们展示的是数据的形状，不是一句要读的文案。 */
const EXAMPLE_PLACEHOLDERS = new Set([
  'Wool-Blend Wide-Leg Trousers',
  '39.99 / 30-50',
  '19.99 / 15-25',
  'you@brand.com',
  'https://… or ./placeholders/p001.svg',
])

/* 一段文本节点是不是"人话"：不能带代码标点，不能以数字开头。 */
const looksLikeCopy = (text) =>
  !/[(){}\[\];=`|&<>$]/.test(text) && !/^[\d.…—]/.test(text) && !text.includes(' // ')

const leftovers = []
for (const file of ADMIN_FILES) {
  const src = stripComments(read(file))
  for (const match of src.matchAll(/>([^<>{}]{3,400}?)</gs)) {
    const text = match[1].replace(/\s+/g, ' ').trim()
    if (!text || CJK.test(text)) continue
    if (!/[A-Za-z]{2}/.test(text)) continue
    if (CODE_TOKENS.has(text)) continue
    if (!looksLikeCopy(text)) continue
    // 单个标识符（没有空格）不算一句文案
    if (!text.includes(' ')) continue
    const line = src.slice(0, match.index).split('\n').length
    leftovers.push(`${file}:${line} · ${text.slice(0, 70)}`)
  }
}
check('no English text nodes left in the admin', leftovers, [])

const attrLeftovers = []
for (const file of ADMIN_FILES) {
  const src = read(file)
  for (const match of src.matchAll(/placeholder="([^"]+)"/g)) {
    const value = match[1]
    if (CJK.test(value)) continue
    if (/^[0-9.\u2014…\- ]+$/.test(value)) continue
    if (CODE_TOKENS.has(value)) continue
    if (/^(https?:|B0X|AMZ-|zby-|Black Friday|Limited Deals|Oatmeal|M|e\.g\.)/.test(value)) continue
    if (/^[\w.$-]+$/.test(value)) continue
    if (EXAMPLE_PLACEHOLDERS.has(value)) continue
    if (!looksLikeCopy(value)) continue
    const line = src.slice(0, match.index).split('\n').length
    attrLeftovers.push(`${file}:${line} · ${value}`)
  }
}
check('no English placeholders left in the admin', attrLeftovers, [])

/* ── 3. 前台红线 ── */
console.log('\n[3] the storefront stays English')

const STOREFRONT_FILES = [
  'src/pages/SelectionPage.jsx',
  'src/components/ProductCard.jsx',
  'src/components/ProductDetail.jsx',
  'src/components/ProductGrid.jsx',
  'src/components/CategoryNav.jsx',
  'src/components/QuantityStepper.jsx',
  'src/components/Toast.jsx',
  'src/utils/deal.js',
  'src/utils/teaser.js',
  'src/utils/acc.js',
  'src/utils/badge.js',
  'src/utils/soldOut.js',
]

const chinese = []
const i18nImports = []
for (const file of STOREFRONT_FILES) {
  const src = read(file)
  if (/i18n\/admin\.js/.test(src)) i18nImports.push(file)
  const code = stripComments(src)
  const line = code.split('\n').findIndex((l) => CJK.test(l))
  if (line >= 0) chinese.push(`${file}:${line + 1} · ${code.split('\n')[line].trim().slice(0, 60)}`)
}
check('no storefront file imports the admin dictionary', i18nImports, [])
check('no Chinese left in storefront code', chinese, [])

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
