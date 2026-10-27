/**
 * 商品预告（Teaser / Coming Soon）
 * ════════════════════════════════
 * 预告是**交易状态**，不是角标文案：`is_teaser = true` 的商品前台照常出现
 * （方便红人种草），但尺码锁定、不可加购、不可生成选择码。
 *
 * 为什么单独一个字段而不是复用 `tag`
 * ──────────────────────────────
 * `tag` 是自由文本，运营每天都在改；用它当开关的话，一次文案修改就能让
 * 「不可下单」失效。`isTeaser` 是布尔值，只有一个来源，前台所有锁定逻辑
 * 都读它。
 *
 * 纯函数，无 React / 无 supabase —— 后台、前台和 Node 测试共用。
 */

/** 预告角标：单角标规则下，它优先于商品原本的 New / Best-seller。 */
export const TEASER_BADGE = {
  text: 'Coming Soon',
  // 沉稳的石墨深灰，和默认炭灰(#2B2B2B)区分开，避免与预设色重复。
  value: '#333333',
  label: 'Graphite',
}

/**
 * @param {unknown} product
 * @returns {boolean} 是否处于预告状态（只认严格的 true）
 */
export function isTeaser(product) {
  return product?.isTeaser === true
}

/**
 * Can this product be ordered right now?
 *
 * Two different things can stop it, and they are checked in the same place so
 * no caller can remember one and forget the other:
 *
 *   hidden    — not published at all (drafts, batch imports before photos)
 *   isTeaser  — published on purpose, but locked (Coming Soon)
 *
 * The storefront's first screen must be all-shoppable: a page of things you
 * cannot buy reads as "this shop has no stock" and the creator leaves. That is
 * why `storefrontOrder` sinks both to the back, and why the test asserts
 * `slicePage(order(list), 24).every(isShoppable)`.
 */
export function isShoppable(product) {
  return product?.hidden !== true && !isTeaser(product)
}
