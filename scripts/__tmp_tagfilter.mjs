import { readFileSync, writeFileSync } from 'node:fs'

const patch = (file, pairs) => {
  let text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`not found in ${file}: ${from.slice(0, 70)}`)
    text = text.split(from).join(to)
  }
  writeFileSync(file, text.replace(/\n/g, '\r\n'), 'utf8')
  console.log('ok', file)
}

/* ── 1. navViews：把三个判定合成一个按视图判断的函数（前台用它建索引，
 *     后台的标签筛选复用它，规则只有一份）。 ── */
patch('src/utils/navViews.js', [
  [
    '/** 这个视图里有几件（导航上的数字）。 */',
    [
      '/**',
      ' * 这件商品算不算某个标签视图。',
      ' *',
      ' * 抽出来是因为后台的"按标签筛选"也要同一套规则 —— 否则前台标成 New、',
      ' * 后台筛不出来，两边就开始互相甩锅。',
      ' *',
      ' * @param {object} product',
      ' * @param {string} view TAG_VIEW.*',
      ' * @returns {boolean}',
      ' */',
      'export function matchesTagView(product, view) {',
      '  const tokens = tagTokens(product)',
      '  if (!tokens.length) return false',
      '  if (view === TAG_VIEW.NEW) return tokens.some(isNewToken)',
      '  if (view === TAG_VIEW.BESTSELLER) return tokens.some(isBestsellerToken)',
      '  if (view === TAG_VIEW.HOLIDAY) return tokens.some(isHolidayToken)',
      '  return false',
      '}',
      '',
      '/** 这个视图里有几件（导航上的数字）。 */',
    ].join('\n'),
  ],
])

/* ── 2. adminFilter：新增 tagView / tagQuery ── */
patch('src/utils/adminFilter.js', [
  [
    "/** One product against one category name. A blank filter matches everything. */",
    [
      '/** 后台标签筛选的哨兵值：不加限制 / 只看"没有标签"的商品。 */',
      "export const ALL_TAGS = 'all'",
      "export const NO_TAG = 'none'",
      '',
      '/**',
      ' * 标签筛选：视图（New / Bestseller / Holiday）+ 自由文本。',
      ' *',
      ' * 视图用 `matchesTagView`（和前台共用一份规则）；文本是"标签里包含这段字"，',
      ' * 大小写无关 —— 运营想找 `best` 就能把 `Bestseller`、`Best-seller` 一起捞出来。',
      ' * 两个条件是 AND。',
      ' */',
      'function matchesTagFilter(product, tagView, tagQuery) {',
      '  if (tagView === NO_TAG) {',
      '    if (tagTokens(product).length) return false',
      '  } else if (tagView && tagView !== ALL_TAGS && !matchesTagView(product, tagView)) {',
      '    return false',
      '  }',
      '',
      '  const needle = String(tagQuery ?? \'\').trim().toLowerCase()',
      '  if (!needle) return true',
      "  const raw = String(product?.tag ?? '').toLowerCase()",
      '  return raw.includes(needle) || tagTokens(product).some((token) => token.includes(needle))',
      '}',
      '',
      '/** One product against one category name. A blank filter matches everything. */',
    ].join('\n'),
  ],
  [
    "import { tagTokens } from './navViews.js'",
    "import { tagTokens } from './navViews.js'",
  ],
])
