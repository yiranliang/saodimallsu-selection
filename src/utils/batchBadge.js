/**
 * 批量改角标（Batch badge）
 * ═════════════════════════
 * 后台勾选多件商品，一次性改 `tag` + `badge_color`。纯函数放这里，Node 里
 * 可以直接测；DOM 与请求在 ProductsPage / productStore 里。
 *
 * 三条边界，都是被真实用法逼出来的
 * ─────────────────────────────
 * 1. **文字为空 = 没有角标**。颜色单独存在毫无意义（前台只渲染 `tag`），
 *    所以清空文字时颜色一并不写 —— 否则库里会留下一堆"有颜色没文字"的行。
 * 2. **批量只写这两列**。`updateProduct` 会用缓存里的商品重建整行，那对
 *    编辑器是对的（编辑器就是这些字段的主人），对批量是灾难：一个只改了
 *    角标的操作不该有机会覆盖价格、秒杀窗口或库存。
 * 3. **角标不是唯一会显示的东西**。前台左上角是一个两行角标栈
 *    （`badgeStackFor`）：身份在上、折扣在下。所以运营填的这段文字落在
 *    第几行，取决于他要的是"第二行的普通标"还是"第一行的活动标"——
 *    弹窗直接让他在两行里选（`BADGE_WRITE_MODES`），并且事先报出
 *    每一行各有几件（`placementCountsOf`）。
 */

import { tagPlacementOf } from './deal.js'
import { normaliseBadgeColor } from './badge.js'

/** 弹窗里的一键文案。只填文字，颜色仍由运营自己挑。 */
export const BATCH_BADGE_QUICK_PICKS = ['Black Friday', 'Cyber Monday', '50% OFF']

/**
 * 角标字数上限。前台是 `truncate` 的小药丸，超过这个长度只是把尾巴截掉，
 * 所以干脆在写入前就截断，别让库里躺着显示不全的文案。
 */
export const BATCH_BADGE_MAX = 32

/**
 * 输入 → 将要写入的两个值。
 *
 * - 连续空白折叠成一个空格（粘贴表格时常见）
 * - 超过 32 字截断
 * - 颜色走 `normaliseBadgeColor`，非法值降级为 ''（= 默认石墨底）
 * - **文字为空时颜色也清掉**
 *
 * 两种入参形状都认：原始输入 `{ text, color }`（弹窗里的两个 state），以及
 * 本函数自己的输出 `{ tag, badgeColor }`。
 *
 * 为什么必须都认：这个函数是**幂等**的，所以"规整一次再规整一次"必须是同一个
 * 结果。曾经它只认 `{ text }`，而弹窗把已规整的 `{ tag }` 传回页面、页面又规整
 * 了一次 —— 结果 tag 变成空串，批量改角标**一个都没写进去**，toast 还显示
 * 「已把 41 件商品的活动标设为「」」。收敛一种形状比容忍两种形状更脆：任何一次
 * 传参改动都会静默清空，而且前台的表现只是"角标不见了"。
 *
 * 兼容形状 `{ tag }` 只是兜底；调用方仍应传原始输入。
 *
 * @param {{ text?: unknown, color?: unknown, tag?: unknown, badgeColor?: unknown }} draft
 * @returns {{ tag: string, badgeColor: string }}
 */
export function normaliseBadgeDraft(draft) {
  const raw = String(draft?.text ?? draft?.tag ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const tag = raw.slice(0, BATCH_BADGE_MAX)
  if (!tag) return { tag: '', badgeColor: '' }
  return { tag, badgeColor: normaliseBadgeColor(draft?.color ?? draft?.badgeColor) }
}

/** 这份草稿点了"应用"之后什么都不会变？ */
export function isBadgeDraftEmpty(draft) {
  const { tag } = normaliseBadgeDraft(draft)
  return tag === ''
}

/**
 * 三种落位各有多少件。
 *
 * 弹窗要回答的是"我点应用之后，到底几件看得见"（以**常规目录**为准，
 * 批量挂的黑五标就是给货架看的）：
 *
 *   first  —— 它会是第一行
 *   second —— 已有大促标或秒杀，它排在第二行
 *   hidden —— 完全看不见（Coming Soon 独占一行）
 *
 * 三个数字一起给，运营才能自己决定"要不要改成第一行模式"。
 *
 * @param {object[]} products
 * @param {number} [now]
 * @param {{ mode?: 'append'|'overwrite' }} [options] 模式决定写哪个槽位：
 *   覆盖写活动标（第一行），追加写普通标（第二行）
 * @returns {{ first:number, second:number, hidden:number }}
 */
export function placementCountsOf(products, now = Date.now(), { mode = 'append' } = {}) {
  const counts = { first: 0, second: 0, hidden: 0 }
  const list = Array.isArray(products) ? products : []
  const overwrite = mode === 'overwrite'
  for (const product of list) counts[tagPlacementOf(product, now, { overwrite })] += 1
  return counts
}

/**
 * 选中的商品里，有多少件**不会被顶到第一行**（= second + hidden）。
 *
 * 保留这个函数是因为弹窗的提示文案只需要这一个数：剩下的细节写在
 * `placementCountsOf` 的三行分解里。
 *
 * @param {object[]} products
 * @param {number} [now]
 * @returns {number}
 */
export function maskedCountOf(products, now = Date.now()) {
  const { second, hidden } = placementCountsOf(products, now)
  return second + hidden
}

/**
 * 批量写角标的两种模式 —— 本质上就是**写哪一行**。
 *
 * 前台的角标只有两行（`badgeStackFor`）：第一行是身份（大促标 / Limited Deal
 * / Coming Soon），第二行是促销（折扣 / 普通标）。库里对应两个槽位：
 *
 *   `sub_tag`  = 大促标 = 第一行，秒杀派生的 Limited Deal 压不住它
 *   `tag`      = 普通标 = 第二行，已有身份时排在下面，没有身份时自己就是第一行
 *
 * 所以弹窗不让运营猜"我的字会落到第几行"，直接给两行让他选：
 *
 * - `append`（第二行）：新文案写进 `tag`，**不动**已有的大促标。
 *   大多数批量操作是这个意思（"这批货都加一句 Highly Recommend"）。
 * - `overwrite`（第一行）：新文案写进 `sub_tag`，替换原有的大促标（原来的
 *   普通标不动）。黑五前把整批货统一挂成 `Black Friday`，用这个。
 *
 * 旧的 `overwrite` 是"清掉大促标 + 把字写进 `tag`"，结果正在秒杀的商品第一行
 * 永远是 Limited Deal，弹窗却承诺"新文案就是第一行" —— 实机上就是"我选了
 * 覆盖，卡片上还是 Limited Deal"。写对槽位才叫覆盖。
 *
 * 两者都只碰角标那四列，不碰价格、库存、秒杀窗口 —— 和 `setProductsBadge`
 * 的隔离原则一致。
 */
export const BADGE_WRITE_MODES = [
  {
    id: 'append',
    label: '第二行 · 普通标',
    labelEn: 'Second line · plain badge',
    hint: '写进普通标。已有大促标/秒杀的商品，它排在下面；没有的，它就是第一行。不动大促标。',
  },
  {
    id: 'overwrite',
    label: '第一行 · 活动标',
    labelEn: 'First line · campaign badge',
    hint: '写进大促标，替换原来的大促标 —— 秒杀派生的 Limited Deal 压不住它。',
  },
]

/**
 * 模式 + 输入 → 这一次到底要写哪几列。
 *
 * 把"写什么"从页面里抽出来的原因很实际：这段逻辑一旦写错，症状是"后台说
 * 改成功了、前台什么也没变"，而它又藏在三千行的页面里，没有测试能碰到。
 *
 * @param {'append'|'overwrite'} mode
 * @param {{ tag?: string, badgeColor?: string }} badge `normaliseBadgeDraft` 之后的值
 * @param {{ subTag?: string, subBadgeColor?: string }|undefined} sub
 *   追加模式下的可选大促标（勾了"同时设置大促标"才有）；覆盖模式下忽略
 * @returns {{
 *   badge: { tag: string, badgeColor: string },
 *   touchTag: boolean,
 *   sub?: { subTag: string, subBadgeColor: string },
 * }} `setProductsBadge` 的三个入参
 */
export function badgeWriteFor(mode, badge, sub) {
  const tag = String(badge?.tag ?? '').trim()
  const badgeColor = normaliseBadgeColor(badge?.badgeColor)

  if (mode === 'overwrite') {
    return {
      /* 只写活动标那一列。原来的**普通标不动** —— 覆盖的意思是"这枚成为第一行
       * 的身份"，不是"把这件商品的其他信息删掉"。清空是另一个按钮的事。 */
      badge: { tag: '', badgeColor: '' },
      touchTag: false,
      sub: { subTag: tag, subBadgeColor: badgeColor },
    }
  }

  return {
    badge: { tag, badgeColor },
    /* 文字为空 = 这次不写普通标（只可能是在单独改大促标），
     * 不能拿空字符串把它清掉。 */
    touchTag: Boolean(tag),
    sub: sub || undefined,
  }
}
