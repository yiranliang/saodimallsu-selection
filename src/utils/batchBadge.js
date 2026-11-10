/**
 * 批量设置运营标签
 * ═════════════════
 * 后台勾选多件商品，一次性改 `tag` + `badge_color`。纯函数放这里，Node 里可以
 * 直接测；DOM 与请求在 ProductsPage / productStore 里。
 *
 * 为什么只剩下一个字段
 * ────────────────────
 * 以前后台有两个槽位：`sub_tag`（活动标 · 第一行）和 `tag`（普通标 · 第二行），
 * 弹窗还要让运营选"写哪一行"。前台改版之后，图片上不再有任何角标，运营标签
 * 统一渲染成信息区的线框徽章 —— 于是"第一行/第二行"的区分彻底失去意义，
 * 两个槽位合并成一个：**所有运营标签都写 `tag`**，多个标签用逗号分隔。
 *
 * 三条边界，都是被真实用法逼出来的
 * ─────────────────────────────
 * 1. **文字为空 = 没有标签**。颜色单独存在毫无意义（前台只渲染文字），所以
 *    清空文字时颜色一并不写 —— 否则库里会留下一堆"有颜色没文字"的行。
 * 2. **批量只写这两列**。`updateProduct` 会用缓存里的商品重建整行，那对编辑器
 *    是对的（编辑器就是这些字段的主人），对批量是灾难：一个只改了标签的操作
 *    不该有机会覆盖价格、秒杀窗口或库存。
 * 3. **多个标签是一个字符串**。`Bestseller, New` 在库里就是这一串文本，前台
 *    自己切分并最多显示 3 枚（见 `trustBadgesFor`）。不新增表结构。
 */

import { MAX_TAGS, normaliseBadgeColor, normaliseTagList } from './badge.js'

/** 弹窗里的一键文案。只填文字，颜色仍由运营自己挑。 */
export const BATCH_BADGE_QUICK_PICKS = ['Bestseller', 'New', 'Highly Recommend']

/**
 * 标签串的字数上限（3 枚 × 十几个字符足够）。前台是 `truncate` 的小徽章，
 * 超长只是把尾巴截掉，所以干脆在写入前就截断，别让库里躺着显示不全的文案。
 */
export const BATCH_BADGE_MAX = 64

/**
 * 输入 → 将要写入的两个值。
 *
 * - 逗号 / 顿号 / 竖线分隔的多个标签会被规整成 `A, B, C`（去重、最多 3 枚）
 * - 连续空白折叠成一个空格（粘贴表格时常见）
 * - 超过 `BATCH_BADGE_MAX` 字截断
 * - 颜色走 `normaliseBadgeColor`，非法值降级为 ''（= 默认深灰）
 * - **文字为空时颜色也清掉**
 *
 * 两种入参形状都认：原始输入 `{ text, color }`（弹窗里的两个 state），以及
 * 本函数自己的输出 `{ tag, badgeColor }` —— 因为它是**幂等**的，"规整一次再
 * 规整一次"必须是同一个结果。
 *
 * @param {{ text?: unknown, color?: unknown, tag?: unknown, badgeColor?: unknown }} draft
 * @returns {{ tag: string, badgeColor: string }}
 */
export function normaliseBadgeDraft(draft) {
  const tag = normaliseTagList(draft?.text ?? draft?.tag).slice(0, BATCH_BADGE_MAX)
  if (!tag) return { tag: '', badgeColor: '' }
  return { tag, badgeColor: normaliseBadgeColor(draft?.color ?? draft?.badgeColor) }
}

/** 这份草稿点了"应用"之后什么都不会变？ */
export function isBadgeDraftEmpty(draft) {
  return normaliseBadgeDraft(draft).tag === ''
}

/** 这串文本会渲染成几枚徽章（弹窗的预览用）。 */
export function tagCountOf(text) {
  const { tag } = normaliseBadgeDraft({ text })
  return tag ? tag.split(', ').length : 0
}

/** 前台最多显示几枚 —— 弹窗的提示文案读它，不要在别处再写一个数字。 */
export const BATCH_BADGE_MAX_TAGS = MAX_TAGS

/* ── 大促标签（sub_tag） ──
 *
 * 和运营标签是**两件不同的事**：
 *   `tag`      运营属性（Bestseller / New），显示在卡片信息区的线框徽章里；
 *   `sub_tag`  这一批商品属于哪场活动（`Black Friday` / `Cyber Monday`），
 *              **不上卡片**，只用来把商品归进对应的大促专区 Tab（见
 *              `isCampaignDeal`）。黑五换网一，运营改的就是它。
 *
 * 所以它只能"单枚"：活动名不需要逗号列表，也不能被 `normaliseTagList` 切开。
 */
export const CAMPAIGN_QUICK_PICKS = ['Black Friday', 'Cyber Monday']

/**
 * 大促标签输入 → 将要写入的两个值。
 *
 * 单枚、折叠空白、限长；文字为空时颜色一并不写（和运营标签同一条规则）。
 *
 * @param {{ text?: unknown, color?: unknown, subTag?: unknown, subBadgeColor?: unknown }} draft
 * @returns {{ subTag: string, subBadgeColor: string }}
 */
export function normaliseCampaignDraft(draft) {
  const text = String(draft?.text ?? draft?.subTag ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BATCH_BADGE_MAX)
  if (!text) return { subTag: '', subBadgeColor: '' }
  return { subTag: text, subBadgeColor: normaliseBadgeColor(draft?.color ?? draft?.subBadgeColor) }
}

/**
 * 批量弹窗的两个区 → `setProductsBadge` 的两个入参。
 *
 * **防误触的核心**：`writeCampaign` 为 false 时返回的 `sub` 是 `undefined`，
 * 存储层会**完全不碰** `sub_tag` 那一列。也就是说"只改运营标签"的批量操作
 * 永远清不掉运营早上填好的活动名。
 *
 * `badge` 为 `null` 表示这次不写运营标签（只改大促标时会发生）。
 *
 * @param {{ tags?: unknown, color?: unknown, campaign?: unknown, campaignColor?: unknown, writeCampaign?: boolean }} input
 * @returns {{ badge: { tag: string, badgeColor: string } | null, sub?: { subTag: string, subBadgeColor: string } }}
 */
export function planBadgeApply({
  tags,
  color,
  campaign,
  campaignColor,
  writeCampaign = false,
} = {}) {
  const draft = normaliseBadgeDraft({ text: tags, color })
  return {
    badge: draft.tag ? draft : null,
    sub: writeCampaign
      ? normaliseCampaignDraft({ text: campaign, color: campaignColor })
      : undefined,
  }
}
