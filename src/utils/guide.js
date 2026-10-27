/**
 * 新手引导（Onboarding Guide）
 * ══════════════════════════════
 * 五步、纯前端、零网络请求。这里只放**数据和判定**，渲染在
 * `components/OnboardingGuide.jsx` —— 文案改动不需要动组件，测试也能直接
 * 断言这五段字。
 *
 * 为什么把「看过没有」做进这个文件而不是组件里
 * ────────────────────────────────────────────
 * 它是唯一会写 localStorage 的地方，而 localStorage 会抛异常（无痕模式、
 * 配额满、被策略禁用）。抛在渲染里就是整页白屏；抛在这里被 try/catch 吞掉，
 * 最坏结果是"下次还弹一次"。引导的失败必须只影响引导。
 */

/** localStorage 键 —— 和 `mako_lines_v1` / `mako_catalogue_v1` 同一套前缀。 */
export const GUIDE_KEY = 'mako_seen_guide_v1'

/**
 * 文案版本。改了步骤内容就把它 +1：老用户会再看一次新文案。
 * 存在 `GUIDE_KEY` 里的值就是它 —— 不是 `true`，因为"看过旧版"和"看过新版"
 * 是两件事，而布尔值分不开。
 */
export const GUIDE_VERSION = 'v1'

/**
 * 五步。`figure` 是 CSS 图形的名字，组件按它画 —— 不是图标名，因为这里
 * 不允许出现任何图片/SVG/图标库。
 *
 * 文案是产品给定的英文原文，逐字照抄：任何"顺手润色"都会让运营对不上
 * 他们写在别处的截图。
 */
export const GUIDE_STEPS = [
  {
    id: 'category',
    figure: 'grid',
    title: 'Select Category',
    body: 'Select a category to find the items you want.',
  },
  {
    id: 'specs',
    figure: 'zoom',
    title: 'Choose Pieces & View Spec',
    body: 'Tap your favorite pieces and click "View on Amazon" for full specs, size guides, and reviews.',
  },
  {
    id: 'variant',
    figure: 'swatches',
    title: 'Size, Color & Selection',
    body: 'Pick your color and size, then add the piece to your selection.',
  },
  {
    id: 'generate',
    figure: 'list',
    title: 'Review and Generate Code',
    body: 'Review your cart and tap "Generate my code".',
  },
  {
    id: 'send',
    figure: 'copy',
    title: 'Copy and Send Code',
    body: 'Copy and send your code directly to your contact.',
  },
]

export const GUIDE_TOTAL = GUIDE_STEPS.length

/** 1-based 的显示序号：1 → `01`（卡片左侧那个大数字）。 */
export function stepLabel(index) {
  const n = Math.min(Math.max(Math.floor(Number(index) || 0), 1), GUIDE_TOTAL)
  return String(n).padStart(2, '0')
}

/** 翻页时夹在 [1, 5]，不让调用方自己写边界。 */
export function clampStep(index) {
  const n = Math.floor(Number(index) || 1)
  if (!Number.isFinite(n)) return 1
  return Math.min(Math.max(n, 1), GUIDE_TOTAL)
}

/** 第 `index` 步（1-based）；越界时夹取，永不返回 undefined。 */
export function stepAt(index) {
  return GUIDE_STEPS[clampStep(index) - 1]
}

function store(storage) {
  if (storage) return storage
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    /* Accessing localStorage itself throws when cookies are blocked. */
    return null
  }
}

/**
 * 看过当前版本的引导了吗？
 *
 * 只认**当前** `GUIDE_VERSION`：升版本后老值不匹配，于是再看一次。
 * 任何异常、损坏的 JSON、空值都算"没看过"——宁可多弹一次，也不要因为
 * 一次读失败就让新用户永远看不到引导。
 */
export function hasSeenGuide(storage) {
  const box = store(storage)
  if (!box) return false
  try {
    return box.getItem(GUIDE_KEY) === GUIDE_VERSION
  } catch {
    return false
  }
}

/**
 * 记下"看过"。**关闭时才调用**（Skip / Got it / 遮罩 / Esc / ✕ 都走
 * 同一个 close），打开时就写会让"看到一半刷新"变成永远看不全。
 *
 * @returns {boolean} 写成功了吗（纯给测试和日志用，调用方不必处理）
 */
export function markGuideSeen(storage) {
  const box = store(storage)
  if (!box) return false
  try {
    box.setItem(GUIDE_KEY, GUIDE_VERSION)
    return true
  } catch {
    return false
  }
}

/** 「重看一遍」= 把标记删掉，下次进站/点 ? 都按首次处理。 */
export function clearGuideSeen(storage) {
  const box = store(storage)
  if (!box) return false
  try {
    box.removeItem(GUIDE_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * 什么时候该自动弹？
 *
 *   · 只在**目录已经画出来之后**（骨架屏期间弹引导，等于用一层遮罩盖住
 *     加载态，用户会以为页面卡死）
 *   · 加载失败时不弹（那一屏是重试按钮，盖上去很怪）
 *   · 已经看过就不弹
 */
export function shouldAutoOpen({ loading, failed, seen }) {
  return !loading && !failed && !seen
}
