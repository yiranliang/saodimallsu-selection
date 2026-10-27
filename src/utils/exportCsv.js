/**
 * 全量商品导出 CSV
 * ══════════════════════════
 *
 * 目的：让运营把整本商品导进 Google Sheets，用 `=IMAGE()` 一眼看完整面
 * 图片墙。所以输出面向**表格消费**，不是面向再导入（再导入走 Import 那套
 * 带表头校验的流程）。
 *
 * 九列，顺序固定：
 *   货号 | 商品名 | 分类 | 主图链接 | 所有颜色 | 所有尺码 | 当前角标 | 秒杀状态 | ACC_ID
 *
 * 设计决定：
 * - UTF-8 带 BOM：Excel / Google Sheets 打开中文（分类、颜色名）不乱码。
 *   没有 BOM 时 Excel 会按 GBK 猜，中文列全是问号。
 * - 颜色 / 尺码用 ` | ` 分隔在一格里：一张表一行一个商品，而不是一行一个
 *   变体。这样 `=IMAGE()` 每行一张图，不会重复铺开。
 * - 秒杀状态用 `dealStatus` 的六态（off/scheduled/live/ended/incomplete/
 *   invalid），而不是拼"开始于…结束于…"——导出的表是给人扫一眼用的，
 *   一个词比一段话快。
 *
 * 纯函数：`buildExportCsv(products, now)` 返回字符串，Node 可直接测。
 */

import { dealStatus } from './deal.js'

/** 颜色 / 尺码这类数组列的内部分隔符。选一个几乎不可能出现在商品名里的
 *  字符组合。 */
const JOIN = ' | '

/** CSV 转义：含逗号、引号、换行的字段用双引号包起来，内部引号翻倍。 */
function csvCell(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const HEADER = ['货号', '商品名', '分类', '主图链接', '所有颜色', '所有尺码', '当前角标', '秒杀状态', 'ACC_ID']

/** specs 是 `{ Colour: [...], Size: [...] }`；把所有维度的选项展平成一个
 *  分隔串。维度顺序跟 `Object.keys` 一致（= 编辑器里定义的顺序）。 */
function allOptions(specs) {
  if (!specs || typeof specs !== 'object') return ''
  return Object.entries(specs)
    .map(([, options]) => (Array.isArray(options) ? options : []).map(String).join(JOIN))
    .filter(Boolean)
    .join(JOIN)
}

/**
 * 单个商品 → 一行九个单元格的数组（未转义）。
 *
 * @param {object} product  缓存里的产品对象（已 normalizeProduct）
 * @param {number} now      毫秒时间戳，秒杀状态以这个时刻算
 * @returns {string[]}
 */
export function productToCsvRow(product, now = Date.now()) {
  const specs = product?.specs || {}
  return [
    product?.sku || '',
    product?.name || '',
    product?.category || '',
    product?.image || '',
    allOptions({ Colour: specs.Colour }),
    allOptions({ Size: specs.Size }),
    product?.tag || '',
    dealStatus(product, now),
    product?.accId || '',
  ]
}

/**
 * 商品列表 → 完整 CSV 文本（含表头、含 BOM）。
 *
 * @param {Array<object>} products
 * @param {number} [now]
 * @returns {string}
 */
export function buildExportCsv(products, now = Date.now()) {
  const rows = [
    HEADER.map(csvCell).join(','),
    ...(Array.isArray(products) ? products : []).map((product) =>
      productToCsvRow(product, now).map(csvCell).join(','),
    ),
  ]
  return '\uFEFF' + rows.join('\r\n')
}
