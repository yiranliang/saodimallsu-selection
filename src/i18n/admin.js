/**
 * 后台中文文案（zh-CN）
 * ══════════════════
 * 后台是给运营团队用的，前台是给海外红人用的 —— 两边受众完全不同。
 * 所以这里只放**后台**的文案，前台组件一个 `t()` 都不引（红线）：
 * 一旦有中文漏到 Storefront，红人会看到半句话。
 *
 * 为什么是手写字典，不是 i18n 库
 * ─────────────────────────────
 * 需要的功能只有"查表 + 占位符替换"，`i18next` / `react-intl` 会给主包
 * 加上几十 KB 和一套 provider / 中间件。这个站在一个文件里就能说完。
 *
 * 为什么 key 是英文原文
 * ────────────────────
 * `t('Cancel')` 读起来就是那一行 UI，改代码的人不需要在字典和组件之间
 * 来回跳。代价是改英文原文就得改 key —— 但这里的英文原文本来也不再是
 * 展示文案，只是 key。
 *
 * 查不到时返回原文
 * ────────────────
 * 新增一句英文 UI 忘了加翻译，后台会显示英文而不是 `admin.cancel` 这种
 * 占位符 —— 后者会让运营以为界面坏了，前者只是"这句还没翻"。
 * `scripts/test-admin-i18n.mjs` 会扫出这种情况。
 *
 * aria-label / title 刻意保持英文
 * ───────────────────────────────
 * 它们不进可见文案，却是无障碍与自动化的稳定钩子；跟着文案一起翻译
 * 会让 400 多条冒烟断言变成"依赖翻译"的脆弱测试。可见文案（按钮文字、
 * 标签、占位符、提示）才翻译。
 */

export const ADMIN_ZH = {
  /* ── 外壳 / 导航 ── */
  'ADMIN CONSOLE': '管理后台',
  Lookup: '查询',
  Products: '商品库',
  Developer: '开发工具',
  'Log out': '退出登录',
  'Sign out': '退出登录',
  'Session expired due to inactivity': '长时间没有操作，已自动退出',
  '← Storefront': '← 返回前台',

  /* ── 登录 / 权限 ── */
  'Access Required': '需要登录',
  'Checking session': '正在检查登录状态',
  'Checking access': '正在校验权限',
  'Verifying your account…': '正在校验账号…',
  'Not authorised': '没有权限',
  'This area is for the Saodimallsu team. Sign in with your admin account to open the console.':
    '这里是 Saodimallsu 团队的内部后台，请用管理员账号登录。',
  Email: '邮箱',
  Password: '密码',
  'Your password': '你的密码',
  'Sign in': '登录',
  'Signing in…': '正在登录…',
  'Enter your email and password.': '请输入邮箱和密码。',
  'Access is remembered in this tab only.': '登录状态只保留在当前标签页。',
  '← Back to storefront': '← 返回前台',
  'This account': '这个账号',
  'signed in, but': '已登录，但',
  'it is not on the admin allowlist.': '它不在管理员白名单里。',
  'Ask an owner to add it to': '请让负责人把它加进',

  /* ── 404 ── */
  'Page not found': '页面不存在',
  'This admin URL doesn’t exist. It may have been renamed.':
    '这个后台地址不存在，可能已经被改名了。',
  'Back to Lookup': '返回查询页',

  /* ── 通用按钮 ── */
  Cancel: '取消',
  Close: '关闭',
  Clear: '清除',
  Save: '保存',
  Saving: '保存中',
  Delete: '删除',
  Edit: '编辑',
  'Delete permanently': '永久删除',
  'This cannot be undone.': '此操作不可撤销。',
  'This action cannot be undone.': '此操作不可撤销。',
  'Type DELETE to confirm bulk deletion': '输入 DELETE 以确认批量删除',
  'to enable deletion': '才能启用删除',
  'Being deleted': '正在删除',
  Preview: '预览',
  Label: '标签',
  Type: '类型',
  Code: '编码',

  /* ── 商品列表 ── */
  'Product library': '商品库',
  Import: '导入',
  'Import (CSV/XLSX)': '导入 (CSV/XLSX)',
  'Import Deals': '导入秒杀',
  'Import deals': '导入秒杀',
  'Import preview': '导入预览',
  'Import finished': '导入完成',
  'Export CSV': '导出 CSV',
  'Export JSON': '导出 JSON',
  'Export to CSV': '导出 CSV',
  'Export Sold Out List': '导出断货清单',
  'Download sold-out list as a text file': '把断货清单下载成文本文件',
  'Download .txt': '下载 .txt',
  'Download': '下载',
  Add: '新增',
  'Batch Edit Badge': '批量改角标',
  'Batch Edit Deal': '批量改秒杀',
  'Batch Edit Category': '批量改分类',
  Hide: '隐藏',
  Unhide: '取消隐藏',
  'To top': '置顶',
  'To bottom': '置底',
  'Move up': '上移',
  'Move down': '下移',
  'Move to top': '移到最前',
  'Move to bottom': '移到最后',
  'Clear selection': '清除选择',
  'Clear search': '清除搜索',
  'Clear filters': '清除筛选',
  'Select all products on this screen': '全选当前屏幕上的商品',
  'View Sold Out': '只看断货',
  'Refresh from the cloud': '从云端刷新',
  'Filter by category': '按分类筛选',
  Category: '分类',
  Categories: '分类',
  Stock: '库存',
  'Sold out': '断货',
  Hidden: '已隐藏',
  'Visible on storefront': '前台可见',
  'All available': '全部有货',
  Colour: '颜色',
  'Add colour': '添加颜色',
  'Remove option': '删除选项',
  'Remove option group': '删除选项组',
  'New category': '新建分类',
  'New category name': '新分类名称',
  'Cancel new category': '取消新建分类',
  'Choose a category…': '选择一个分类…',

  /* ── 秒杀专区改名 ── */
  'Deals tab': '秒杀专区名称',
  Rename: '改名',
  Reset: '恢复默认',
  'the chip at the top of the storefront': '前台顶部的那个标签',

  /* ── 批量改角标 ── */
  'Batch edit badge': '批量改角标',
  'Badge text': '角标文字',
  'Batch badge text': '批量角标文字',
  'Badge colour': '角标颜色',
  'Batch badge custom colour': '批量角标自定义颜色',
  'Pick any colour': '可选任意颜色',
  'Default': '默认',
  'Clear badge': '清空角标',
  'Secondary badge': '副角标',
  'Secondary badge text': '副角标文字',
  'Secondary badge colour': '副角标颜色',
  'Also update secondary badge': '同时修改副角标',
  'Batch secondary badge text': '批量副角标文字',
  'Batch secondary badge colour': '批量副角标颜色',
  'Also set the secondary badge': '同时设置副角标',
  'Back to the default charcoal badge': '恢复默认石墨底色',
  'No badge colour': '无角标颜色',
  'Append as secondary': '追加为副标签',
  Overwrite: '覆盖原标签',
  'Batch badge colour Charcoal': '批量角标颜色 石墨',
  'Batch badge colour Terracotta': '批量角标颜色 陶土',
  'Batch badge colour Red': '批量角标颜色 红',
  'Batch badge colour Amber': '批量角标颜色 琥珀',
  'Batch badge colour Green': '批量角标颜色 绿',
  'Batch badge colour Blue': '批量角标颜色 蓝',

  /* ── 批量改秒杀 ── */
  'Batch edit deal': '批量改秒杀',
  'Original price': '原价',
  'Sale price': '秒杀价',
  'Batch original price': '批量原价',
  'Batch sale price': '批量秒杀价',
  'Batch sale start': '批量开始日期',
  'Batch sale end': '批量结束日期',
  'Batch deal priority': '批量置顶权重',
  Starts: '开始',
  Ends: '结束',
  Pin: '置顶',
  'Next 7 days': '未来 7 天',
  'ends include the whole day (23:59:59)': '结束日算整天（23:59:59）',
  'fill the four fields': '请填完四个字段',
  'Clear deal': '清空秒杀',
  'Deals imported': '秒杀导入完成',

  /* ── 批量改分类 ── */
  'Batch edit category': '批量改分类',
  'Batch category': '批量分类',
  'New batch category name': '新分类名称',
  '＋ New category…': '＋ 新建分类…',
  'will be added to the categories table': '会一并写进分类表',
  'Only fill uncategorised': '只补没有分类的',
  'Overwrite all': '全部覆盖',

  /* ── 商品编辑器 ── */
  '货号 / Item code': '货号',
  'as it appears in your spreadsheet': '和表格里写的一致',
  Name: '商品名',
  'blank → uses the 货号': '留空 → 用货号代替',
  'from the categories table': '来自分类表',
  'Every selected product moves to this category.': '所有选中商品都会搬到这个分类。',
  'Products that already have a category keep it.': '已经有分类的商品保持不动。',
  'New product': '新增商品',
  'Edit product': '编辑商品',
  'Product name': '商品名称',
  'Main image': '主图',
  'Image URL (optional)': '图片链接（可选）',
  'Drop to use as main image': '拖到这里设为主图',
  'Use this photo as the main image': '把这张图设为主图',
  'Legacy uploaded image still in storage — replace it with a URL.':
    '这张是旧的上传图，仍在存储里 —— 建议换成链接。',
  'Options': '规格',
  'Colour, size, anything. Creators pick one of each.':
    '颜色、尺码，随便叫什么。红人每种选一个。',
  'No options — this product is one-size / single variant.':
    '没有规格 —— 这个商品是均码 / 单一款式。',
  'Shown smallest → largest. The order you typed is what gets saved.':
    '按从小到大显示。你输入的顺序就是保存的顺序。',
  'Coming Soon (Teaser)': '即将上架（预告）',
  'Limited Deal': '限时秒杀',
  'Deal priority': '专区置顶权重',
  'Discount label': '折扣文案',
  'Use auto': '自动',
  'ACC campaign ID': 'ACC 活动 ID',
  'Campaign ID': '活动 ID',
  'Copy ID': '复制 ID',
  'Amazon Creator Connections': 'Amazon 创作者计划 (ACC)',
  'Save product': '保存商品',
  'Delete product permanently': '永久删除商品',
  'Delete products permanently': '永久删除商品',
  'Quick fill': '快捷模板',
  Badge: '角标',
  'Group': '分组',
  'Label': '标签',
  Now: '此刻',
  New: '新品',
  'Best-seller': '畅销',
  'Back in stock': '补货到',

  /* ── 查询 / 开发工具 ── */
  'Selection code': '选品码',
  /* `{prefix}` 由 CODE_PREFIX 注入 —— 换品牌时这一句不用改。 */
  'Paste the code, e.g. {prefix}-xxxxxx': '粘贴选品码，例如 {prefix}-xxxxxx',
  'Look up another code': '再查一个',
  'Looking up…': '查询中…',
  'Decoded JSON': '解码后的 JSON',
  Decode: '解码',
  'Developer tools': '开发工具',
  'Payload layout (v7)': '数据结构（v7）',
  Generated: '生成时间',
  'Copy as products.js': '复制为 products.js',
  'Copy as asins.js': '复制为 asins.js',
  Copy: '复制',
  Creator: '红人',
  ASINs: 'ASIN 列表',
  'Copy a list you can send the creator as is — name, options, qty, Amazon link':
    '复制一份可以直接发给红人的清单 —— 名称、规格、数量、Amazon 链接',
  'Open in Developer': '在开发工具里打开',
  'How it works': '怎么用',
  'From a script': '脚本调用',
  'From the browser console': '浏览器控制台',
  'Internal id': '内部 ID',
  'Saved with the product — one save writes both tables.':
    '跟商品一起保存 —— 一次保存写两张表。',
  'Optional image URL per colour. Leave blank to use the main image.':
    '可以给每个颜色单独填图片链接，留空就用主图。',
  'Not in the ASIN table yet — this row comes from the options above':
    '还没进 ASIN 表 —— 这一行来自上面的规格',
  'Add a colour or a size above first — there is nothing to mark yet.':
    '先在上面加颜色或尺码 —— 现在还没有可标记的规格。',
  'Move to position': '移到第几位',
  'Hide from storefront': '从前台隐藏',
  'Show on storefront': '在前台显示',
  'Loading the catalogue…': '正在加载商品库…',
  'Nothing is sold out in this view': '当前视图里没有断货商品',
}

/**
 * 查表。取不到就返回原文（见文件头的说明）。
 *
 * 占位符用 `{name}`，只做字符串替换 —— 不引模板引擎。
 *
 * @param {string} text 英文原文（字典 key）
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function t(text, vars) {
  const zh = ADMIN_ZH[text]
  const out = typeof zh === 'string' ? zh : text
  if (!vars) return out
  return out.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  )
}

/** 这句有没有翻译过？（测试与"漏翻"检查用） */
export function hasTranslation(text) {
  return typeof ADMIN_ZH[text] === 'string'
}

/**
 * 解码错误 → 运营读的那句话
 * ════════════════════════════════════════════════════════════════
 *
 * `decodeCode` 返回的 error 是英文，而且是**契约的一部分**：`scripts/decode.mjs`、
 * `window.SAODIMALLSU.decode`、`scripts/test-code.mjs` 都对着那些字符串断言。所以在
 * 源头改成中文会把三个调用方一起打破。改在这里 —— 后台是中文的，运营不该
 * 被一句 `Invalid brand prefix` 卡住。
 *
 * 前缀相关的两条值得特别写好一点：它们的意思是"你粘错地方了"，而不是
 * "系统坏了"。前者运营能自己解决，后者只会招来一张工单。
 *
 * 没列出的一律返回原文：诊断句比翻译缺失更值钱。
 *
 * @param {string} error   `decodeCode(...).error`
 * @param {string} prefix  当前品牌前缀（`CODE_PREFIX`），由调用方传入以保持本文件零依赖
 * @returns {string}
 */
export function codeErrorZh(error, prefix) {
  if (!error) return ''

  if (error === 'Invalid brand prefix') {
    return `品牌前缀不匹配：这份码不属于本品牌（当前 ${prefix}），请确认是不是把别家品牌的码粘过来了`
  }
  if (error.startsWith('Code must start with')) {
    return `选款码要以 ${prefix}- 开头，请检查复制是否完整`
  }
  if (error.startsWith('Unknown code version')) {
    return '无法识别的选款码版本 —— 这份码可能来自更新前的版本，请对照开发文档确认'
  }

  return error
}
