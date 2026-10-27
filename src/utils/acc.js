/**
 * ACC（Amazon Creator Connections）佣金
 * ════════════════════════════════════
 * 两个字段，一个开关一个数据：
 *
 *   has_acc  boolean  业务开关 —— 前台出不出角标和佣金卡片
 *   acc_id   text     Campaign ID —— 红人要在亚马逊后台认领活动时用
 *
 * 为什么开关是布尔列（而秒杀没有布尔列）
 * ────────────────────────────────────
 * 秒杀的"开"能从"两个时间非空"推导出来，多一个 is_deal 只会多一处
 * 「关了但时间还在」的中间状态。ACC 没有可推导的东西：Campaign ID 可以是
 * 空的（活动还没批），也可以先填好再开。所以必须有一个独立布尔值回答
 * "现在对红人展示吗"。
 *
 * 为什么 acc_id 不跟着开关清空
 * ──────────────────────────
 * ID 是拿不到第二次的运营资产。误点一次开关就清掉，等于让人回亚马逊后台
 * 重抄一遍。前台只认 `has_acc`，所以关掉依然是真关掉。
 *
 * 纯函数，无 React / 无 supabase —— 后台、前台和 Node 测试共用。
 */

/**
 * 角标：深金底白字。`#7A5C1A` 对 `#FAF8F5` 的对比度 6.2:1，过 WCAG AA，
 * 和 Coming Soon 的石墨、秒杀的砖红、运营自选色都区分得开。
 * `test-acc.mjs` 会把这个值算一遍。
 */
export const ACC_BADGE = {
  /* 纯文字：和「Limited Deal」「Coming Soon」同一条规则，角标里不放图标。
   * 用缩写是因为它现在是**身份行**，要挤在 169px 的卡片左上角，和缩写
   * 「ACC」在后台的用词一致（编辑器里那扇门叫 ACC）。 */
  text: 'ACC',
  value: '#7A5C1A',
  label: 'ACC gold',
}

/**
 * 这个商品是否在展示 ACC 佣金。
 *
 * 只认严格的 `true`：库里可能是 `false`、`null`，或者一个前端补丁里的
 * `'true'` 字符串。用真值判断会把字符串算进去，而它来自哪里没人知道。
 *
 * 注意：只看开关，不看 `accId` 是否为空。活动批下来但 ID 还没抄进来时，
 * 角标照样要出（红人知道有佣金），详情页的卡片会写"ID 待补"。
 *
 * @param {unknown} product
 * @returns {boolean}
 */
export function isAcc(product) {
  return product?.hasAcc === true
}

/**
 * Campaign ID → 去掉首尾空白的字符串；没有就是 `''`。
 *
 * 复制按钮用它判断"有没有东西可复制"，展示也用它，两处同一个值。
 *
 * @param {unknown} product
 * @returns {string}
 */
export function campaignIdOf(product) {
  const raw = product?.accId
  if (raw === undefined || raw === null) return ''
  return String(raw).trim()
}
