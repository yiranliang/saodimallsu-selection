/**
 * 限时秒杀（Limited Deal）
 * ════════════════════════════════════
 * 秒杀是一个**时间窗**，不是一个开关：运营填 `sale_start` / `sale_end`，
 * 到点自己开始、到点自己结束。库里没有任何布尔列，所以「关掉秒杀」在后台
 * 就是清空这五个字段（编辑器的开关只负责这件事，见 ProductEditor）。
 *
 * 时间按**浏览器本地时间**解释，不做任何时区换算
 * ────────────────────────────────────────────
 * `2026-10-28T10:00`（不带 Z、不带偏移）在 ES 规范里就是本地时间，
 * 于是「红人手机上的 10:00 开始」而不是「纽约的 10:00」。运营填的是
 * 美国时间字符串，红人在哪就按哪的钟走 —— 这是明确的产品决定：
 * 倒计时是给人看的，不是给数据库看的。要绝对时间就填 `...Z`，
 * 那条会走下面的兜底分支，按 UTC 解析。
 *
 * 为什么不交给 `new Date('2026-10-28 10:00')`
 * ──────────────────────────────────────────
 * V8 认空格，Safari 历史上不认（`Invalid Date`）；`2026/10/28` V8 认、
 * 别的引擎要看脸色。一次解析失败的表现是「秒杀永远不生效」，而且不报错。
 * 所以这里先用一条严格正则自己拆成年月日时分，再用本地时间构造 ——
 * 结果与引擎无关，且 `2026-13-45` 这种会被构造器「进位」的脏值会被
 * 回读校验挡掉（`new Date(2026, 12, 45)` 不会报错，它会变成 2027 年 2 月）。
 *
 * 纯函数，无 React / 无 supabase —— 后台、前台和 Node 测试共用。
 */

import { isTeaser, TEASER_BADGE } from './teaser.js'
import { ACC_BADGE, isAcc } from './acc.js'

/** 五个字段在产品对象上的名字，顺序即编辑器里的顺序。 */
export const DEAL_FIELDS = [
  'saleStart',
  'saleEnd',
  'salePrice',
  'originalPrice',
  'discountLabel',
]

/**
 * 角标：红底白字，与 Coming Soon（石墨）和运营自选色都区分得开。
 * `#C62828` 对白字对比度 5.9:1，过 WCAG AA —— 和 badge.js 里那五枚
 * 快捷模板同一条标准，`test-deal.mjs` 会算一遍。
 */
export const DEAL_BADGE = {
  /* 身份文案，不含图标：`⚡`/`🔥` 这类符号在 10px 的药丸上既抢眼又占宽，
   * 黑五期间一枚「Limited Deal」已经说明了一切。折扣数字单独一行
   * （见 `badgeStackFor`），所以这里不需要再暗示"这是个 deal"。 */
  text: 'Limited Deal',
  value: '#C62828',
  label: 'Deal red',
}

/**
 * 秒杀专区的分类哨兵值。
 *
 * 不是真分类：`filterCatalogue` 按 `product.category` 精确比对，用 `__deals__`
 * 这种不可能撞上真实分类名的值，SelectionPage 里分支处理。用 '⚡ Limited Deals'
 * 当值的话，运营真建一个同名分类就会串。
 */
export const DEALS_TAB = '__deals__'

/**
 * 秒杀专区 Tab 的默认展示名。
 *
 * 运营可以在后台改它（黑五期间叫 `Black Friday Deals`），存 `settings` 表；
 * 这个常量是**没有那一行时的兜底**，也是「Reset」按钮的目标值。
 */
export const DEALS_TAB_DEFAULT_LABEL = 'Limited Deals'

/** 名字长度上限。Tab 是一枚药丸，超过这个长度会把整条分类栏挤出一屏。 */
export const DEALS_TAB_LABEL_MAX = 32

/**
 * 运营输入 → 能存进库、也能直接渲染的字符串。
 *
 * - 折叠连续空白（粘贴过来的名字常带两个空格）
 * - 截断到 32 字
 * - **空字符串返回默认名**：清空输入框点保存，意思就是"恢复默认"，
 *   而不是让前台出现一枚没有文字的空白药丸
 * - emoji 原样保留：黑五加个 🔥 是明确的产品决定，不该被"清洗"掉
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseDealsTabLabel(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return DEALS_TAB_DEFAULT_LABEL
  return Array.from(text).slice(0, DEALS_TAB_LABEL_MAX).join('')
}

/**
 * 活动名归一 —— 只留字母和数字，并剥掉尾部的 "Deals" / "Sale" 这类泛称。
 *
 *   `🔥Black Friday`   → `blackfriday`
 *   `Black Friday Deals` → `blackfriday`
 *   `Limited Deals`    → `limited`
 *   `Limited Deal`     → `limited`
 *
 * 为什么要这么狠：专区 Tab 名是运营自己填的（`settings.deals_tab_label`，
 * 现在库里是 `🔥Black Friday`），而商品身上的大促标是另一个输入框填的
 * （`Black Friday`）。两者**永远不可能逐字相等**，但指的是同一场活动。
 * 用逐字比较判"重复"会 100% 判不出来。
 */
export function campaignKey(value) {
  let key = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  /* 连剥两次：`Black Friday Deals Sale` 这种运营手滑也要归一。
   * 只剥"场次词"，不剥 `off` —— 否则 `50% OFF` 会变成 `50`，和
   * `50` 这种纯数字标撞车。 */
  for (let i = 0; i < 2; i += 1) key = key.replace(/(deals|deal|sales|sale|offers|offer|specials|events)$/, '')
  return key
}

/**
 * 两个名字是不是同一场活动（见 `campaignKey`）。
 *
 * 非拉丁名字（运营把专区叫「黑五专场」）归一后会变成空串，那种情况下退回
 * 原样比较 —— 认不出来是小事，"永远不相等"会让下面那套去重彻底失效。
 */
export function isSameCampaign(a, b) {
  const left = String(a ?? '').trim()
  const right = String(b ?? '').trim()
  if (!left || !right) return false
  const ka = campaignKey(left)
  const kb = campaignKey(right)
  if (ka && kb) return ka === kb
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * 专区顶部的折扣区间。左闭右开，和日期窗口同一套约定：
 * 恰好 20% 属于 20–30，不属于 10–20。
 *
 * 低于 10% 不落任何桶 —— 它是秒杀，但不是"好价"，只在专区的 All 里出现。
 * 这样"点 40%+ 却没看到那件五折"的困惑不会发生。
 */
export const DEAL_BUCKETS = [
  { id: '10-20', label: '10% - 20%', min: 10, max: 20 },
  { id: '20-30', label: '20% - 30%', min: 20, max: 30 },
  { id: '30-40', label: '30% - 40%', min: 30, max: 40 },
  { id: '40+', label: '40%+', min: 40, max: Infinity },
]

const pad2 = (n) => String(n).padStart(2, '0')

/* 2026-10-28T10:00 / 2026-10-28 10:00 / 2026/10/28 10:00:00 / 2026-10-28
 * 秒可省略；日期与时间之间的分隔符 T 或空格皆可；斜杠与短横线皆可。 */
const LOCAL_TIME =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/

/**
 * 时间字符串 → 毫秒时间戳（本地时间）。无法解析返回 `null`，**永不抛异常**。
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseLocalTime(value) {
  if (value === undefined || value === null) return null

  const text = String(value).trim()
  if (!text) return null

  const match = LOCAL_TIME.exec(text)
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
    const y = Number(year)
    const mo = Number(month) - 1
    const d = Number(day)
    const h = Number(hour)
    const mi = Number(minute)
    const s = Number(second)

    if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null

    const date = new Date(y, mo, d, h, mi, s)
    /* 构造器会把越界值「进位」（2 月 31 日 → 3 月 3 日），回读校验挡掉它。
     * 这一步是必要的：静默进位意味着运营填错一天，秒杀早开或晚开一天。 */
    if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null
    if (date.getHours() !== h || date.getMinutes() !== mi) return null

    return date.getTime()
  }

  /* 显式偏移（`...Z`、`...+08:00`）或引擎认得的长格式走这里。 */
  const fallback = new Date(text)
  return Number.isNaN(fallback.getTime()) ? null : fallback.getTime()
}

/**
 * 旧记录里「带具体时刻」的端点。
 *
 * 早期的行是手写进库的，比如 `2026-10-28T10:00`。后台的日期框只认日期，
 * 保存时会重写成 `00:00:00` / `23:59:59`（见 ProductEditor 的 startStamp /
 * endStamp）—— 这是和运营确认过的规范化：一天就是完整的一天，而不是从
 * 早上十点算起。
 *
 * 这个函数只负责**告诉编辑器哪一端会被改写**，好让它在卡片里提前说一声；
 * 没打算改的值不会出现在返回值里，于是同一个提示不会天天挂着。
 *
 * 只有日期、没写时刻的值不算「带具体时刻」——它是运营从日期框里选出来的，
 * 不是手写遗留。带时区偏移（`...Z`、`+08:00`）的值也不算：那需要换算才能
 * 知道本地几点，猜出来的提示比没有更糟。
 *
 * @param {object} product
 * @returns {{start?:string, end?:string}|null} `HH:MM`；两端都已规范 → null
 */
export function legacyDealTimes(product) {
  const out = {}

  const start = explicitTimeOf(product?.saleStart)
  if (start && start !== '00:00:00') out.start = start.slice(0, 5)

  const end = explicitTimeOf(product?.saleEnd)
  if (end && end !== '23:59:59') out.end = end.slice(0, 5)

  return Object.keys(out).length ? out : null
}

/** 值里明确写了的时刻 `HH:MM:SS`；只有日期 / 格式不认识 → `''`。 */
function explicitTimeOf(value) {
  const match = LOCAL_TIME.exec(String(value ?? '').trim())
  if (!match || match[4] === undefined) return ''
  return `${pad2(Number(match[4]))}:${pad2(Number(match[5]))}:${pad2(Number(match[6] ?? 0))}`
}

/**
 * 秒杀窗口。
 *
 * @param {object} product
 * @param {number} [now] 注入时钟——测试与每秒重算的详情页都用它
 * @returns {{ start:number, endsAt:number, active:boolean, msLeft:number }|null}
 *          起止任一解析失败 → null（= 这个商品没有可用的秒杀窗口）
 */
export function dealWindow(product, now = Date.now()) {
  const start = parseLocalTime(product?.saleStart)
  const end = parseLocalTime(product?.saleEnd)
  if (start === null || end === null) return null

  const t = Number(now)
  const clock = Number.isFinite(t) ? t : 0

  /* 左闭右开：写 22:00 就是 22:00:00 整结束。用闭区间的话，运营写
   * 「10:00 到 22:00」会多送一秒，而秒杀文案说的是 22:00 结束。 */
  return {
    start,
    endsAt: end,
    active: clock >= start && clock < end,
    msLeft: Math.max(0, end - clock),
    /* 距离开始还有多久（排期中的倒计时用）。进行中时为 0。 */
    msUntilStart: Math.max(0, start - clock),
  }
}

/**
 * 现在是否在秒杀中。**只认时间**，不看价格——没有折后价的商品照样
 * 出角标，只是不显示价格区（见 dealPriceInfo）。
 *
 * @param {object} product
 * @param {number} [now]
 * @returns {boolean}
 */
export function isDealActive(product, now = Date.now()) {
  return dealWindow(product, now)?.active === true
}

/**
 * 四态：`off`（没有有效窗口）/ `scheduled`（还没开始）/ `live` / `ended`。
 *
 * 为什么要有 `scheduled`：排期中的秒杀**也要给红人看**，让她提前加购，详情页
 * 显示 "Starts in"。只判断"现在是否生效"会让这类商品在专区里凭空消失。
 *
 * @returns {'off'|'scheduled'|'live'|'ended'}
 */
export function dealPhase(product, now = Date.now()) {
  const window = dealWindow(product, now)
  if (!window) return 'off'
  const clock = Number.isFinite(Number(now)) ? Number(now) : 0
  if (clock < window.start) return 'scheduled'
  if (clock < window.endsAt) return 'live'
  return 'ended'
}

/**
 * 编辑器用的一行状态：`off` / `incomplete` / `scheduled` / `live` / `ended`。
 * 保存前的实时预览读它，所以后台看到的就是前台会做的事。
 */
export function dealStatus(product, now = Date.now()) {
  const start = parseLocalTime(product?.saleStart)
  const end = parseLocalTime(product?.saleEnd)

  if (!product?.saleStart && !product?.saleEnd) return 'off'
  if (start === null || end === null) return 'incomplete'
  if (end <= start) return 'invalid'

  const t = Number(now)
  if (t < start) return 'scheduled'
  if (t >= end) return 'ended'
  return 'live'
}

/**
 * 价格展示用的三个字符串。**纯格式化，不看时钟** —— 调用方自己决定
 * 要不要显示（前台只在 `isDealActive` 时用）。
 *
 * 不做 `parseFloat`：`19.99` 存的是文本，换算成浮点再格式化回去有可能
 * 变成 `19.989999999999998`。原样展示，符号只在缺失时补。
 *
 * @returns {{ price:string, was:string, label:string }|null} 无折后价 → null
 */
export function dealPriceInfo(product) {
  const price = formatPriceText(product?.salePrice)
  if (!price) return null
  const discount = discountOf(product)
  return {
    price,
    was: formatPriceText(product?.originalPrice),
    label: discount.label,
    min: discount.min,
    max: discount.max,
    bucket: bucketOf(discount.max),
  }
}

/**
 * `19.99` → `$19.99`；已经带货币符号就原样返回；空值返回 `''`。
 * 认 `$ € £ ¥`，这样以后换站点不用改代码。
 */
export function formatPrice(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /[$€£¥]/.test(text) ? text : `$${text}`
}

/**
 * 毫秒 → `HH:MM:SS`。小时不封顶（3 天的活动写 `71:59:59`），
 * 负值/NaN 归 `00:00:00` —— 倒计时到点就是这个值，界面不会闪出 `-1`。
 *
 * 只给「24 小时以内」用；超过一天的走 `countdownDisplay` 的 days 分支，
 * 否则一个提前一周排期的活动会显示 `167:59:59`，比"还有 6 天"难读得多。
 */
export function formatCountdown(ms) {
  const raw = Number(ms)
  const seconds = Number.isFinite(raw) ? Math.max(0, Math.floor(raw / 1000)) : 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

/** 一天的毫秒数。超过它就是"还有几天"，不是"还有几十小时"。 */
export const COUNTDOWN_DAY_MS = 24 * 60 * 60 * 1000

/** 倒计时上那句前缀。详情页和测试都从这里取，不要各写一份。 */
export const COUNTDOWN_LEAD = {
  scheduled: 'Deal starts in',
  live: 'Deal ends in',
}

/**
 * 倒计时的**显示形态**（纯函数，详情页只负责排版）。
 *
 * 规则来自「防视觉疲劳」这个要求：秒杀可能提前一周排期，那种情况下
 * 秒针每秒跳一下既没有信息量，又让人误以为马上就要开始。
 *
 *   > 24h，排期中   `Deal starts in 6 days`
 *   > 24h，进行中   `6 days left`
 *   ≤ 24h           `Deal ends in 05:12:33`（排期中则是 `Deal starts in …`）
 *
 * 三条边界：
 * - **向下取整**：25 小时是 `1 day`，不是 `2`。差 23 小时的时候突然从
 *   "1 day" 掉到 `23:59:59`，读起来是"马上就结束了"，这正是想要的紧迫感。
 * - **恰好 24h 走时钟**：需求写的是「<= 24 小时才显示 HH:MM:SS」。
 * - **到点/负值 → `00:00:00`**：不返回 null，让调用方在一个 tick 内换成
 *   "已结束"，中间不会闪出一个空行。
 *
 * @param {'live'|'scheduled'|'ended'|'off'} phase
 * @param {number} ms 距离开始或结束的毫秒数
 * @returns {{ mode:'days'|'clock', lead:string, value:string }|null} null = 不显示
 */
export function countdownDisplay(phase, ms) {
  if (phase !== 'live' && phase !== 'scheduled') return null

  const raw = Number(ms)
  const remaining = Number.isFinite(raw) ? raw : 0
  const lead = COUNTDOWN_LEAD[phase]

  if (remaining > COUNTDOWN_DAY_MS) {
    const days = Math.floor(remaining / COUNTDOWN_DAY_MS)
    const unit = days === 1 ? 'day' : 'days'
    /* 进行中说「还有几天」（days left），排期中说「几天后开始」——
     * 同一个数字，两种时态，硬凑成一句会别扭。 */
    return phase === 'scheduled'
      ? { mode: 'days', lead, value: `${days} ${unit}` }
      : { mode: 'days', lead: '', value: `${days} ${unit} left` }
  }

  return { mode: 'clock', lead, value: formatCountdown(remaining) }
}

/**
 * 角标要贴在哪个面上。三个面各有各的规矩，写成常量而不是散落的字符串，
 * 免得某处把 `catalogue` 拼成 `catalog`（那会静默退回默认值）。
 */
export const BADGE_ZONE = {
  /** 常规货架（All / Tops / …）的卡片：身份 + 强推，**不显示折扣**。 */
  CATALOGUE: 'catalogue',
  /** ⚡ 秒杀专区的卡片：整区都在秒杀，所以第一行不再重复 Limited Deal。 */
  DEALS: 'deals',
  /** 详情弹层：完整信息，包括折扣和 ACC。 */
  DETAIL: 'detail',
}

/**
 * 角标栈 —— 卡片和详情共用这一处，避免两边各写一遍然后漂移。
 *
 * 最多两行，**第一行身份、第二行促销**：
 *
 *   第一行  campaign(`sub_tag`)  >  Limited Deal  >  Coming Soon  >  `tag`
 *          （Coming Soon 与秒杀同时存在时 Coming Soon 胜出，见下面的 `!teaser`）
 *   第二行  折扣（`50% OFF`）    >  `tag`（手填的强推标）
 *
 * 四个面的差异（这是本版的重点）：
 *
 * | 面 | 第一行 | 第二行 | ACC |
 * | --- | --- | --- | --- |
 * | `catalogue` 卡片 | campaign / Limited Deal / Coming Soon / tag | 只放 tag | 不显示 |
 * | `deals` 卡片 | campaign / tag（**不出现 Limited Deal**，与专区同名的也不挂） | 折扣 | 不显示 |
 * | `detail` | 同上 + ACC | 折扣 / tag | 显示 |
 *
 * 为什么目录里不显示折扣：货架上的每一件都在被比较，一行 `50% OFF` 会把
 * 视线从「这是什么」拉到「多少钱」，而价格要到专区里才有意义。
 * 为什么专区里不显示 Limited Deal：整个专区都是秒杀，再写一遍是零信息。
 * 为什么卡片上不再有 ACC：佣金是红人**点进去**才需要判断的事，详情页有
 * 一整块 ACC 卡片（含 Campaign ID 和复制按钮），卡片上那枚只是噪音。
 *
 * 活动自己的专区里不重复挂活动名
 * ─────────────────────────────────
 * 进了 `🔥Black Friday` 专区，整屏都是黑五 —— 每张卡再挂一枚 `Black Friday`
 * 是零信息，和当初"专区里不写 Limited Deal"是同一个理由。所以在 `deals` 面
 * 里，`sub_tag` 与 `tag` 只要和专区名是同一场活动（`isSameCampaign`）就当作
 * **没有**，让位给折扣。判定放在身份选择**之前**，这样"大促标被摘掉之后
 * 普通标能不能顶上来"仍然按正常顺序算，不会凭空少一行。
 *
 * 常规货架（`catalogue`）不参与这套去重：在那里 `Black Friday` 不是重复，
 * 是这件商品的关键信息。
 *
 * `Coming Soon` 独占一行：一个不能买的款，"省 40%" 是没有意义的承诺。
 *
 * @param {object} product
 * @param {number} [now]
 * @param {{ zone?: 'catalogue'|'deals'|'detail', campaign?: string }} [options]
 *   `campaign` 是当前专区的活动名（前台传 `settings.dealsTabLabel`），
 *   只在 `deals` 面用于去重；不传就退回旧行为。
 * @returns {Array<{ text:string, value:string, kind:'teaser'|'campaign'|'deal'|'acc'|'tag'|'discount' }>}
 */
export function badgeStackFor(
  product,
  now = Date.now(),
  { zone = BADGE_ZONE.CATALOGUE, campaign: zoneCampaign = '' } = {},
) {
  const teaser = isTeaser(product)
  /* 预告期间的秒杀窗口仍然参与**身份判定**（需求把 Coming Soon 排在秒杀之后），
   * 但它的折扣行会被下面挡掉 —— 一个锁着的款不该宣称省多少钱。 */
  const phase = dealPhase(product, now)
  const dealing = phase === 'live' || phase === 'scheduled'
  const rawTag = String(product?.tag ?? '').trim()
  const rawCampaign = String(product?.subTag ?? '').trim()

  /* 专区自己的名字：只在这一面、且调用方给了名字时才去重。 */
  const ownName = zone === BADGE_ZONE.DEALS ? String(zoneCampaign ?? '').trim() : ''
  const repeatsOwnName = (text) => ownName !== '' && isSameCampaign(text, ownName)

  const tag = repeatsOwnName(rawTag) ? '' : rawTag
  const campaign = repeatsOwnName(rawCampaign) ? '' : rawCampaign
  const discount = dealing ? discountOf(product) : { label: '' }

  /* ── 第一行：身份 ── */
  let identity = null
  if (campaign) {
    identity = { text: campaign, value: product?.subBadgeColor || '', kind: 'campaign' }
  } else if (dealing && !teaser && zone !== BADGE_ZONE.DEALS) {
    /* `!teaser`：预告款不领"Limited Deal"这个身份。需求把秒杀排在 Coming Soon
     * 之前，但那是假设商品在卖 —— 一个买不了的款挂上"限时秒杀"，比挂"省 40%"
     * 更误导（点进去发现尺码全锁着）。大促标仍然可以盖过 Coming Soon，因为
     * 那是运营明确要传达的活动身份。 */
    identity = { text: DEAL_BADGE.text, value: DEAL_BADGE.value, kind: 'deal' }
  } else if (teaser) {
    identity = { text: TEASER_BADGE.text, value: TEASER_BADGE.value, kind: 'teaser' }
  } else if (zone === BADGE_ZONE.DETAIL && isAcc(product)) {
    /* 只看开关，不看 Campaign ID 是否为空 —— ID 还没抄进来时，红人照样
     * 应该知道这单有佣金（详情页的卡片会写"待补"）。 */
    identity = { text: ACC_BADGE.text, value: ACC_BADGE.value, kind: 'acc' }
  } else if (tag) {
    identity = { text: tag, value: product?.badgeColor || '', kind: 'tag' }
  }

  /* Coming Soon 独占：第二行留空（需求原文"独占，不显示第二行"）。 */
  if (identity?.kind === 'teaser') return [identity]

  /* ── 第二行：促销，其次是运营的强推标 ── */
  let secondary = null
  const discountAllowed = zone !== BADGE_ZONE.CATALOGUE && !teaser
  if (discountAllowed && discount.label) {
    secondary = { text: discount.label, value: DEAL_BADGE.value, kind: 'discount' }
  } else if (tag && tag !== identity?.text) {
    secondary = { text: tag, value: product?.badgeColor || '', kind: 'tag' }
  }

  /* 专区里既没有 campaign 也没有 tag 的商品：第一行是空的，把折扣提到
   * 第一行 —— 空着一行再画第二行，视觉上就是"少了点什么"。 */
  if (!identity) return secondary ? [secondary] : []

  return secondary ? [identity, secondary] : [identity]
}

/**
 * 单角标视图 —— **只返回第一行**。
 *
 * 保留这个名字是因为它已经被几处"只要知道是什么身份"的地方用了。
 * 渲染请用 `badgeStackFor`（并且带上 zone）。
 *
 * @returns {{ text:string, value:string, kind:string }|null}
 */
export function badgeFor(product, now = Date.now(), options) {
  return badgeStackFor(product, now, options)[0] || null
}

/**
 * 运营新填一段文字之后，它会落在第几行？
 *
 * 批量改角标弹窗拿这个数字回答"这次操作到底看得见几件"。**两个模式写的是
 * 两个不同的槽位**，所以答案完全不同：
 *
 *   覆盖（第一行）写 `sub_tag`：
 *     `first`  —— 活动标永远第一行，秒杀派生的 Limited Deal 压不住它
 *     `hidden` —— Coming Soon：预告款独占一行，写进去也看不见
 *
 *   追加（第二行）写 `tag`：
 *     `first`  —— 这件商品没有别的身份，普通标就是第一行
 *     `second` —— 已有大促标或秒杀，常规目录里它排第二行
 *     `hidden` —— Coming Soon：独占一行，普通标根本不出现
 *
 * 为什么"秒杀 + 折扣"不再算 `hidden`：那张卡在**常规目录**里第二行是标（目录
 * 不出折扣），而在专区里它自己会升到第一行（Limited Deal 在专区被摘掉）。
 * 两个面都看得见。旧版把这种情况报成"前台看不到"，运营点完发现它明明在，
 * 从此不再相信那个数字 —— 这才是真正要修的 bug。
 *
 * @param {object} product
 * @param {number} [now]
 * @param {{ overwrite?: boolean }} [options] `true` = 这次写的是活动标（第一行）
 * @returns {'first'|'second'|'hidden'}
 */
export function tagPlacementOf(product, now = Date.now(), { overwrite = false } = {}) {
  const teaser = isTeaser(product)
  if (overwrite) return teaser ? 'hidden' : 'first'

  if (teaser) return 'hidden'

  const phase = dealPhase(product, now)
  const dealing = phase === 'live' || phase === 'scheduled'
  const campaign = String(product?.subTag ?? '').trim()
  return campaign || dealing ? 'second' : 'first'
}

/* ───────────────── 折扣：从价格算出来 ─────────────────
 *
 * 运营填的都是**自由文本**：`39.99`、`29.99`，或者区间 `30-50`、`15 - 25`。
 * 后台要自动算出 `25% OFF` / `20% - 50% OFF`，前台要按折扣分桶。
 *
 * 三条原则，写在前面：
 *
 * 1. **不假设格式，只取数字。** 用正则扫出所有数字，不要 parseInt —— 后者
 *    遇到 `15 - 25` 会返回 15，把一条区间悄悄变成"最低价"，折扣算大一倍。
 * 2. **低对低、高对高。** `30-50 → 15-25` 是"这条价格档位整体打了五折"，
 *    不是"30 打 15、50 打 25 之外的所有组合"。交叉配对会算出 17%–70%，
 *    那是数学包络，不是顾客看到的价格。
 * 3. **算不出来就不算。** 返回空字符串，让角标退回 `⚡ Deal`；绝不编一个
 *    "100% OFF" 或者负数出来。
 */

/** 文本里的所有数字。先去掉空格和千分位逗号，再扫。 */
export function numbersOf(value) {
  const text = String(value ?? '').replace(/[\s,]/g, '')
  if (!text) return []
  const out = []
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(match[0])
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * `'15 - 25'` → `{low:15, high:25}`；`'19.99'` → `{low:19.99, high:19.99}`。
 *
 * 用 min/max 而不是"第一个/第二个"：运营手滑写成 `25 - 15` 时，它照样是
 * 15 到 25 的价格带，而不是一条会让折扣变负的倒序区间。
 *
 * @returns {{low:number, high:number}|null}
 */
export function parsePriceRange(value) {
  const nums = numbersOf(value)
  if (!nums.length) return null
  return { low: Math.min(...nums), high: Math.max(...nums) }
}

const clampPercent = (ratio) => Math.min(99, Math.max(0, Math.round(ratio * 100)))

/**
 * 原价 + 折后价 → 折扣百分比区间。
 *
 * @returns {{min:number, max:number}|null} 价格缺失/为 0 → null
 */
export function discountPercents(originalPrice, salePrice) {
  const original = parsePriceRange(originalPrice)
  const sale = parsePriceRange(salePrice)
  if (!original || !sale) return null
  if (original.low <= 0 || original.high <= 0) return null

  /* 最低折后价 ÷ 最低原价 = 最深的那一档；最高 ÷ 最高 = 最浅的。 */
  const deep = clampPercent(1 - sale.low / original.low)
  const light = clampPercent(1 - sale.high / original.high)

  return { min: Math.min(deep, light), max: Math.max(deep, light) }
}

/**
 * `{min:20,max:50}` → `'20% - 50% OFF'`；两端相同 → `'25% OFF'`；
 * 全是 0（价格没便宜）→ `''`。
 */
export function autoDiscountLabel(range) {
  if (!range || !Number.isFinite(range.max) || range.max <= 0) return ''
  if (range.min === range.max || range.min <= 0) return `${range.max}% OFF`
  return `${range.min}% - ${range.max}% OFF`
}

/** 手填标签里的百分比。只认**紧贴 % 的数字**，`2 FOR 50%` 不会被读成 2%。 */
export function parsePercentLabel(text) {
  const raw = String(text ?? '')
  if (!raw.includes('%')) return null
  const out = []
  for (const match of raw.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const n = Number(match[1])
    if (Number.isFinite(n)) out.push(Math.min(99, Math.round(n)))
  }
  if (!out.length) return null
  return { min: Math.min(...out), max: Math.max(...out) }
}

/**
 * 这个商品"实际生效"的折扣 —— 卡片角标、专区分桶、详情标签**共用这一份**。
 *
 * 优先级：运营手填的标签（含 %）> 从价格算出来的 > 没有。
 *
 * 为什么手填的优先：运营在后台覆盖标签就是为了纠正显示；如果分桶仍按价格
 * 走，就会出现"角标写着 50% OFF、商品却在 10%–20% 桶里"的自相矛盾。
 *
 * @returns {{min:number, max:number, label:string, source:'manual'|'computed'|'none'}}
 */
export function discountOf(product) {
  const manualLabel = String(product?.discountLabel ?? '').trim()
  const manual = parsePercentLabel(manualLabel)
  if (manual) return { ...manual, label: manualLabel, source: 'manual' }

  const computed = discountPercents(product?.originalPrice, product?.salePrice)
  if (computed && computed.max > 0) {
    return { ...computed, label: autoDiscountLabel(computed), source: 'computed' }
  }
  return { min: 0, max: 0, label: '', source: 'none' }
}

/** 后台编辑器用：只按价格算，不管手填的标签。 */
export function autoDiscountLabelFor(originalPrice, salePrice) {
  return autoDiscountLabel(discountPercents(originalPrice, salePrice))
}

/**
 * 折扣落在哪个区间（用**最大值**，和你说的"最大折扣力度"一致）。
 * 低于 10% 返回 null —— 它只在专区的 All 里出现。
 *
 * @returns {string|null} `'10-20'` | `'20-30'` | `'30-40'` | `'40+'` | null
 */
export function bucketOf(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return null
  const hit = DEAL_BUCKETS.find((bucket) => n >= bucket.min && n < bucket.max)
  return hit ? hit.id : null
}

/**
 * 专区每个折扣档里有几件 —— 专区顶部那排 chip 上的数字。
 *
 * `all` 是**传入列表的长度**，不保证等于四个档之和：低于 10% 的、没填价
 * 算不出折扣的，都只在 All 里出现（这就是当初"不落任何桶"的决定）。
 * 数字对不上不是 bug，是让那位运营一眼看见"这三件不在任何档里"。
 *
 * 传进来的应该是**已经过搜索**的列表，否则 chip 会承诺一个网格里没有的数。
 *
 * @param {object[]} list
 * @returns {{all:number, '10-20':number, '20-30':number, '30-40':number, '40+':number}}
 */
export function bucketCountsOf(list) {
  const items = Array.isArray(list) ? list : []
  const counts = { all: items.length }
  DEAL_BUCKETS.forEach((bucket) => {
    counts[bucket.id] = 0
  })

  items.forEach((product) => {
    const id = bucketOf(discountOf(product).max)
    if (id) counts[id] += 1
  })

  return counts
}

/**
 * 价格文本 → 展示文本，区间会补上两边的货币符号：
 *   `'19.99'` → `'$19.99'`（原样，不动千分位）
 *   `'15 - 25'` → `'$15 – $25'`
 *
 * 单个数字走 `formatPrice` 保留原文（`1,299` 还是 `$1,299`，不会被重排）。
 */
export function formatPriceText(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const nums = numbersOf(text)
  if (nums.length < 2) return formatPrice(text)
  return `${formatPrice(String(Math.min(...nums)))} – ${formatPrice(String(Math.max(...nums)))}`
}

/**
 * 专区里该出现谁：进行中 + 排期中。已结束的不出现（它已经是普通商品了），
 * 没有窗口的也不出现。
 */
export function filterDeals(list, now = Date.now()) {
  const items = Array.isArray(list) ? list : []
  return items.filter((product) => {
    /* Coming Soon is excluded even mid-window: a discount on something that
     * cannot be bought is not an offer, and a deals tab full of locked cards
     * would read as bait. (The card hides its price for the same reason — see
     * ProductCard.) */
    if (isTeaser(product)) return false
    const phase = dealPhase(product, now)
    return phase === 'live' || phase === 'scheduled'
  })
}

/**
 * 专区内部的顺序：
 *   1. **置顶权重**（`deal_priority` 降序）—— 黑五这类活动要的"主推排前面"；
 *   2. 进行中早于排期中（还能买的排在还没开始的之前）；
 *   3. 组内**越急的越前** —— 进行中按"最快结束"，排期中按"最快开始"；
 *   4. 全同时保持传入顺序（= 后台拖拽序）。
 *
 * 置顶只在**专区内部**生效，常规货架仍按 `sort_order`：货架不该因为一场活动
 * 自己重排。把权重放在时间之前，是因为它是运营的**决定**，而时间是**状态**；
 * 决定优先于状态，否则"我钉住的第一个"会在十分钟后被一件更早结束的商品顶下去。
 *
 * 这也是全站唯一按时间排序的地方。常规目录坚持不按时间排（那会让货架在活动
 * 开始/结束时自己重排）；但"秒杀专区"本身就是一个时间概念，把 10 分钟后
 * 结束的排在一个两天后结束的后面，才是真的反直觉。
 *
 * 稳定排序：`sort` 在现代引擎里是稳定的，但仍然显式用序号兜底 —— 别赌。
 */
export function dealsOrder(list, now = Date.now()) {
  const items = Array.isArray(list) ? list : []
  const live = []
  const scheduled = []

  /* 权重归一：库里是 `not null default 0`，但老数据（迁移前）读回来是
   * undefined，负数也不该把商品压到最后 —— 统一按"0 = 不置顶"处理。 */
  const priorityOf = (product) => {
    const value = Number(product?.dealPriority)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  items.forEach((product, index) => {
    if (isTeaser(product)) return
    const window = dealWindow(product, now)
    if (!window) return
    const priority = priorityOf(product)
    if (window.active) live.push({ product, index, priority, at: window.endsAt })
    else if (window.start > Number(now || 0)) {
      scheduled.push({ product, index, priority, at: window.start })
    }
  })

  const byPriorityThenTime = (a, b) =>
    b.priority - a.priority || a.at - b.at || a.index - b.index

  live.sort(byPriorityThenTime)
  scheduled.sort(byPriorityThenTime)

  return live.concat(scheduled).map((entry) => entry.product)
}
