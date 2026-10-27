/**
 * 剪贴板复制工具
 * ──────────────
 * 优先使用现代 Clipboard API，降级到 execCommand
 */

export async function copyToClipboard(text) {
  // 现代 API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 降级
    }
  }

  // 降级方案：创建临时 textarea
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  try {
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    document.body.removeChild(textarea)
    return false
  }
}

/**
 * Download any text content as a file
 * @param {string} filename
 * @param {string} text
 * @param {string} mime
 */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

/**
 * 提取解析结果里的 ASIN 列表
 * ──────────────────────────
 * 纯函数，Node 里可直接测。跳过所有没匹配到 ASIN 的行（`No matching ASIN`），
 * 保留解析顺序（= 选款码里的顺序），并按首次出现去重。
 *
 * 去重是有意的：同一款选了两个颜色但恰好映射到同一个 listing 时，粘进亚马逊
 * 后台的清单里不该出现两行一样的 ASIN。数量差异在页面上本来就看得到，复制
 * 出去的是"要下哪些 listing"，不是"每个下几件"。
 *
 * @param {{ items?: Array<{ asin?: string }> }} result  decodeCode 的返回值
 * @returns {string[]}
 */
export function collectAsins(result) {
  const out = []
  const seen = new Set()
  for (const item of result?.items || []) {
    const asin = typeof item?.asin === 'string' ? item.asin.trim() : ''
    if (!asin || seen.has(asin)) continue
    seen.add(asin)
    out.push(asin)
  }
  return out
}

/**
 * 一行一个 ASIN 的纯文本 —— 不带引号、逗号、序号或商品名。
 * @param {{ items?: Array<{ asin?: string }> }} result
 * @returns {string}  没有任何 ASIN 时返回空字符串
 */
export function asinsToText(result) {
  return collectAsins(result).join('\n')
}

/**
 * 亚马逊商品页前缀。变体级 ASIN 直接拼在后面就是红人能点的那一页。
 */
export const AMAZON_DP = 'https://www.amazon.com/dp/'

/**
 * 单个 ASIN → 商品链接。空值返回空字符串，调用方据此判断"这行没有链接"。
 * @param {string} asin
 * @returns {string}
 */
export function amazonLink(asin) {
  const clean = typeof asin === 'string' ? asin.trim() : ''
  return clean ? `${AMAZON_DP}${clean}` : ''
}

/**
 * 发给红人的清单 —— 一行一个变体，**只有**她能用的信息。
 * ──────────────────────────
 * 格式（她的购物车长什么样，这行就长什么样）：
 *
 *   Long Sleeve Oversized… (White / XL) × 1 - https://www.amazon.com/dp/B0…
 *
 * 三条硬规则，改动前先想清楚：
 *   · 不出现货号（`item.sku`）—— 那是我们内部的拣货码，红人不需要，也不该看到；
 *     因此也没有货号与商品名之间那个 em dash（—）。
 *   · 不出现内部状态（removed / hidden / No matching ASIN）—— 那是后台的判断，
 *     写进聊天窗口只会让她来问"什么是 removed"。
 *   · 链接必须是**该变体**的 ASIN，不是父体：同一款 Black/M 与 White/L 是两条
 *     listing，拼错就会让她买错颜色。
 *
 * 没有 ASIN 的行保留商品名与数量，链接位置写成 `(no ASIN on file)`：宁可让她看到
 * "我们还差一个链接"，也不要悄悄少一行——少一行意味着少一件货。
 *
 * 纯函数，Node 里可直接测（不碰 navigator / document）。
 *
 * @param {{ items?: Array<{ name?: string, specText?: string, qty?: number, asin?: string }> }} result
 * @returns {string} 没有可复制的行时返回空字符串
 */
export function selectionListText(result) {
  const lines = []
  for (const item of result?.items || []) {
    const name = String(item?.name ?? '').trim()
    if (!name) continue

    /* specText 在没有选项时是占位符 '—'，不是真值，别把括号印出来 */
    const options =
      typeof item.specText === 'string' && item.specText && item.specText !== '—'
        ? ` (${item.specText})`
        : ''
    const qty = Number.isFinite(Number(item?.qty)) ? Number(item.qty) : 1
    const link = amazonLink(item?.asin)

    lines.push(`${name}${options} × ${qty} - ${link || '(no ASIN on file)'}`)
  }
  return lines.join('\n')
}

/**
 * 将数据导出为 CSV 并下载
 * @param {string} filename - 文件名
 * @param {Array<Object>} rows - 数据行
 */
export function exportToCSV(filename, rows) {
  if (!rows.length) return

  const headers = Object.keys(rows[0])
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h] ?? ''
          // CSV 转义：含逗号/引号/换行的字段用双引号包裹
          const str = String(val)
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`
          }
          return str
        })
        .join(','),
    ),
  ].join('\n')

  // 添加 BOM 确保中文正确显示
  const bom = '\uFEFF'
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
