/**
 * 删除 / 合并一个规格选项（尺码、颜色）
 * ═══════════════════════════════════
 * `asins.variants` 和 `sold_out_variants` 用的是 `variantKey(colour, size)`，
 * 也就是**选项的文字**。所以"删掉一个尺码"不是界面上少一个 chip 那么简单：
 * 底下那些 `Colour|2XL` 的 ASIN 会变成没人认领的孤儿行；而"把 2XL 改名成
 * XXL"如果只是改文字，结果就是两条记录指向同一个组合、其中一条的 ASIN 永远
 * 显示不出来。
 *
 * 三条规矩：
 *   1. **删除要连带**：确认之后，该选项下的 ASIN 键一起删（这里只算"删哪些"，
 *      真正写库仍然走编辑器原有的 `saveVariantAsins`，不新增写路径）。
 *   2. **合并默认保留目标**：`2XL → XXL` 时，`XXL` 已经有的 ASIN 优先；如果两边
 *      都有且不同，调用方必须让运营选（`conflicts` 就是给弹窗用的），不能替
 *      他决定 —— 选错就是把订单指向另一个 listing，而且要到打包那天才发现。
 *   3. **一次只动一个轴**：改尺码不会碰到颜色那一半，反之亦然。
 *
 * 纯函数，`scripts/test-variant-merge.mjs` 直接从 Node 里跑。
 */

import { splitVariantKey } from './variantRename.js'
import { variantKey } from './sku.js'

/** `colour` → 0（`Colour|Size` 的前半段），其余 → 1（后半段）。 */
export function axisIndex(axis) {
  return axis === 'colour' ? 0 : 1
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/**
 * 这个选项在 variants 里占着哪些键。
 *
 * 空值直接返回空数组：编辑器里"刚点 Add、还没输入"的选项值就是 `''`，把它当
 * 匹配条件会把**所有**没有尺码的组合都算到这个选项头上。
 *
 * @param {Object} variants `{ 'Colour|Size': 'ASIN' }`
 * @param {'colour'|'size'} axis
 * @param {string} value
 * @returns {string[]}
 */
export function keysForOption(variants, axis, value) {
  const target = String(value ?? '').trim()
  if (!target) return []
  const index = axisIndex(axis)
  return Object.keys(variants && typeof variants === 'object' ? variants : {}).filter((key) => {
    const parts = splitVariantKey(key)
    return same(parts[index], target)
  })
}

/** 把键里某个轴的值换掉，另一半原样保留。 */
export function rekeyOnAxis(key, axis, to) {
  const text = String(key ?? '')
  const index = axisIndex(axis)

  /* 没有 `|` 的键（早期单轴地图的遗留）：不知道它指的是颜色还是尺码，
   * 猜错就是把别人的 ASIN 挂到这个选项上，所以原样保留 —— 它会留在编辑器的
   * "早先导入留下的行"里，由人清掉。 */
  if (!text.includes('|')) return text

  const parts = splitVariantKey(text)
  if (parts[index] === '') return text
  parts[index] = String(to ?? '').trim()
  return variantKey(parts[0], parts[1])
}

/**
 * 把一个选项的 ASIN 全部搬到另一个选项上。
 *
 * @param {Object} variants
 * @param {'colour'|'size'} axis
 * @param {string} from 被合并掉的拼写（2XL）
 * @param {string} to   保留的拼写（XXL）
 * @param {{ prefer?: 'to'|'from' }} [options] 冲突时保留哪一边，默认 `to`
 * @returns {{ variants: Object, moves: Array<{from:string,to:string,asin:string}>,
 *             conflicts: Array<{from:string,to:string,fromAsin:string,toAsin:string}> }}
 */
export function mergeOptionAsins(variants, axis, from, to, { prefer = 'to' } = {}) {
  const source = variants && typeof variants === 'object' ? variants : {}
  const out = { ...source }
  const moves = []
  const conflicts = []

  for (const key of keysForOption(source, axis, from)) {
    const nextKey = rekeyOnAxis(key, axis, to)
    if (nextKey === key) continue

    const asin = String(source[key] ?? '')
    const existing = String(out[nextKey] ?? '')

    if (existing && asin && !same(existing, asin)) {
      /* 两边都有、且不是同一个 ASIN —— 记录冲突，等运营选。 */
      conflicts.push({ from: key, to: nextKey, fromAsin: asin, toAsin: existing })
      if (prefer === 'from') out[nextKey] = asin
    } else if (!existing) {
      out[nextKey] = asin
    }

    delete out[key]
    moves.push({ from: key, to: nextKey, asin })
  }

  return { variants: out, moves, conflicts }
}

/**
 * 两张 variants 的差 → 可以直接塞进编辑器 `asinEdits` 的补丁。
 *
 * 为什么走"补丁"而不是整张表覆盖：编辑器保存时把 `mergedAsins` 整份写给
 * `saveVariantAsins`，而 `asinEdits` 是它唯一的编辑层。只记录差量，才能保证
 * 这次合并不会顺手把别的行重写一遍。
 *
 * @param {Object} before
 * @param {Object} after
 * @returns {Object} `{ key: 'ASIN' }`，删掉的键值为 `''`
 */
export function diffVariants(before, after) {
  const a = before && typeof before === 'object' ? before : {}
  const b = after && typeof after === 'object' ? after : {}
  const edits = {}
  for (const key of Object.keys(a)) if (!(key in b)) edits[key] = ''
  for (const [key, value] of Object.entries(b)) if (a[key] !== value) edits[key] = value
  return edits
}
