/**
 * Shop 菜单的分组规则
 * ═══════════════════
 *
 * 导航要两级：大分类（Tops / Bottoms …）→ 展开后才列具体分类。但数据库里的
 * `categories` 只有一层（名字 + 排序），没有"父级"这一列。所以这一层关系先放在
 * 代码里 —— 它其实是**运营的命名习惯**，不是数据：
 *
 *   Tops / Sweatshirts / Jackets & Coats / Long Cardigans / Cropped Cardigans
 *   Bottoms / Sets & Dresses / Accessories / Shoes …
 *
 * 匹配是**按名字**（不区分大小写，允许部分匹配），没匹配上的分类落到「其他」，
 * 保证不会有分类从菜单里消失。
 *
 * 将来如果后台给 `categories` 加一个 `group` 列，把这张表换成读那一列即可，
 * 调用方（`groupShopCategories`）不用改。
 */
export const SHOP_GROUPS = [
  {
    title: 'Tops',
    match: ['tops', 'sweatshirt', 'jacket', 'cardigan', 'pullover', 'blazer', 'vest', 'outerwear', 'shirt'],
  },
  { title: 'Bottoms', match: ['bottoms', 'pants', 'jogger', 'jeans', 'skirt', 'shorts'] },
  { title: 'Sets & Dresses', match: ['sets', 'dress'] },
  { title: 'Accessories', match: ['scarf', 'hat', 'cover-up', 'coverup', 'accessor'] },
  { title: 'Shoes', match: ['shoe', 'boot', 'sandal'] },
]

export const SHOP_FALLBACK_GROUP = 'More'

const lower = (value) => String(value ?? '').toLowerCase()

/** 一个分类名归属哪个组（返回组名，找不到时返回兜底组名）。 */
export function groupOfCategory(name) {
  const value = lower(name)
  if (!value) return SHOP_FALLBACK_GROUP

  for (const group of SHOP_GROUPS) {
    if (group.match.some((needle) => value.includes(needle))) return group.title
  }
  return SHOP_FALLBACK_GROUP
}

/**
 * 把扁平分类列表分组。
 *
 * @param {string[]} categories 分类名（顺序即展示顺序）
 * @param {Record<string, number>} [counts] 每个分类的商品数
 * @returns {{ title: string, total: number, items: { value: string, label: string, count: number }[] }[]}
 */
export function groupShopCategories(categories, counts = {}) {
  const buckets = new Map()

  for (const raw of Array.isArray(categories) ? categories : []) {
    const name = String(raw ?? '').trim()
    if (!name) continue

    const title = groupOfCategory(name)
    if (!buckets.has(title)) buckets.set(title, [])
    buckets.get(title).push({
      value: name,
      label: name,
      count: Number(counts?.[name] ?? 0),
    })
  }

  /* 按 SHOP_GROUPS 的顺序排，兜底组永远在最后 */
  const order = [...SHOP_GROUPS.map((group) => group.title), SHOP_FALLBACK_GROUP]

  return [...buckets.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([title, items]) => ({
      title,
      total: items.reduce((sum, item) => sum + item.count, 0),
      items,
    }))
}
