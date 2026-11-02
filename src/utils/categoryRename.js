/**
 * 分类改名 / 合并的判定
 * ═══════════════════════
 * 只有两种可能的操作，走的是两条完全不同的 SQL：
 *
 *   rename  改成一个**没人用过**的名字
 *           → `update categories set name = ... where name = ...`
 *             商品靠外键的 `ON UPDATE CASCADE` 自己跟过去；
 *             `sort_order` 留在原来那一行上，所以分类**不会掉到最底**。
 *
 *   merge   改成一个**已经存在**的名字
 *           → 级联只能"跟着改名"，不能"并到另一行"：先把商品挪到目标分类，
 *             再删掉旧行。目标行本来就存在，所以不会新建任何东西。
 *
 * 为什么这个判定要单独抽出来：
 * 一旦判成 merge 而实际上该是 rename，结果就是"旧分类空了、商品跑到一个新行、
 * 新行因为新建而排在最底"—— 而这恰好是 rename 路径**先搬商品**时会发生的事：
 * 商品的 BEFORE UPDATE 触发器 `ensure_category` 会先把新名字插进 categories，
 * 随后那条 UPDATE 撞主键失败。判定写错一次，这个 bug 就回来了。
 *
 * 纯函数，`scripts/test-category-rename.mjs` 直接从 Node 里跑。
 */

/**
 * @param {string} from 旧名字
 * @param {string} to   新名字（会 trim）
 * @param {string[]} names 当前分类列表
 * @returns {{ mode:'noop'|'rename'|'merge', from:string, to:string }}
 */
export function planCategoryRename(from, to, names = []) {
  const source = String(from ?? '').trim()
  const target = String(to ?? '').trim()

  /* 空名字或原地不动：什么都不做（不写库，也不弹错）。 */
  if (!source || !target || target === source) {
    return { mode: 'noop', from: source, to: target }
  }

  const taken = (Array.isArray(names) ? names : []).some(
    (name) =>
      String(name ?? '').trim() !== '' &&
      String(name) !== source &&
      String(name).trim().toLowerCase() === target.toLowerCase(),
  )

  /* 大小写变化（`Tops` → `tops`）不算合并：Postgres 里那是两个不同的主键值，
   * 而 `taken` 已经把"源自己"排除掉了。判成 merge 会变成"删一行、建一行"，
   * 排序同样是掉到底。 */
  return { mode: taken ? 'merge' : 'rename', from: source, to: target }
}
