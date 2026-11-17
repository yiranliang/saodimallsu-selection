/**
 * 秒杀档期（一件商品多档期）
 * ═════════════════════════
 *
 * 一个货号在 `deals` 表里可以有多行 —— 今天、后天、大后天各打折一次。
 * 前台永远只需要**一个**时间窗，所以这里的核心是一个选择：
 *
 *   1. 有进行中的档期 → 用「结束得最晚」的那一档（叠期时以它为准）
 *   2. 没有进行中的   → 用「开始得最早」的下一档（预告价）
 *   3. 全都结束了     → 没有秒杀
 *
 * 为什么「结束得最晚」而不是「开始得最晚」：两档叠在一起时（运营导重了），
 * 用户关心的是"这个价还能挂多久"，而不是"哪一档刚开"。反过来选会让卡片上的
 * 倒计时突然跳回更早的结束时间。
 *
 * 纯函数：不碰网络、不碰时钟，`now` 由调用方传入 —— 于是这一整套可以在
 * Node 里直接测（scripts/test-deal-slots.mjs）。
 */

/** 把一条 deals 行的 snake_case 映射成前台的 camelCase，并解析成毫秒。 */
export function slotOf(row) {
  if (!row || typeof row !== 'object') return null

  const start = toMs(row.saleStart ?? row.sale_start)
  const end = toMs(row.saleEnd ?? row.sale_end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null

  return {
    sku: String(row.sku ?? '').trim(),
    start,
    end,
    salePrice: row.salePrice ?? row.sale_price ?? '',
    originalPrice: row.originalPrice ?? row.original_price ?? '',
    isCampaign: Boolean(row.isCampaign ?? row.is_campaign),
    subTag: String(row.subTag ?? row.sub_tag ?? ''),
    discountLabel: String(row.discountLabel ?? row.discount_label ?? ''),
  }
}

function toMs(value) {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const text = String(value ?? '').trim()
  if (!text) return Number.NaN
  /* 只有日期（2026-11-20）时按本地 00:00 处理，和后台输入框一致。 */
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text)
  return parsed.getTime()
}

/**
 * 从一堆档期里挑出"现在生效的那一个"。
 *
 * @param {Array<object>} slots 已经 `slotOf` 过的数组（顺序无所谓）
 * @param {number} now
 * @returns {object|null}
 */
export function effectiveSlot(slots, now = Date.now()) {
  const list = Array.isArray(slots) ? slots.filter(Boolean) : []
  if (!list.length) return null

  const at = Number(now)

  let live = null
  let next = null

  for (const slot of list) {
    if (slot.start <= at && slot.end > at) {
      if (!live || slot.end > live.end) live = slot
    } else if (slot.start > at) {
      if (!next || slot.start < next.start) next = slot
    }
  }

  return live || next || null
}

/**
 * 把选中的档期写回商品形状 —— 前台其余代码（筛选 / 折扣 / 倒计时 / 排序）
 * 读的都是 product 上的 sale* 字段，所以这里**不改它们的读取方式**，只把
 * "这件商品此刻的档期"铺到那几个字段上。
 *
 * 没有任何档期时返回原对象（不制造新引用，便于 memo 比较）。
 */
export function withEffectiveSlot(product, slot) {
  if (!product || !slot) return product
  return {
    ...product,
    saleStart: toLocalInput(slot.start),
    saleEnd: toLocalInput(slot.end),
    salePrice: slot.salePrice,
    originalPrice: slot.originalPrice,
    isCampaign: slot.isCampaign,
    subTag: slot.subTag || product.subTag || '',
    /* 档期自己的折扣文案优先：档期页 editable，商品上那份是导入时的快照。 */
    discountLabel: slot.discountLabel || product.discountLabel || '',
    /* 一件商品有几个档期 —— 后台列表可以显示"3 档"，前台不用。 */
    slotCount: Array.isArray(product.slotCount) ? product.slotCount : undefined,
  }
}

/** 毫秒 → `YYYY-MM-DDTHH:mm`（后台输入框和 `parseLocalTime` 认这个格式）。 */
function toLocalInput(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`
}

/**
 * 给整本目录铺上各自的档期。
 *
 * @param {Array<object>} products
 * @param {Object<string, Array<object>>} slotsBySku  sku → 档期数组
 * @param {number} now
 * @returns {Array<object>} 新数组；没有档期的商品原样返回
 */
export function applyDealSlots(products, slotsBySku, now = Date.now()) {
  const list = Array.isArray(products) ? products : []
  if (!slotsBySku || typeof slotsBySku !== 'object') return list.slice()

  return list.map((product) => {
    const key = String(product?.sku ?? '').trim()
    const slots = slotsBySku[key]
    if (!slots || !slots.length) return product
    return withEffectiveSlot(product, effectiveSlot(slots, now))
  })
}
