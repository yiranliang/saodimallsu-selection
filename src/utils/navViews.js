/**
 * 导航视图（Sale / Shop / New / Bestseller / Holiday Picks）
 * ═════════════════════════════════════════════════════════
 * `Sale` 和 `Shop` 走现有字段（`sale_*` / `category`），这里只负责三个**标签视图**。
 *
 * 为什么先建索引再过滤：
 *   目录常驻内存（~300 件），但每次重渲染都 `tag.toLowerCase().includes(…)`
 *   等于把同样的字符串处理做上百遍 —— 搜索框每敲一个字都会重跑一次。
 *   `buildTagIndex` 只在目录数组被替换时（realtime / 后台编辑 / 首载）跑一遍，
 *   产出三个 `Set<productId>`；之后切视图只是 `set.has(id)`，O(1)。
 *
 * 为什么是 token 匹配而不是裸 `includes`：
 *   `'Newest'` / `'Renew'` 会把 `new` 误判进来。先把 `tag` 按后台惯用的分隔符
 *   切成词（`Bestseller, New` 是两枚），再逐词比较，和卡片上渲染的徽章一致。
 */

/** 三个标签视图的 id —— 用 `__` 前缀避免和真实分类名撞车。 */
export const TAG_VIEW = {
  NEW: '__new',
  BESTSELLER: '__bestseller',
  HOLIDAY: '__holiday',
}

export const TAG_VIEW_LIST = [TAG_VIEW.NEW, TAG_VIEW.BESTSELLER, TAG_VIEW.HOLIDAY]

/** 节日专区的默认名。运营可以在后台改成 `Christmas Shop` / `Spring Picks`。 */
export const HOLIDAY_TAB_DEFAULT_LABEL = 'Holiday Picks'

/**
 * 任意输入 → 一个能上屏的专区名。
 *
 * 空值 / 全空白 → 回默认名（不要留一个空 Tab 在导航上）；折叠内部空白、限长 24，
 * 因为它是顶栏里一个菜单项，太长会把别的项挤走。
 */
export function normaliseHolidayLabel(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
  return text || HOLIDAY_TAB_DEFAULT_LABEL
}

/** 节日视图认的词（大小写无关的子串匹配）。运营怎么写都能收进来。
 *
 * 中文那两枚写成 `\u` 转义：前台源码有"零汉字"红线（`test-admin-i18n` 会扫），
 * 但它们确实是运营会填进 `tag` 的词（"圣诞特选"），所以必须保留语义、只换成转义。 */
export const HOLIDAY_KEYWORDS = [
  'holiday',
  'christmas',
  'xmas',
  'festive',
  '\u5723\u8bde', // 圣诞
  '\u8282\u65e5', // 节日
]

/** 节日开关写进去的那枚 token（大小写照写，展示用）。 */
export const HOLIDAY_TOKEN = 'Holiday'

/**
 * `tag` → 原始大小写的词数组（去空、去重、保序）。
 *
 * `tagTokens` 是给匹配用的（全小写），这个是给编辑器做增删用的 ——
 * 运营写的 `Bestseller` 不该被改写成 `bestseller`。
 */
export function splitTagList(tag, max = 3) {
  const parts = String(tag ?? '')
    .split(/[,，、|]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const out = []
  for (const part of parts) {
    if (out.some((token) => token.toLowerCase() === part.toLowerCase())) continue
    out.push(part)
    if (out.length >= max) break
  }
  return out
}

/** 这串标签里有没有节日词（决定"节日特选"开关是开还是关）。 */
export function hasHolidayTag(tag) {
  return splitTagList(tag, 99).some((token) => isHolidayToken(token.toLowerCase()))
}

/**
 * 拨动"节日特选"开关：开 → 追加一枚 `Holiday`；关 → 摘掉所有节日词。
 *
 * 写的是固定的 `Holiday` 而不是运营自定义的专区名：后者随时会改（圣诞 → 春季），
 * 而 `holiday` 本身就在关键词表里，所以换季改名不影响这枚标记。
 */
export function toggleHolidayTag(tag, on) {
  const tokens = splitTagList(tag, 99).filter(
    (token) => !isHolidayToken(token.toLowerCase()),
  )
  if (on) tokens.push(HOLIDAY_TOKEN)
  return tokens.slice(0, 3).join(', ')
}

/** 「Featured for You」整屏视图：不按分类/标签筛，只显示随机推荐。 */
export const FEATURED_VIEW = '__featured__'

/** 推荐位默认展示多少件，以及滑块的上下限/步长。 */
export const FEATURED_SIZE_DEFAULT = 24
export const FEATURED_SIZE_MIN = 4
export const FEATURED_SIZE_MAX = 48
export const FEATURED_SIZE_STEP = 4

/** 把滑块的任意输入夹到合法值（4/8/…/48 的整数）。 */
export function clampFeaturedSize(value) {
  const n = Math.round(Number(value) || FEATURED_SIZE_DEFAULT)
  const stepped =
    Math.round((n - FEATURED_SIZE_MIN) / FEATURED_SIZE_STEP) * FEATURED_SIZE_STEP +
    FEATURED_SIZE_MIN
  return Math.min(FEATURED_SIZE_MAX, Math.max(FEATURED_SIZE_MIN, stepped))
}

/** 「选了多个分类」的视图 id（单个分类仍然直接用分类名）。 */
export const MULTI_CATS = '__multi_cats__'

/** `is this a tag view, or a real category?` */
export function isTagView(value) {
  return TAG_VIEW_LIST.includes(value)
}

/**
 * `tag` → 小写词数组。分隔符和成品徽章一致（逗号 / 顿号 / 竖线）。
 *
 * @param {object} product
 * @returns {string[]}
 */
export function tagTokens(product) {
  const raw = String(product?.tag ?? '')
  if (!raw) return []
  return raw
    .split(/[,，、|]/)
    .map((part) => part.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
}

/** `Best-seller` / `Best Seller` / `bestseller` 都算爆款。 */
function isBestsellerToken(token) {
  const flat = token.replace(/[^a-z0-9]/g, '')
  return flat.startsWith('bestseller') || flat.startsWith('bestselling')
}

/** `new` / `new in` / `new arrival` 算新品，`newest` 不算。 */
function isNewToken(token) {
  return token === 'new' || token.startsWith('new ')
}

function isHolidayToken(token) {
  return HOLIDAY_KEYWORDS.some((word) => token.includes(word))
}

/**
 * 一次遍历，把三个视图的 id 收进 Set。
 *
 * 调用方只在 `catalogue` 变化时重算（`useMemo([catalogue])`）—— 目录数组每次
 * 刷新都是新对象，所以后台改完标签后索引自然跟着更新，不需要手动失效。
 *
 * @param {object[]} products
 * @returns {{ new: Set<string>, bestseller: Set<string>, holiday: Set<string> }}
 */
export function buildTagIndex(products) {
  const index = {
    [TAG_VIEW.NEW]: new Set(),
    [TAG_VIEW.BESTSELLER]: new Set(),
    [TAG_VIEW.HOLIDAY]: new Set(),
  }

  for (const product of Array.isArray(products) ? products : []) {
    const id = String(product?.id ?? '')
    if (!id) continue
    /* 节日专区现在由 `is_holiday` 这一列决定（和标签解耦）；
     * 关键词兜底保留，历史数据里还写着 Holiday 的那些照样能命中。 */
    if (product?.isHoliday === true) index[TAG_VIEW.HOLIDAY].add(id)

    for (const token of tagTokens(product)) {
      if (isNewToken(token)) index[TAG_VIEW.NEW].add(id)
      if (isBestsellerToken(token)) index[TAG_VIEW.BESTSELLER].add(id)
      if (isHolidayToken(token)) index[TAG_VIEW.HOLIDAY].add(id)
    }
  }

  return index
}

/**
 * 这件商品算不算某个标签视图。
 *
 * 抽出来是因为后台的「按标签筛选」也要同一套规则 —— 否则前台标成 New、
 * 后台筛不出来，两边就开始互相甩锅。
 *
 * @param {object} product
 * @param {string} view TAG_VIEW.*
 * @returns {boolean}
 */
export function matchesTagView(product, view) {
  /* 节日是独立开关（`is_holiday`），标签里那枚 Holiday 只是历史兜底。 */
  if (view === TAG_VIEW.HOLIDAY) {
    if (product?.isHoliday === true) return true
    return tagTokens(product).some(isHolidayToken)
  }

  const tokens = tagTokens(product)
  if (!tokens.length) return false
  if (view === TAG_VIEW.NEW) return tokens.some(isNewToken)
  if (view === TAG_VIEW.BESTSELLER) return tokens.some(isBestsellerToken)
  return false
}

/** 这个视图里有几件（导航上的数字）。 */
export function tagViewCount(index, view) {
  return index?.[view]?.size || 0
}

/**
 * 按视图筛商品，**保持目录顺序**（排序/分页在后面统一做）。
 *
 * @param {object[]} products
 * @param {string} view  TAG_VIEW.*
 * @param {object} index buildTagIndex 的结果
 * @returns {object[]} 视图不认识时返回空数组（而不是悄悄全量返回）
 */
export function tagViewProducts(products, view, index) {
  const set = index?.[view]
  if (!set) return []
  return (Array.isArray(products) ? products : []).filter((product) =>
    set.has(String(product?.id ?? '')),
  )
}
