import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ProductEditor from '../../components/admin/ProductEditor.jsx'
import Modal from '../../components/Modal.jsx'
import { useProducts, useCatalogueStatus } from '../../hooks/useProducts.js'
import {
  createProduct,
  updateProduct,
  updateProductSpecs,
  deleteProducts,
  setProductsHidden,
  setProductsBadge,
  setProductsDeals,
  clearProductsDeals,
  setProductsCategoryByIds,
  moveProduct,
  moveProductToEdge,
  moveProductsToEdge,
  reorderProducts,
  loadProducts,
  getBadgeColumnStatus,
  getDealColumnStatus,
  getCampaignColumnStatus,
  getSubBadgeStatus,
  getPriorityColumnStatus,
  UNCATEGORISED,
} from '../../store/productStore.js'
import { useCategories } from '../../hooks/useCategories.js'
import { addCategory, renameCategory, removeCategory, moveCategory } from '../../utils/categoryStore.js'
import { useAsins, useAsinsStatus } from '../../hooks/useAsins.js'
import { useAuth } from '../../hooks/useAuth.js'
import { removeAsins, loadAsins, saveVariantAsins, moveAsins } from '../../utils/asinStore.js'
import { combinationsOf, soldOutListOf } from '../../utils/soldOut.js'
import { readSheetGrid } from '../../utils/sheetFile.js'
import { planImport, executeImport, planIsEmpty } from '../../utils/bulkImport.js'
import { planDealImport, resolveDealTargets } from '../../utils/dealImport.js'
import { dropsCampaignTag, DEALS_TAB_DEFAULT_LABEL } from '../../utils/deal.js'
import {
  CATEGORY_MODES,
  buildDealFromDates,
  countFillTargets,
  normaliseSubBadgeDraft,
  parsePriorityInput,
  resolveCategoryName,
} from '../../utils/batchOps.js'
import { buildExportCsv } from '../../utils/exportCsv.js'
import {
  Plus,
  Pencil,
  Trash,
  ChevronUp,
  ChevronDown,
  ArrowToTop,
  ArrowToBottom,
  Download,
  Upload,
  Sparkle,
  Copy,
  Check,
  AlertCircle,
  Search,
  Close,
  Reset,
} from '../../components/icons.jsx'
import { copyToClipboard, downloadText } from '../../utils/clipboard.js'
import { skuOf, variantKey } from '../../utils/sku.js'
import {
  ALL_CATEGORIES as ALL,
  DEAL_ITEMS,
  dealItemsCountOf,
  filterProducts,
  categoryOptionsOf,
  parseBulkQuery,
} from '../../utils/adminFilter.js'
import {
  getSettingsStatus,
  resetDealsTabLabel,
  setDealsTabLabel,
} from '../../utils/settingsStore.js'
import { useSettings } from '../../hooks/useSettings.js'
import { t } from '../../i18n/admin.js'
import { normaliseDealsTabLabel } from '../../utils/deal.js'
import { computeBulkDeleteGuard } from '../../utils/adminSecurity.js'
import { BADGE_COLOR_PRESETS, badgeStyle, normaliseBadgeColor } from '../../utils/badge.js'
import {
  BADGE_WRITE_MODES,
  BATCH_BADGE_MAX,
  BATCH_BADGE_QUICK_PICKS,
  badgeWriteFor,
  normaliseBadgeDraft,
  placementCountsOf,
} from '../../utils/batchBadge.js'

/**
 * Drag wrapper for one catalogue row.
 * ───────────────────────────────────
 * `useSortable` wants a stable id and a ref on the element it measures, so the
 * row is *wrapped* rather than rewritten — the row keeps its checkbox,
 * thumbnail, buttons and every handler exactly as they were. Rewriting 150
 * lines of JSX into a hook-shaped component would have been the riskier move.
 *
 * `attributes` (role="button", tabIndex, aria-roledescription) is deliberately
 * NOT spread here. The row already contains real buttons and a checkbox, and
 * wrapping them in a second button role makes screen readers announce one giant
 * control. There is no keyboard sensor for the same reason — a keyboard drag
 * would need a key handler on the row that competes with the buttons inside it.
 * Drag is a pointer affordance; every reorder is also reachable by keyboard
 * through the ⤒ ↑ ↓ ⤓ buttons, which is the accessible path.
 *
 * The wrapper only carries `listeners`, and `disabled` is what turns it off
 * while a filter is active.
 */
function SortableRow({ id, disabled, children }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-20' : undefined}
      {...listeners}
    >
      {children(isDragging)}
    </div>
  )
}

/**
 * Product library (/admin/products)
 * ──────────────────────────────────
 * Visual editor for the catalogue: 货号, images, options, visibility.
 *
 * Two ways to take a style off sale:
 *   · Hide   — leaves the storefront, stays in the catalogue, so codes that
 *              already reference it still resolve to a name and an image.
 *   · Delete — gone for good. Ids are never renumbered, which is what keeps
 *              existing codes valid; the ASIN mapping is cleaned up as well.
 *
 * Everything here writes to localStorage and takes effect on the storefront
 * immediately.
 */
export default function ProductsPage() {
  const { showToast } = useOutletContext()
  const products = useProducts()

  const [editing, setEditing] = useState(null) // product being edited
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null) // product awaiting single-delete confirmation
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  /* 批量改角标的小窗。选择集在打开时快照，见 BatchBadgeDialog 的说明。 */
  const [batchBadgeOpen, setBatchBadgeOpen] = useState(false)
  /* 批量秒杀 / 批量分类。三个弹窗互斥打开（同一个按钮条，一次只想改一件事）。 */
  const [batchDealOpen, setBatchDealOpen] = useState(false)
  const [batchCategoryOpen, setBatchCategoryOpen] = useState(false)

  /* ── 前台秒杀专区的展示名 ── */
  const settings = useSettings()
  const [tabLabelDraft, setTabLabelDraft] = useState(settings.dealsTabLabel)
  const [tabLabelSaving, setTabLabelSaving] = useState(false)
  /* 存库的值变了就同步输入框（保存成功后、或另一台设备改了）。
   * 输入过程中不会被覆盖，因为依赖只有这个值。 */
  useEffect(() => {
    setTabLabelDraft(settings.dealsTabLabel)
  }, [settings.dealsTabLabel])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  const [soldOutOnly, setSoldOutOnly] = useState(false)
  const [categoryPanel, setCategoryPanel] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState(null)

  /* ── import ── */
  /* The grid is kept, not the plan: the "hide new 货号" checkbox re-plans from
     the same grid, and re-planning is a pure function over data the page
     already has. */
  const [importSheet, setImportSheet] = useState(null) // { grid, fileName }
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [hideNewSkus, setHideNewSkus] = useState(true)
  const fileInputRef = useRef(null)

  /* ── deal import ── */
  /* 秒杀导入与商品导入是两条独立流程：一个写五列秒杀字段，一个写 specs。
   * 各自有自己的 grid、preview 和 confirm，互不串。 */
  const [dealSheet, setDealSheet] = useState(null) // { grid, fileName }
  const [dealBusy, setDealBusy] = useState(false)
  /* 这批表格的归属（'regular' | 'campaign'）。空 = 还没选，导入按钮禁用。
   * 换一份表格就清空：上一份的答案不该成为下一份的默认。 */
  const [dealKind, setDealKind] = useState('')
  const [dealResult, setDealResult] = useState(null)
  const dealFileInputRef = useRef(null)

  const categoryList = useCategories()
  const catalogueStatus = useCatalogueStatus()

  const auth = useAuth()

  // Subscribed, not read once: realtime replaces the map when another admin
  // edits a 货号, and the ASIN counts in this list must follow.
  const asinMap = useAsins()
  const asinStatus = useAsinsStatus()

  /** Categories actually present in the catalogue, for the filter dropdown */
  const categoryOptions = useMemo(() => categoryOptionsOf(products), [products])
  /* 批量改分类的下拉要连"还没有商品用、但已经在分类表里"的也得列出来 ——
   * 提前建好的分类（比如黑五专区）恰恰是最常被批量指派的目标。 */
  const batchCategoryOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const name of [...categoryList, ...categoryOptions]) {
      const key = String(name || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
    return out
  }, [categoryList, categoryOptions])

  /**
   * The managed list plus anything the products use that the list doesn't know
   * about — a hand-typed category must never become unreachable.
   */
  const managedCategories = useMemo(() => {
    const counts = new Map()
    for (const product of products) {
      const name = product.category || UNCATEGORISED
      counts.set(name, (counts.get(name) || 0) + 1)
    }

    const ordered = []
    const seen = new Set()
    for (const name of categoryList) {
      if (seen.has(name)) continue
      seen.add(name)
      ordered.push(name)
    }
    const extras = [...counts.keys()]
      .filter((name) => !seen.has(name))
      .sort((a, b) => a.localeCompare(b))

    return [...ordered, ...extras].map((name) => ({
      name,
      count: counts.get(name) || 0,
    }))
  }, [categoryList, products])

  /** Search matches id, 货号 and ASINs; the dropdown narrows by category; the
   *  sold-out view is a third narrowing. All three combine with AND, and this is
   *  the only definition of "visible" — Select all, the bulk actions and the
   *  drag guard all read it. */
  const visible = useMemo(
    () => filterProducts(products, { query, category, soldOutOnly, asinMap }),
    [products, category, query, asinMap, soldOutOnly],
  )

  /* The pasted 货号, parsed once per keystroke. `filterProducts` parses the same
   * string internally — that is the whole rule in one place — and this copy
   * exists only so the UI can say how many were pasted and how many landed. */
  const bulkTokens = useMemo(() => parseBulkQuery(query), [query])
  const bulkMode = bulkTokens.length > 1

  /**
   * A single-line `<input>` does not keep newlines. Chrome joins a multi-line
   * paste with spaces, but Safari and some Android keyboards strip the breaks
   * outright — which would turn ten pasted 货号 into one long token and quietly
   * disable bulk mode.
   *
   * So a paste that contains a line break is handled here: the breaks become
   * spaces (a separator the parser already knows), and the whole field is
   * replaced, because "paste a list" means "search this list", not "insert two
   * of these into what I had". Every other paste — one 货号, one word — is left
   * to the browser, so the caret keeps behaving normally.
   */
  const handlePasteList = (event) => {
    const text = event.clipboardData?.getData('text') || ''
    if (!/[\r\n]/.test(text)) return
    event.preventDefault()
    setQuery(text.replace(/[\r\n]+/g, ' ').trim())
  }

  /** Every sold-out combination in the current view, for the export. */
  const soldOutLines = useMemo(() => {
    const rows = []
    for (const product of visible) {
      const keys = soldOutListOf(product)
      if (!keys.length) continue
      const asins = asinMap[skuOf(product)] || {}
      for (const key of keys) {
        const [colour = '', size = ''] = key.split('|')
        rows.push({
          sku: skuOf(product),
          name: product.name,
          colour,
          size,
          key,
          asin: asins[key] || asins[variantKey(colour, size)] || '',
          productId: product.id,
        })
      }
    }
    return rows
  }, [visible, asinMap])

  /**
   * Selection is kept as a plain set of ids and re-derived against the live
   * catalogue, so ids deleted elsewhere simply fall out instead of lingering.
   */
  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds],
  )
  const selectedCount = selectedProducts.length
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selectedIds.has(p.id))
  const hiddenCount = useMemo(() => products.filter((p) => p.hidden).length, [products])
  /* 下拉里那枚伪选项的数字，按整本目录算 —— 它回答"点下去能看到多少件"。 */
  const dealItemsCount = useMemo(() => dealItemsCountOf(products), [products])

  const filtering = Boolean(query.trim()) || category !== ALL || soldOutOnly
  /* Dragging rewrites the entire sort_order column from one id array, so it is
   * only safe on the complete catalogue. The ⤒ ⤓ buttons keep working while
   * filtering. */
  const canDrag = !filtering

  /* ── selection ── */

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        // Un-tick only what is on screen — a filtered selection stays put
        for (const product of visible) next.delete(product.id)
      } else {
        for (const product of visible) next.add(product.id)
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  /* ── create ── */
  const handleCreate = () => {
    // No id: the database sequence assigns p140, p141… on insert. Two admins
    // adding at the same moment can no longer collide, and a retired id is
    // never handed out again.
    setEditing({
      id: null,
      sku: '',
      name: '',
      image: '',
      tag: '',
      specs: {},
    })
    setCreating(true)
  }

  /* ── save (create or update) ── */
  const handleSave = async (draft) => {
    const nextSku = String(draft.sku || '').trim()
    const previousSku = String(editing?.sku || '').trim()
    /* A colour picked on a database without `badge_color` is dropped by the
     * store's write payload (it strips columns the database does not have —
     * that is what keeps saves working at all). Everything else saves, so the
     * old code said "Changes saved" and the colour vanished. Say what happened
     * instead: this is the only place the admin can learn it. */
    const badgeDropped = Boolean(draft.badgeColor) && getBadgeColumnStatus() === 'missing'
    const badgeWarning =
      '已保存，但角标颜色没写进去 —— 数据库没有 badge_color 列。' +
      '先在 Supabase 跑一次 supabase/07-badge-color.sql，再保存一次。'

    try {
      if (creating) {
        const id = await createProduct(draft)
        /* One toast only — `useToast` keeps the newest one, so the warning has
         * to ride along with the success message or it would replace it. */
        showToast?.(
          badgeDropped
            ? `已新增商品 ${id} —— 角标颜色没存进去（没有 badge_color 列）`
            : `已新增商品 ${id}`,
          badgeDropped ? 'error' : 'success',
          badgeDropped ? 6000 : 2000,
        )
      } else {
        /* RENAME FIRST. `asins.sku` is the primary key, so a renamed 货号 needs
         * its ASIN row moved, not re-keyed. Doing it before the product update
         * means the one failure mode that needs a human — the destination
         * already has ASINs — aborts with nothing written at all. */
        if (nextSku && previousSku && nextSku !== previousSku) {
          const moved = await moveAsins(previousSku, nextSku)
          if (moved) showToast?.(`ASIN 已从 ${previousSku} 迁到 ${nextSku}`, 'default', 3000)
        }
        /* 秒杀被清空时，旧活动标一起让位 —— 否则货架上还是上一场活动的
         * 名字，而不是 Limited Deal。（编辑器里改日期不从这条清：那是同一场
         * 活动的改期，运营没说这枚标过期了。批量导入走的是"表格即真相"，
         * 所以那边任何窗口变化都算。） */
        const dealNowOff =
          !String(draft.saleStart || '').trim() && !String(draft.saleEnd || '').trim()
        const droppedTag =
          dealNowOff && dropsCampaignTag(editing, draft) ? String(editing?.subTag || '').trim() : ''
        const payload = droppedTag ? { ...draft, subTag: '', subBadgeColor: '' } : draft
        await updateProduct(payload.id, payload)
        const savedMsg = droppedTag ? `已保存 · 旧活动标「${droppedTag}」已清除` : '已保存'
        showToast?.(
          badgeDropped ? `${badgeWarning}${droppedTag ? ` 旧活动标「${droppedTag}」已清除。` : ''}` : savedMsg,
          badgeDropped ? 'error' : 'success',
          badgeDropped ? 6000 : droppedTag ? 4000 : 3000,
        )

        /* A renamed colour re-keys its ASINs (the map is keyed by the text). Say
         * so once: the alternative is an admin who renames 藏青色 → Navy, sees
         * the rows still filled, and wonders whether the save really did it. */
        const renames = Array.isArray(draft.asinRenames) ? draft.asinRenames : []
        if (renames.length) {
          const pairs = renames.map((r) => `${r.from} → ${r.to}`).join(', ')
          const total = renames.reduce((sum, r) => sum + r.count, 0)
          showToast?.(
            total
              ? `改名同时迁移了 ASIN：${pairs}（共 ${total} 条）`
              : `已改名 ${pairs} —— 没有已存的 ASIN 需要迁移`,
            'default',
            4000,
          )
        }
      }

      /* The product row is the primary save; a failed ASIN write must not make
       * it look like nothing happened. Reported separately, after the fact. */
      if (draft.asins && nextSku) {
        try {
          await saveVariantAsins(nextSku, draft.asins)
        } catch (asinError) {
          showToast?.(`商品已保存，但 ASIN 没写进去：${asinError.message}`, 'error', 5000)
        }
      }

      setEditing(null)
      setCreating(false)
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /* ── delete one ── */
  const handleDelete = async (product) => {
    if (!product) return
    try {
      await deleteProducts([product.id])
      // A deleted product must not leave its ASINs behind — they would show up
      // in search for something that no longer exists
      if (product.sku) await removeAsins(product.sku)
      setDeleteTarget(null)
      showToast?.(`已删除「${product.name}」`, 'default')
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /* ── bulk actions ── */

  const handleBulkVisibility = async (hidden) => {
    if (!selectedCount) return
    try {
      await setProductsHidden(
        selectedProducts.map((p) => p.id),
        hidden,
      )
      showToast?.(
        `${selectedCount} 件商品已${hidden ? '隐藏' : '恢复显示'}`,
        'success',
      )
      clearSelection()
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /**
   * 批量改角标。只写角标那四列（见 setProductsBadge），所以这条路径碰不到
   * 价格、秒杀窗口或库存 —— 黑五前一天最不该出事的就是那些字段。
   * 成功后清空选择：这十件已经改完了，留着下一件事通常是误操作。
   *
   * 写哪个槽位由 `badgeWriteFor` 决定，一句话：
   *   第二行 = `tag`（普通标，不动别人），第一行 = `sub_tag`（活动标，覆盖）。
   * 这段逻辑必须在纯函数里，因为它错了的症状是"后台说成功、前台没变化"。
   *
   * @param {{ text?: string, color?: string }} draft 弹窗里的**原始**输入。
   *   这里规整，且只规整一次 —— 收已规整的 `{ tag, badgeColor }` 也行，但那是兜底，
   *   不要依赖（`normaliseBadgeDraft` 幂等，见 utils/batchBadge.js 的注释）。
   */
  const handleBatchBadge = async (draft, sub, mode = 'append') => {
    const plan = badgeWriteFor(mode, normaliseBadgeDraft(draft), sub)
    if (!plan.touchTag && !plan.sub) return
    const written = plan.sub?.subTag || plan.badge.tag
    /* 空文字不该走到这里（应用按钮是灰的），真走到了也绝不能让 toast 说
     * 「设为「」」—— 那种提示会让人以为后台坏了。 */
    if (!written) return
    try {
      const count = await setProductsBadge(
        selectedProducts.map((product) => product.id),
        plan.badge,
        { sub: plan.sub, touchTag: plan.touchTag },
      )
      setBatchBadgeOpen(false)
      clearSelection()
      showToast?.(
        mode === 'overwrite'
          ? `已把 ${count} 件商品的活动标设为「${written}」`
          : `已给 ${count} 件商品设置角标「${written}」`,
        'success',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /** 清空 = 两行一起清（颜色一并不写，见 utils/batchBadge.js）。 */
  const handleBatchBadgeClear = async () => {
    try {
      const count = await setProductsBadge(
        selectedProducts.map((product) => product.id),
        { tag: '', badgeColor: '' },
        { sub: { subTag: '', subBadgeColor: '' } },
      )
      setBatchBadgeOpen(false)
      clearSelection()
      showToast?.(`已清空 ${count} 件商品的角标`, 'default')
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /**
   * 批量开秒杀 —— 写五个 sale_* 列（+ 可选置顶权重），别的不碰。
   *
   * **唯一的例外**：这些商品原来挂着活动标（`Black Friday`…）而这次写入
   * 改动了窗口时，`sub_tag` / `sub_badge_color` 会被一起清掉 —— 否则货架上
   * 显示的还是上一场活动的名字，而不是 `Limited Deal`（见 deal.js 的
   * `dropsCampaignTag`）。清的是活动类文字，运营标（NEW…）不动。
   *
   * 时间在 `buildDealFromDates` 里补成整天边界，和单件编辑器的规则逐字一致：
   * 手填日期不可能精确到秒，所以开始就是 00:00:00、结束就是 23:59:59，
   * 不做时区换算（红人的手机决定它什么时候翻）。
   */
  const handleBatchDeal = async (draft) => {
    const { deal, error } = buildDealFromDates(draft)
    if (error) {
      showToast?.(error, 'error')
      return
    }
    /* 归属必选（弹窗里那个单选），没选就不写。 */
    if (!draft.dealKind) return

    const priority = parsePriorityInput(draft.priority)
    /* 先说清楚会清掉几枚活动标 —— 静默删掉运营自己打的字，比不删更糟。 */
    const droppedTags = selectedProducts.filter((product) => dropsCampaignTag(product, deal)).length
    try {
      const count = await setProductsDeals(
        selectedProducts.map((product) => ({ id: product.id, deal })),
        {
          ...(priority === null ? {} : { priority }),
          isCampaign: draft.dealKind === 'campaign',
        },
      )
      setBatchDealOpen(false)
      clearSelection()
      showToast?.(
        `已给 ${count} 件商品设置${draft.dealKind === 'campaign' ? '大促' : '常规'}秒杀` +
          (priority ? ` · 置顶权重 ${priority}` : '') +
          (droppedTags ? ` · 清除了 ${droppedTags} 个旧活动标` : ''),
        'success',
      )
    } catch (err) {
      /* 弹窗留着，改完再点一次 —— 关掉等于让运营重填一遍。 */
      showToast?.(err.message, 'error')
    }
  }

  /** 清空秒杀（活动结束后那一下）：五个字段 + 置顶一起归零。 */
  const handleBatchDealClear = async () => {
    const droppedTags = selectedProducts.filter((product) => dropsCampaignTag(product, {})).length
    try {
      const count = await clearProductsDeals(selectedProducts.map((product) => product.id))
      setBatchDealOpen(false)
      clearSelection()
      showToast?.(
        `已清空 ${count} 件商品的秒杀` + (droppedTags ? ` · 清除了 ${droppedTags} 个旧活动标` : ''),
        'default',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /**
   * 批量改分类。
   *
   * 顺序很重要：先确保 `categories` 表里有这一行，再写商品 —— `products.category`
   * 有 FK 指向它，顺序反了就是一次 constraint violation。新名字走 `addCategory`，
   * 已有名字则解析回数据库里的规范拼写（大小写不同也认）。
   */
  const handleBatchCategory = async ({ category, mode }) => {
    const { name, isNew } = resolveCategoryName(category, batchCategoryOptions)
    if (!name) {
      showToast?.('分类名不能为空', 'error')
      return
    }

    try {
      /* 先建分类行，再写商品 —— products.category 有 FK 指向 categories(name)，
       * 顺序反了就是一次 constraint violation。 */
      if (isNew) await addCategory(name)

      const count = await setProductsCategoryByIds(
        selectedProducts.map((product) => product.id),
        name,
        mode,
      )
      setBatchCategoryOpen(false)
      clearSelection()
      showToast?.(
        count === 0
          ? '没有改动 —— 所选商品都已经有分类了'
          : `${count} 件商品已移到「${name}」`,
        count === 0 ? 'default' : 'success',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /** 改前台 Tab 名。空输入 = 恢复默认（规整函数负责这件事）。 */
  const handleSaveTabLabel = async () => {
    if (tabLabelSaving) return
    setTabLabelSaving(true)
    try {
      const saved = await setDealsTabLabel(tabLabelDraft)
      showToast?.(`前台专区名已改为「${saved}」`, 'success')
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setTabLabelSaving(false)
    }
  }

  const handleResetTabLabel = async () => {
    if (tabLabelSaving) return
    setTabLabelSaving(true)
    try {
      const saved = await resetDealsTabLabel()
      showToast?.(`前台专区名已恢复为「${saved}」`, 'default')
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setTabLabelSaving(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedCount) return
    try {
      const ids = selectedProducts.map((p) => p.id)
      const skus = selectedProducts.map((p) => p.sku).filter(Boolean)

      await deleteProducts(ids)
      if (skus.length) await removeAsins(skus)

      setConfirmBulkDelete(false)
      clearSelection()
      showToast?.(
        `已删除 ${ids.length} 件商品及其 ASIN 映射`,
        'default',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /* ── categories ── */

  const handleAddCategory = async () => {
    const name = newCategory.trim()
    if (!name) return
    try {
      const added = await addCategory(name)
      if (!added) {
        showToast?.(`列表里已经有「${name}」了`, 'error')
        return
      }
      setNewCategory('')
      showToast?.(`已添加「${name}」`, 'success')
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /**
   * Rename in one step: products first, then the list. Doing both here keeps
   * the two from drifting apart (a category in the list with no products, or
   * products pointing at a name that no longer exists).
   */
  const handleRenameCategory = async (from, to) => {
    const next = to.trim()
    if (!next || next === from) return

    try {
      // renameCategory moves the products itself — the foreign key would
      // otherwise block the rename, and a merge would need the move anyway.
      const { moved, merged } = await renameCategory(from, next)
      showToast?.(
        merged
          ? `已合并到「${next}」 · 迁移了 ${moved} 件商品`
          : moved
            ? `已改名为「${next}」 · 更新了 ${moved} 件商品`
            : `已改名为「${next}」`,
        'success',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /** Swap with the neighbour in `categories.sort_order`; the rail follows. */
  const handleMoveCategory = async (name, direction) => {
    try {
      await moveCategory(name, direction)
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  const handleDeleteCategory = async (name) => {
    const affected = products.filter((p) => p.category === name)

    // Uncategorised is the fallback bucket — deleting it would just recreate it
    if (name === UNCATEGORISED && affected.length) {
      showToast?.(
        `「${UNCATEGORISED}」是兜底分类 —— 请先改名，或把里面的商品移走`,
        'error',
      )
      setPendingCategoryDelete(null)
      return
    }

    try {
      // removeCategory re-points the products to Uncategorised first, so the
      // ON DELETE RESTRICT foreign key never fires.
      const { moved } = await removeCategory(name)
      setPendingCategoryDelete(null)
      if (category === name) setCategory(ALL)
      showToast?.(
        moved
          ? `已删除「${name}」 · ${moved} 件商品移到「${UNCATEGORISED}」`
          : `已删除「${name}」`,
        'default',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /* ── export ── */
  const handleExportJSON = () => {
    downloadText('products.json', JSON.stringify(products, null, 2), 'application/json')
    showToast?.('已下载 products.json', 'success')
  }

  const handleExportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(
      `products-${stamp}.csv`,
      buildExportCsv(products),
      'text/csv;charset=utf-8',
    )
    showToast?.(`已导出 ${products.length} 件商品到 CSV`, 'success')
  }

  const handleCopyJS = async () => {
    // Categories first — they drive the storefront nav and the editor's
    // suggestions, so a copy that only carried products would lose them.
    const categoryBlock = managedCategories.length
      ? `export const categories = [\n${managedCategories
          .map(({ name }) => `  ${JSON.stringify(name)},`)
          .join('\n')}\n]\n\n`
      : ''

    const body = products
      .map((p) => `  ${JSON.stringify(p, null, 2).replace(/\n/g, '\n  ')},`)
      .join('\n')

    const snippet = `${categoryBlock}export const products = [\n${body}\n]\n`
    const ok = await copyToClipboard(snippet)
    showToast?.(ok ? '已复制 —— 粘贴进 data/products.js' : '复制失败', ok ? 'success' : 'error')
  }

  /* ── sold-out list ──
   * One line per dead combination, grouped by style, in the shape purchasing
   * asked for: 货号, what is gone, and the ASIN to look up or re-order.
   * Plain text on purpose — it gets pasted into a chat window or an email, and
   * a CSV would need a column order explained to whoever opens it. */
  const buildSoldOutText = () => {
    const byStyle = new Map()
    for (const line of soldOutLines) {
      if (!byStyle.has(line.sku)) byStyle.set(line.sku, [])
      byStyle.get(line.sku).push(line)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const head = [
      `Saodimallsu · sold out · ${stamp}`,
      `${byStyle.size} style${byStyle.size === 1 ? '' : 's'} · ${soldOutLines.length} variant${soldOutLines.length === 1 ? '' : 's'}`,
      '',
    ]

    const body = []
    for (const [sku, lines] of byStyle) {
      body.push(`${sku || '(no 货号)'}  ${lines[0].name}`)
      for (const line of lines) {
        const combo = [line.colour, line.size].filter(Boolean).join(' / ') || line.key
        body.push(`  ${combo.padEnd(22)} ${line.asin || 'no ASIN'}`)
      }
      body.push('')
    }

    return [...head, ...body].join('\n').trimEnd() + '\n'
  }

  const handleExportSoldOut = async () => {
    if (!soldOutLines.length) {
      showToast?.('当前视图里没有断货商品', 'error')
      return
    }
    const ok = await copyToClipboard(buildSoldOutText())
    showToast?.(
      ok
        ? `已复制 ${soldOutLines.length} 个断货规格`
        : 'Copy failed',
      ok ? 'success' : 'error',
    )
  }

  const handleDownloadSoldOut = () => {
    if (!soldOutLines.length) {
      showToast?.('Nothing is sold out in this view', 'error')
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`sold-out-${stamp}.txt`, buildSoldOutText())
    showToast?.(`已下载 ${soldOutLines.length} 个规格`, 'success')
  }

  /**
   * Clear one combination's sold-out mark, straight from the list.
   *
   * Deliberately not "clear all": stock comes back one size at a time, and a
   * button that un-marks the whole style is a button that sells clothes that
   * are not there. `updateProduct` writes the whole product back through the
   * field whitelist, so every other field survives.
   */
  const handleClearSoldOut = async (product, key) => {
    const next = soldOutListOf(product).filter(
      (entry) => entry.toLowerCase() !== key.toLowerCase(),
    )
    try {
      await updateProduct(product.id, { soldOutVariants: next })
      showToast?.(
        next.length ? `已补货 · ${key}` : `「${skuOf(product) || product.name}」全部恢复有货`,
        'success',
      )
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  const handleCopyAsinsJS = async () => {
    const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    const entries = Object.entries(asinMap)
      .filter(([, variants]) => variants && Object.keys(variants).length)
      .map(([sku, variants]) => {
        const lines = Object.entries(variants)
          .map(([variant, asin]) => `    ${quote(variant)}: ${quote(asin)},`)
          .join('\n')
        return `  ${quote(sku)}: {\n${lines}\n  },`
      })

    const snippet = `export const asins = {\n${entries.join('\n')}\n}\n`
    const ok = await copyToClipboard(snippet)
    showToast?.(
      ok ? 'Copied — paste into data/asins.js' : 'Copy failed',
      ok ? 'success' : 'error',
    )
  }

  /** Reorder is a network write now — keep a failure from becoming an
   *  unhandled rejection and tell the user why. */
  const handleMove = (id, direction) => {
    moveProduct(id, direction).catch((err) => showToast?.(err.message, 'error'))
  }

  /* One write each, so the toast can be specific: "moved to top" is true the
   * moment the promise resolves, not after a reindex settles. */
  const handleMoveToEdge = (id, edge) => {
    moveProductToEdge(id, edge)
      .then(() => showToast?.(edge === 'top' ? '已移到最前' : '已移到最后', 'success'))
      .catch((err) => showToast?.(err.message, 'error'))
  }

  const handleBulkMoveToEdge = (edge) => {
    const ids = selectedProducts.map((product) => product.id)
    if (ids.length === 0) return
    moveProductsToEdge(ids, edge)
      .then((moved) => {
        // Selection is deliberately kept: the ids did not change, only their
        // position, and the next thing you want is usually Hide or Edit on the
        // same rows. Silently deselecting would make you find them again.
        showToast?.(`${moved} 件商品已${edge === 'top' ? '移到最前' : '移到最后'}`, 'success')
      })
      .catch((err) => showToast?.(err.message, 'error'))
  }

  /* ── drag and drop ──
   * 6px before a drag starts. Without a threshold, a click on the row (or the
   * tiniest hand tremor while aiming at the checkbox) begins a drag and eats
   * the click — the row would feel stuck. Six pixels is below the noise floor
   * of an intentional drag and above the wobble of a click.
   *
   * PointerSensor, not KeyboardSensor: see the note on `SortableRow`. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  /* Dropping is the only moment we talk to the server: one RPC with the whole
   * ordered id list, one transaction in Postgres. */
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return

    const from = products.findIndex((product) => product.id === active.id)
    const to = products.findIndex((product) => product.id === over.id)
    if (from < 0 || to < 0) return

    const nextIds = arrayMove(products, from, to).map((product) => product.id)

    reorderProducts(nextIds)
      .then(() => showToast?.(`已移到第 ${to + 1} 位`, 'success'))
      .catch((err) => showToast?.(err.message, 'error'))
  }

  /* ── manual refresh ──
   * Realtime normally keeps everyone in sync; this is the escape hatch for the
   * case where the socket dropped (laptop asleep, tunnel, flaky wifi). */
  const handleRefresh = async () => {
    try {
      await Promise.all([loadProducts({ silent: true }), loadAsins({ silent: true })])
      showToast?.('商品库已刷新', 'success')
    } catch (err) {
      showToast?.(err.message, 'error')
    }
  }

  /* ── import ── */

  /** The plan behind the preview modal. Recomputed when the catalogue, the
   *  ASIN map or the hide-new checkbox changes — the checkbox in particular
   *  has to re-plan, because `hideNew` is read while building new rows. */
  const importPlan = useMemo(() => {
    if (!importSheet) return null
    return planImport({
      grid: importSheet.grid,
      dbProducts: products,
      existingAsins: asinMap,
      hideNew: hideNewSkus,
    })
  }, [importSheet, products, asinMap, hideNewSkus])

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    /* Clear the input so picking the same file twice still fires `change` —
       the second import of a corrected sheet is a normal thing to do. */
    event.target.value = ''
    if (!file) return

    try {
      const grid = await readSheetGrid(file)
      setImportSheet({ grid, fileName: file.name })
    } catch (err) {
      showToast?.(`读不了 ${file.name}：${err.message}`, 'error', 6000)
    }
  }

  const runImport = async () => {
    if (!importPlan || importBusy) return
    setImportBusy(true)
    try {
      const stats = await executeImport(importPlan, {
        isAdmin: auth.isAdmin === true,
        createProduct,
        updateProductSpecs,
        saveVariantAsins,
      })
      /* The stores already updated themselves row by row; this is the
         after-the-fact read-back that also picks up the ids the database
         assigned to the new products. */
      await Promise.all([loadProducts({ silent: true }), loadAsins({ silent: true })])
      setImportSheet(null)
      setImportResult(stats)
      showToast?.(
        `已导入 —— 新增 ${stats.created} 个、合并 ${stats.merged} 个、写入 ${stats.asinsAdded + stats.asinsUpdated} 个 ASIN`,
        'success',
        4000,
      )
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setImportBusy(false)
    }
  }

  /* ── deal import ── */

  /* 按货号匹配的写入计划 + 未找到清单，随 sheet / 商品缓存实时重算。 */
  const dealPlan = useMemo(() => {
    if (!dealSheet) return null
    return planDealImport(dealSheet.grid)
  }, [dealSheet])

  const dealTargets = useMemo(() => {
    if (!dealPlan) return null
    const bySku = new Map(products.map((p) => [p.sku, p.id]))
    return resolveDealTargets(dealPlan.plan, bySku)
  }, [dealPlan, products])

  const handleDealFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const grid = await readSheetGrid(file)
      setDealSheet({ grid, fileName: file.name })
      setDealKind('')
    } catch (err) {
      showToast?.(`Could not read ${file.name}: ${err.message}`, 'error', 6000)
    }
  }

  const runDealImport = async () => {
    if (!dealTargets || !dealTargets.matched.length || dealBusy || !dealKind) return
    setDealBusy(true)
    /* 这份表会把多少件商品身上的旧活动标换掉（只清活动类，见 deal.js）。 */
    const byId = new Map(products.map((product) => [String(product.id), product]))
    const droppedTags = dealTargets.matched.filter(({ id, deal }) =>
      dropsCampaignTag(byId.get(String(id)), deal),
    ).length
    try {
      const count = await setProductsDeals(dealTargets.matched, {
        isCampaign: dealKind === 'campaign',
      })
      await loadProducts({ silent: true })
      setDealSheet(null)
      setDealResult({
        written: count,
        missing: dealTargets.missing,
        problems: dealPlan.problems,
      })
      showToast?.(
        `${dealKind === 'campaign' ? 'Campaign' : 'Regular'} deals set on ${count} product${
          count === 1 ? '' : 's'
        }` +
          (droppedTags ? ` · ${droppedTags} old campaign label${droppedTags === 1 ? '' : 's'} cleared` : ''),
        'success',
        4000,
      )
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setDealBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl lg:max-w-none">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-charcoal">{t('Product library')}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-light">
            共 {products.length} 件商品
            {hiddenCount > 0 && ` · 其中 ${hiddenCount} 件已隐藏`} · 在这里改货号、图片、颜色和尺码。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-charcoal/75 ring-1 ring-charcoal/10 transition hover:text-charcoal hover:ring-charcoal/20 active:scale-95"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('Import (CSV/XLSX)')}</span>
            <span className="sm:hidden">{t('Import')}</span>
          </button>
          <button
            type="button"
            onClick={() => dealFileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-charcoal/75 ring-1 ring-charcoal/10 transition hover:text-charcoal hover:ring-charcoal/20 active:scale-95"
          >
            <Sparkle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('Import Deals')}</span>
            <span className="sm:hidden">秒杀</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-charcoal/75 ring-1 ring-charcoal/10 transition hover:text-charcoal hover:ring-charcoal/20 active:scale-95"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('Export to CSV')}</span>
            <span className="sm:hidden">CSV</span>
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[12px] font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />{t('Add')}</button>
        </div>
        {/* Visually hidden, not `display:none` — a hidden input is still
            clickable through the ref, and this one must never be reachable by
            tab because the button above is its accessible face. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleImportFile}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-file-role="products"
        />
        <input
          ref={dealFileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleDealFile}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-file-role="deals"
        />
      </div>

      {/* ── 前台大促专区的展示名 ──
          一个站点级设置，存在 `settings` 表（12-settings.sql）。放这里是因为
          改名的人就是"正在整理这批秒杀商品"的人 —— 改完角标顺手就能把 Tab
          一起改成 Black Friday。常规秒杀那个 Tab 的名字是固定的
          （`Limited Deals`），不跟这个设置走。 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-charcoal/[0.07]">
        <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Deals tab')}</span>
        <input
          type="text"
          value={tabLabelDraft}
          onChange={(event) => setTabLabelDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSaveTabLabel()
            if (event.key === 'Escape') setTabLabelDraft(settings.dealsTabLabel)
          }}
          maxLength={32}
          placeholder={DEALS_TAB_DEFAULT_LABEL}
          aria-label="Deals tab label"
          className="min-w-0 flex-1 rounded-lg bg-cream px-2.5 py-1.5 text-[12px] text-charcoal placeholder:text-charcoal-light/50 focus:outline-none focus:ring-1 focus:ring-charcoal/25"
        />
        <button
          type="button"
          onClick={handleSaveTabLabel}
          disabled={
            tabLabelSaving ||
            normaliseDealsTabLabel(tabLabelDraft) === settings.dealsTabLabel
          }
          className="shrink-0 rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {tabLabelSaving ? '保存中…' : '改名'}
        </button>
        <button
          type="button"
          onClick={handleResetTabLabel}
          disabled={tabLabelSaving || settings.dealsTabLabel === DEALS_TAB_DEFAULT_LABEL}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
        >{t('Reset')}</button>
        <span className="text-[10px] text-charcoal-light/70">{t('the chip at the top of the storefront')}</span>
        {getSettingsStatus() === 'missing' && (
          <span className="w-full text-[10px] leading-relaxed text-amber-700">
            settings 表不存在，改名存不进去。先在 Supabase 跑一次 supabase/12-settings.sql。
          </span>
        )}
      </div>

      {/* Cloud status — the list is empty until the first fetch lands */}
      {catalogueStatus === 'loading' && products.length === 0 && (
        <div className="mb-4 animate-pulse rounded-2xl bg-white px-3.5 py-6 text-center text-[11.5px] text-charcoal-light ring-1 ring-charcoal/[0.07]">{t('Loading the catalogue…')}</div>
      )}

      {catalogueStatus === 'error' && (
        <div className="mb-4 rounded-2xl bg-red-50 px-3.5 py-3 text-[11.5px] leading-relaxed text-red-700 ring-1 ring-red-200">
          连不上数据库。检查一下网络，然后{' '}
          <button type="button" onClick={handleRefresh} className="font-medium underline">
            重试
          </button>
          。
        </div>
      )}

      {/* Reorder / delete safety notice */}
      <div className="mb-4 flex items-start gap-2 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-charcoal/[0.07]">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-light" />
        <p className="text-[11.5px] leading-relaxed text-charcoal-light">
          选品码存的是内部 id，不是位置。所以重排、删除都是安全的 ——
          早就发出去的码依然能对到正确的商品。
        </p>
      </div>

      {/* Category manager — add, rename, remove.
          Full-width like the search bar below it: the 4xl cap left a dead strip
          on the right of a wide screen and made the panel read as a different
          column. Rows are one line each, so stretching costs nothing. */}
      <div className="mb-4 overflow-hidden rounded-2xl bg-white ring-1 ring-charcoal/[0.07]">
        <button
          type="button"
          onClick={() => setCategoryPanel((prev) => !prev)}
          aria-expanded={categoryPanel}
          className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-charcoal">{t('Categories')}</span>
            <span className="rounded-full bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-charcoal/60">
              {managedCategories.length}
            </span>
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform duration-200 ${
              categoryPanel ? 'rotate-180' : ''
            }`}
          />
        </button>

        {categoryPanel && (
          <div className="border-t border-charcoal/[0.07] px-3.5 py-3">
            <p className="text-[10.5px] leading-relaxed text-charcoal-light">
              改名 = 直接编辑名字；删除会把该分类下的商品移到{' '}
              {UNCATEGORISED}。
            </p>

            {/* One column, full width. Multi-column would fit more but breaks
                the thing this panel is for: moving a row down would teleport it
                to another column, and "position 3" stops being visible. */}
            <div className="mt-2.5 space-y-1.5">
              {managedCategories.map(({ name, count }, position) => (
                <CategoryRow
                  key={name}
                  name={name}
                  count={count}
                  first={position === 0}
                  last={position === managedCategories.length - 1}
                  confirming={pendingCategoryDelete === name}
                  onRename={handleRenameCategory}
                  onMove={handleMoveCategory}
                  onAskDelete={() => setPendingCategoryDelete(name)}
                  onCancelDelete={() => setPendingCategoryDelete(null)}
                  onConfirmDelete={() => handleDeleteCategory(name)}
                />
              ))}
            </div>

            {/* Same width as the rows above: the Add button then sits under the
                count/trash column instead of floating in the middle. */}
            <div className="mt-2.5 flex gap-1.5">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCategory()
                  }
                }}
                placeholder={t('New category')}
                aria-label="New category name"
                className="min-w-0 flex-1 rounded-full bg-cream-dark/70 px-3 py-1.5 text-[11.5px] text-charcoal placeholder:text-charcoal-light/55 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="flex shrink-0 items-center gap-1 rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95"
              >
                <Plus className="h-3 w-3" />{t('Add')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Search + category filter + sold-out view.
          `flex-wrap`, not a single row: three `shrink-0` controls plus a long
          category name are wider than a laptop, and without wrapping the last
          one gets pushed out of the card — off screen, not just clipped. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {/* The icon and the clear button are positioned against THIS box, not
              the outer column: the bulk-mode line below it would otherwise drag
              `top-1/2` down and leave the magnifier floating in the margin. */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-charcoal-light/60" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPaste={handlePasteList}
              placeholder="搜索货号 / ASIN / id —— 或直接粘贴一列"
              className="w-full rounded-full bg-white py-2.5 pl-9 pr-8 text-[12px] text-charcoal placeholder:text-charcoal-light/60 ring-1 ring-charcoal/[0.07] focus:outline-none focus:ring-charcoal/25"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
              >
                <Close className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Bulk mode is a different contract from fuzzy search, so it has to
              announce itself: without this line, pasting 10 货号 and getting 8
              rows back looks like a broken search rather than an exact match on
              two missing styles. */}
          {bulkMode && (
            <p className="mt-1.5 pl-1 text-[10.5px] leading-tight text-charcoal-light">
              Bulk search mode:{' '}
              <span className="font-medium text-charcoal">{bulkTokens.length} SKUs</span>
              {visible.length < bulkTokens.length && (
                <span className="text-amber-700"> · {visible.length} matched</span>
              )}
            </p>
          )}
        </div>

        {/* Category filter.
            The word "Category" is inside the pill on purpose: a bare select next
            to a search field reads as part of the search field, and the whole
            point of this control is to be *found*. `appearance-none` + an
            explicit chevron keeps the OS arrow from doubling the padding, and
            `max-w` stops a 40-character category name from eating the row.
            Only categories that actually have products are listed, so an empty
            selection can never look like a bug. */}
        <label className="flex shrink-0 items-center gap-1.5 rounded-full bg-white py-2.5 pl-3 pr-2 ring-1 ring-charcoal/[0.07] focus-within:ring-charcoal/25">
          <span className="whitespace-nowrap text-[11px] text-charcoal-light">{t('Category')}</span>
          <span className="relative flex items-center">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="max-w-[9rem] appearance-none bg-transparent pr-4 text-[12px] text-charcoal focus:outline-none"
            >
              <option value={ALL}>All ({products.length})</option>
              {/* 秒杀状态是算出来的，不是一列，所以它不在 categories 里。
                  做成下拉里的伪选项，运营点一下就能拿全这批商品再一键全选。 */}
              <option value={DEAL_ITEMS}>⚡ 秒杀商品 ({dealItemsCount})</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 h-3 w-3 text-charcoal-light" />
          </span>
        </label>

        {/* Sold-out view. A toggle rather than another entry in the category
            dropdown: it cuts across categories, and it is the one filter used
            on its own ("what do I need to re-order?"). */}
        <button
          type="button"
          onClick={() => setSoldOutOnly((on) => !on)}
          aria-pressed={soldOutOnly}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2.5 text-[12px] font-medium transition active:scale-95 ${
            soldOutOnly
              ? 'bg-red-500 text-white'
              : 'bg-white text-charcoal ring-1 ring-charcoal/[0.07] hover:ring-charcoal/25'
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5" />{t('View Sold Out')}</button>
      </div>

      {soldOutOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-red-50/70 px-3 py-2.5 ring-1 ring-red-100">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-red-800">
            <span className="font-medium">{soldOutLines.length}</span> 个规格断货，涉及{' '}
            <span className="font-medium">{visible.length}</span> 款商品。补货后在这里取消标记。
          </p>
          <button
            type="button"
            onClick={handleExportSoldOut}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-red-700 active:scale-95"
          >
            <Copy className="h-3 w-3" />{t('Export Sold Out List')}</button>
          <button
            type="button"
            onClick={handleDownloadSoldOut}
            aria-label="Download sold-out list as a text file"
            title="Download .txt"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 active:scale-95"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Select-all + bulk actions */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-charcoal-light">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAll}
            aria-label="Select all products on this screen"
            className="h-3.5 w-3.5 accent-charcoal"
          />
          全选
          {visible.length > 0 && <span className="text-charcoal-light/60">({visible.length})</span>}
        </label>

        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-charcoal">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={() => handleBulkMoveToEdge('top')}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('To top')}</button>
            <button
              type="button"
              onClick={() => handleBulkMoveToEdge('bottom')}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('To bottom')}</button>
            <button
              type="button"
              onClick={() => handleBulkVisibility(true)}
              className="rounded-full bg-charcoal px-2.5 py-1 text-[10.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95"
            >{t('Hide')}</button>
            <button
              type="button"
              onClick={() => handleBulkVisibility(false)}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('Unhide')}</button>
            <button
              type="button"
              onClick={() => setBatchBadgeOpen(true)}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('Batch Edit Badge')}</button>
            <button
              type="button"
              onClick={() => setBatchDealOpen(true)}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('Batch Edit Deal')}</button>
            <button
              type="button"
              onClick={() => setBatchCategoryOpen(true)}
              className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
            >{t('Batch Edit Category')}</button>
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              className="rounded-full bg-red-50 px-2.5 py-1 text-[10.5px] font-medium text-red-600 transition hover:bg-red-100 active:scale-95"
            >{t('Delete')}</button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="flex h-5 w-5 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
            >
              <Close className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {filtering && (
        <p className="mb-2 px-1 text-[11px] text-charcoal-light">
          {visible.length} / {products.length} 件
          {category === DEAL_ITEMS
            ? ' · ⚡ 秒杀商品'
            : category !== ALL && ` · ${category}`}
          {' · '}
          <span className="text-charcoal-light/70">
            筛选期间不能拖拽排序 —— 清掉筛选即可重新排列
          </span>
        </p>
      )}

      {/* List
          ────
          Drag is enabled only on the unfiltered catalogue. The RPC rewrites the
          whole sort_order column from one id array, so the array it receives has
          to be the whole catalogue — dragging a 3-row search result would claim
          positions 0..2 for those three and shove everything else down. The ⤒ ⤓
          buttons stay available while filtering, which is the case that actually
          comes up ("find the SKU, send it to the top"). */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={visible.map((product) => product.id)}
          /* `rectSortingStrategy`, not `verticalListSortingStrategy`: from `md`
             up this is a grid, so neighbours are to the left and right as well
             as above and below. */
          strategy={rectSortingStrategy}
        >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((product) => {
          const index = products.findIndex((p) => p.id === product.id)
          const specSummary = Object.entries(product.specs || {})
            .map(([type, options]) => `${type}: ${options.length}`)
            .join(' · ')
          // asins.js is { 货号: { 'Colour|Size': ASIN } } — count the entries,
          // not the keys of the outer object
          const asinCount = Object.keys(asinMap[skuOf(product)] || {}).length
          const photoCount = Object.values(product.variantImages || {}).reduce(
            (sum, byOption) => sum + Object.keys(byOption || {}).length,
            0,
          )
          const isSelected = selectedIds.has(product.id)

          // Heading is the 货号 when there is one, otherwise the product name.
          // Showing the name underneath only adds information when it differs.
          const heading = product.sku || product.name
          const subName = product.sku && product.name !== product.sku ? product.name : ''
          const soldOutKeys = soldOutListOf(product)

          /* Combinations the ASIN table has nothing for. Computed from the
           * catalogue's own specs, so a colour added five minutes ago already
           * counts as missing — which is the whole point of the badge: seeing it
           * here is cheaper than opening 195 editors.
           *
           * Only judged once the map has actually loaded (`asinStatus`): during
           * the first fetch every product would look empty and the list would
           * flash red. Products with no 货号 are left alone — ASINs are keyed by
           * 货号, so the fix there is to add the code, and the editor says so. */
          const missingAsins =
            asinStatus === 'ready' && product.sku
              ? (() => {
                  const stored = new Set(
                    Object.keys(asinMap[skuOf(product)] || {}).map((key) => key.toLowerCase()),
                  )
                  return combinationsOf(product).filter(
                    (combo) => !stored.has(combo.key.toLowerCase()),
                  ).length
                })()
              : 0

          return (
            <SortableRow key={product.id} id={product.id} disabled={!canDrag}>
              {(isDragging) => (
            <div
              className={`relative flex items-center gap-2.5 rounded-2xl p-3 transition-colors md:flex-col md:items-stretch md:gap-2 md:p-2.5 ${
                isSelected ? 'bg-accent/[0.06] ring-1 ring-accent/25' : 'bg-white'
              } ${isDragging ? 'shadow-lg ring-1 ring-charcoal/15' : ''} ${
                canDrag ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              {/* One markup, two shapes. Below `md` it is a row — checkbox,
                  thumbnail, text, buttons — which is what fits a phone. From
                  `md` up it becomes a card: image on top, details underneath,
                  actions at the bottom, so five of them fit across a laptop
                  without the thumbnail shrinking to a stamp.
                  The checkbox floats over the image corner on desktop rather
                  than sitting in the flow, which would push the photo down. */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelect(product.id)}
                /* The 6px threshold protects a clean click, but a click with a
                 * little hand tremor is 8px before you notice — that would
                 * start a drag and swallow the toggle. Controls opt out of the
                 * gesture entirely. */
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Select ${heading}`}
                className="h-4 w-4 shrink-0 cursor-pointer accent-charcoal md:absolute md:left-3 md:top-3 md:z-10 md:h-[18px] md:w-[18px] md:rounded md:bg-white/90 md:shadow-sm"
              />

              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-charcoal/[0.07] bg-white md:h-auto md:w-full md:aspect-square">
                <img
                  src={product.image}
                  alt={product.name}
                  loading="lazy"
                  className={`h-full w-full object-contain transition ${
                    product.hidden ? 'opacity-40 grayscale' : ''
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1 md:flex-none">
                <div className="flex items-baseline gap-2">
                  <h3
                    className={`line-clamp-1 font-medium ${
                      product.hidden ? 'text-charcoal/45' : 'text-charcoal'
                    } ${product.sku ? 'font-mono text-[12.5px]' : 'text-[13px]'}`}
                  >
                    {heading}
                  </h3>
                  <span className="shrink-0 font-mono text-[10px] text-charcoal-light/60">
                    {product.id}
                  </span>
                  {product.hidden && (
                    <span className="shrink-0 rounded-full bg-charcoal/[0.07] px-1.5 py-0.5 text-[9.5px] font-medium text-charcoal/55">{t('Hidden')}</span>
                  )}
                  {missingAsins > 0 && (
                    <span
                      title={`${missingAsins} 个组合还没有 ASIN —— 前台会视为断货（Sold Out），打开编辑器补上`}
                      className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-red-600 ring-1 ring-red-200"
                    >
                      ! 缺 {missingAsins}
                    </span>
                  )}
                </div>

                {subName && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-charcoal-light">{subName}</p>
                )}

                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-charcoal-light">
                  <span className="shrink-0 rounded bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium text-charcoal/70">
                    {product.category}
                  </span>
                  {asinCount > 0 && (
                    <>
                      <span className="text-charcoal/20">·</span>
                      <span className="shrink-0 tabular-nums">{asinCount} ASIN</span>
                    </>
                  )}
                  {photoCount > 0 && (
                    <>
                      <span className="text-charcoal/20">·</span>
                      <span className="shrink-0 tabular-nums">{photoCount} 张图</span>
                    </>
                  )}
                </div>

                {specSummary && (
                  <p className="mt-0.5 truncate text-[10.5px] text-charcoal-light/80">
                    {specSummary}
                  </p>
                )}

                {/* Which combinations are gone, by name — "1 sold out" would
                    tell purchasing nothing. Each chip is also the undo: stock
                    comes back one size at a time, so the mark is cleared one
                    size at a time. */}
                {soldOutKeys.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600">{t('Sold out')}</span>
                    {soldOutKeys.slice(0, 4).map((key) => {
                      const label = key.replace('|', ' / ')
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-0.5 rounded-full bg-red-50 py-0.5 pl-1.5 pr-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-100"
                        >
                          {label}
                          <button
                            type="button"
                            onClick={() => handleClearSoldOut(product, key)}
                            onPointerDown={(e) => e.stopPropagation()}
                            aria-label={`Mark ${label} of ${heading} back in stock`}
                            title="Back in stock"
                            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-red-400 transition hover:bg-red-200/70 hover:text-red-700"
                          >
                            <Close className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      )
                    })}
                    {soldOutKeys.length > 4 && (
                      <span className="text-[10px] text-red-600/70">
                        +{soldOutKeys.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div
                className="flex shrink-0 items-center md:mt-auto md:w-full md:justify-end md:gap-0.5 md:border-t md:border-charcoal/[0.06] md:pt-1.5"
                  /* Every button in the row lives here — none of them should be
                   * a drag handle. */
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Four buttons, one meaning each: to the end, one slot, one
                      slot, to the other end. They used to be a 16×20px stacked
                      chevron pair, which was both hard to hit and useless for
                      the actual job — getting a row off the bottom of 195.
                      `index` is the position in the WHOLE catalogue, not in the
                      filtered view, so the disabled states stay honest while a
                      search is active. */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleMoveToEdge(product.id, 'top')}
                      disabled={index === 0}
                      aria-label={`Move ${heading} to top`}
                      title="Move to top"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowToTop className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(product.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${heading} up`}
                      title="Move up"
                      className="hidden h-7 w-7 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-cream-dark hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent sm:flex"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(product.id, 1)}
                      disabled={index === products.length - 1}
                      aria-label={`Move ${heading} down`}
                      title="Move down"
                      className="hidden h-7 w-7 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-cream-dark hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent sm:flex"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveToEdge(product.id, 'bottom')}
                      disabled={index === products.length - 1}
                      aria-label={`Move ${heading} to bottom`}
                      title="Move to bottom"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowToBottom className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mx-1 h-5 w-px shrink-0 bg-charcoal/[0.08]" />

                  <button
                    type="button"
                    onClick={() => {
                      setEditing(product)
                      setCreating(false)
                    }}
                    aria-label={`Edit ${product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(product)}
                    aria-label={`Delete ${product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-light transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
            </div>
              )}
            </SortableRow>
          )
        })}

        {visible.length === 0 && (
          <div className="col-span-full rounded-2xl bg-white px-4 py-12 text-center">
            <p className="text-[13px] text-charcoal-light">
              {bulkMode
                ? `${bulkTokens.length} 个货号一个都没匹配上。`
                : filtering
                  ? '没有匹配这个搜索的商品。'
                  : '还没有商品。新增一个，或把出厂目录恢复回来。'}
            </p>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setCategory(ALL)
                }}
                className="mt-3 rounded-full bg-cream-dark px-3.5 py-1.5 text-[11px] font-medium text-charcoal transition hover:bg-cream-dark/70"
              >{t('Clear filters')}</button>
            )}
          </div>
        )}
      </div>
        </SortableContext>
      </DndContext>

      {/* Footer actions */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleExportJSON}
          className="flex items-center justify-center gap-2 rounded-full bg-charcoal py-3 text-[12px] font-medium text-cream transition active:scale-[0.97]"
        >
          <Download className="h-4 w-4" />{t('Export JSON')}</button>
        <button
          type="button"
          onClick={handleCopyJS}
          className="flex items-center justify-center gap-2 rounded-full bg-white py-3 text-[12px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25 active:scale-[0.97]"
        >
          <Copy className="h-4 w-4" />{t('Copy as products.js')}</button>
      </div>

      <button
        type="button"
        onClick={handleCopyAsinsJS}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-white py-2.5 text-[11.5px] font-medium text-charcoal/75 ring-1 ring-charcoal/10 transition hover:text-charcoal hover:ring-charcoal/25 active:scale-[0.98]"
      >
        <Copy className="h-3.5 w-3.5" />{t('Copy as asins.js')}</button>

      <button
        type="button"
        onClick={handleRefresh}
        className="mt-3 flex w-full items-center justify-center gap-1.5 text-[11.5px] text-charcoal-light transition hover:text-charcoal"
      >
        <Reset className="h-3.5 w-3.5" />{t('Refresh from the cloud')}</button>

      {/* Editor */}
      <ProductEditor
        open={!!editing}
        product={editing}
        isNew={creating}
        onSave={handleSave}
        onClose={() => {
          setEditing(null)
          setCreating(false)
        }}
        showToast={showToast}
      />

      {/* Single delete — a slip of the mouse must not destroy a 货号, so it is
          gated behind its own modal that names the exact product. */}
      <SingleDeleteDialog
        open={!!deleteTarget}
        product={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
      />

      {/* Bulk delete — irreversible, so it gets its own warning. Past 30% of the
          catalogue the circuit breaker forces a typed DELETE before it will fire. */}
      <BulkDeleteDialog
        open={confirmBulkDelete}
        products={selectedProducts}
        totalCount={products.length}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
      />

      {/* Batch badge — one write, two columns, nothing else. */}
      <BatchBadgeDialog
        open={batchBadgeOpen}
        products={selectedProducts}
        columnMissing={getBadgeColumnStatus() === 'missing'}
        subColumnMissing={getSubBadgeStatus() === 'missing'}
        onClose={() => setBatchBadgeOpen(false)}
        onApply={handleBatchBadge}
        onClear={handleBatchBadgeClear}
      />

      {/* Batch deal — five sale_* columns (+ optional pin), nothing else. */}
      <BatchDealDialog
        open={batchDealOpen}
        products={selectedProducts}
        columnMissing={getDealColumnStatus() === 'missing'}
        priorityColumnMissing={getPriorityColumnStatus() === 'missing'}
        campaignColumnMissing={getCampaignColumnStatus() === 'missing'}
        onClose={() => setBatchDealOpen(false)}
        onApply={handleBatchDeal}
        onClear={handleBatchDealClear}
      />

      {/* Batch category — one column, after the category row exists. */}
      <BatchCategoryDialog
        open={batchCategoryOpen}
        products={selectedProducts}
        categories={batchCategoryOptions}
        onClose={() => setBatchCategoryOpen(false)}
        onApply={handleBatchCategory}
      />

      {/* Import — nothing is written until 确认导入 in this dialog */}
      <ImportPreviewDialog
        open={!!importSheet && !!importPlan}
        plan={importPlan}
        fileName={importSheet?.fileName}
        busy={importBusy}
        hideNewSkus={hideNewSkus}
        onHideNewSkusChange={setHideNewSkus}
        onCancel={() => setImportSheet(null)}
        onConfirm={runImport}
      />

      <ImportResultDialog
        open={!!importResult}
        stats={importResult}
        onClose={() => setImportResult(null)}
      />

      {/* Deal import — matched by 货号, writes the five sale_* columns + 归属. */}
      <DealImportPreviewDialog
        open={!!dealSheet && !!dealPlan && !!dealTargets}
        plan={dealPlan}
        targets={dealTargets}
        fileName={dealSheet?.fileName}
        busy={dealBusy}
        columnMissing={getDealColumnStatus() === 'missing'}
        campaignColumnMissing={getCampaignColumnStatus() === 'missing'}
        dealKind={dealKind}
        onDealKindChange={setDealKind}
        onCancel={() => setDealSheet(null)}
        onConfirm={runDealImport}
      />

      <DealImportResultDialog
        open={!!dealResult}
        result={dealResult}
        onClose={() => setDealResult(null)}
      />
    </div>
  )
}

/* ───────────────── category row ───────────────── */

function CategoryRow({
  name,
  count,
  first,
  last,
  confirming,
  onRename,
  onMove,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}) {
  const [value, setValue] = useState(name)

  // Keep the field in sync when the list changes underneath (e.g. a rename
  // from another row, or a reset)
  useEffect(() => {
    setValue(name)
  }, [name])

  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-2.5 py-2">
        <p className="min-w-0 text-[10.5px] leading-snug text-red-800">{t('Delete')}<span className="font-medium">{name}</span>?
          {count > 0 &&
            ` ${count} product${count === 1 ? '' : 's'} will move to ${UNCATEGORISED}.`}
        </p>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onConfirmDelete}
            className="rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white"
          >{t('Delete')}</button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="rounded-full bg-white px-2.5 py-1 text-[10px] text-charcoal/70"
          >{t('Cancel')}</button>
        </div>
      </div>
    )
  }

  const commit = () => {
    const next = value.trim()
    if (!next || next === name) {
      setValue(name)
      return
    }
    onRename(name, next)
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Up/down rather than drag: there are five categories, they are one
          line each, and the whole list is visible at once — a drag target that
          small would be more fiddly than the two buttons. The order is
          `sort_order` in the categories table, which is also what the
          storefront rail reads. */}
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          onClick={() => onMove(name, -1)}
          disabled={first}
          aria-label={`Move ${name} up`}
          title="Move up"
          className="flex h-3.5 w-5 items-center justify-center text-charcoal-light/50 transition hover:text-charcoal disabled:opacity-20"
        >
          <ChevronUp className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(name, 1)}
          disabled={last}
          aria-label={`Move ${name} down`}
          title="Move down"
          className="flex h-3.5 w-5 items-center justify-center text-charcoal-light/50 transition hover:text-charcoal disabled:opacity-20"
        >
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        aria-label={`Rename ${name}`}
        className="min-w-0 flex-1 rounded-lg bg-cream-dark/60 px-2.5 py-1.5 text-[12px] text-charcoal focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-charcoal-light">
        {count}
      </span>
      <button
        type="button"
        onClick={onAskDelete}
        aria-label={`Delete category ${name}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-red-50 hover:text-red-500"
      >
        <Trash className="h-3 w-3" />
      </button>
    </div>
  )
}

/* ───────────────── bulk delete warning ───────────────── */

/* ───────────────── single delete ───────────────── */

/**
 * Shield 1 — one product, one deliberate click.
 * The row's trash icon opens this instead of deleting directly, so a stray
 * mouse slip cannot destroy a 货号. It names the exact product and the confirm
 * button is the only path to the write — Cancel / overlay / Esc all walk away.
 */
function SingleDeleteDialog({ open, product, onCancel, onConfirm }) {
  if (!product) return null
  const sku = product.sku || ''
  const name = product.name || 'this product'
  const subject = sku ? `${sku} (${name})` : name

  return (
    <Modal open={open} onClose={onCancel} title="永久删除商品" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug text-charcoal">
              确定要删除 {subject} 吗？
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-charcoal-light">{t('This action cannot be undone.')}</p>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full bg-cream-dark py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
          >{t('Cancel')}</button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-600 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-red-700 active:scale-[0.98]"
          >
            <Trash className="h-3.5 w-3.5" />{t('Delete')}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── batch badge ───────────────── */

/**
 * 批量改角标
 * ──────────
 * 黑五这种活动是"一夜之间给二十件商品挂同一个标"，一件件开编辑器不现实。
 *
 * 这个弹窗只做三件事：填文字、挑底色、选**写哪一行**（第一行活动标 / 第二行
 * 普通标）。
 *
 * 三条刻意的约束：
 * 1. 预览用的就是前台那枚药丸（`badgeStyle`），看到的颜色就是卡片上的颜色。
 * 2. 文字为空时「应用」是灰的 —— 要清空请走「清空角标」，那是明确的意思。
 * 3. 这两种写法各会落到第几行、有几件会看不见，**逐个数字列出来**。
 *    不说的话，运营第二天会来问"我设的黑五怎么没显示"。
 */
function BatchBadgeDialog({
  open,
  products,
  columnMissing,
  subColumnMissing,
  onClose,
  onApply,
  onClear,
}) {
  const [text, setText] = useState('')
  const [color, setColor] = useState('')
  /* 默认写第二行（普通标）：它能和已有的大促标并存，是最不容易出错的写法。 */
  const [mode, setMode] = useState('append')
  /* 第二行模式下可以顺手写一枚大促标（第一行）。默认**不参与**：没勾就写空
   * 会把运营早上填好的黑五标一次清掉。 */
  const [subOn, setSubOn] = useState(false)
  const [subText, setSubText] = useState('')
  const [subColor, setSubColor] = useState('')
  const [busy, setBusy] = useState(false)

  const count = products.length
  const draft = normaliseBadgeDraft({ text, color })
  /* 落位统计跟着模式变：覆盖写的是第一行的活动标，几乎每一件都能看见。 */
  const placement = placementCountsOf(products, Date.now(), { mode })
  const overwrite = mode === 'overwrite'
  const pickedColor = normaliseBadgeColor(color)
  const pill = badgeStyle(pickedColor)
  const subDraft = normaliseSubBadgeDraft({ text: subText, color: subColor })
  const subPill = badgeStyle(normaliseBadgeColor(subColor))

  /* 每次打开都从空白开始：上一次的黑五不该成为下一次的默认值。 */
  useEffect(() => {
    if (!open) return
    setText('')
    setColor('')
    setMode('append')
    setSubOn(false)
    setSubText('')
    setSubColor('')
    setBusy(false)
  }, [open])

  /* `undefined` = 这一次完全不碰大促标那一列（见 badgeWriteFor）。 */
  const sub = !overwrite && subOn && !subColumnMissing ? subDraft : undefined

  const apply = async () => {
    if ((!draft.tag && !sub) || busy) return
    setBusy(true)
    try {
      await onApply(draft, sub, mode)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onClear()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="批量改角标" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <p className="text-[11.5px] leading-relaxed text-charcoal-light">
          给 <span className="font-medium text-charcoal">{count} 件商品</span>
          统一设置角标。只写角标文字和颜色两列 —— 价格、秒杀、库存原样不动。
        </p>

        {/* ── 写哪一行 ──
            前台两行**都是文字角标**：第一行身份（大促标 / Limited Deal）、
            第二行运营标签；折扣不再是角标（手机端第二行会压住商品图）。所以
            顺序是"先定行、再写字"。以前是先写字再选"追加/覆盖"，而覆盖其实
            只写了第二行的槽位 —— 运营选完覆盖发现没变，只会怀疑功能坏了。 */}
        <div className="mt-4 space-y-1.5">
          {BADGE_WRITE_MODES.map((option) => {
            const active = mode === option.id
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2.5 transition ${
                  active ? 'bg-cream-dark/70 ring-1 ring-charcoal/15' : 'hover:bg-cream-dark/40'
                }`}
              >
                <input
                  type="radio"
                  name="batch-badge-mode"
                  value={option.id}
                  checked={active}
                  onChange={() => setMode(option.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-charcoal"
                />
                <span className="min-w-0">
                  <span className="text-[12px] font-medium text-charcoal">{option.label}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light">
                    {t(option.hint)}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <label className="mt-4 block">
          <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">
            {overwrite ? '活动标文字（第一行）' : '普通标文字（第二行）'}
          </span>
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
            }}
            maxLength={BATCH_BADGE_MAX}
            placeholder="例如 Black Friday"
            aria-label="Batch badge text"
            className="input-field mt-1 text-[13px]"
          />
        </label>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {BATCH_BADGE_QUICK_PICKS.map((pick) => {
            const on = text === pick
            return (
              <button
                key={pick}
                type="button"
                onClick={() => setText(pick)}
                aria-pressed={on}
                className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition ${
                  on ? 'bg-charcoal text-cream' : 'bg-cream-dark text-charcoal/70 hover:text-charcoal'
                }`}
              >
                {pick}
              </button>
            )
          })}
        </div>

        <div className="mt-4">
          <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">
            颜色
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {BADGE_COLOR_PRESETS.map((preset) => {
              const on = pickedColor === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setColor(preset.value)}
                  aria-label={`Batch badge colour ${preset.label}`}
                  aria-pressed={on}
                  style={{ backgroundColor: preset.value }}
                  className={`h-6 w-6 rounded-full transition ${
                    on ? 'ring-2 ring-charcoal ring-offset-2 ring-offset-cream' : 'hover:scale-110'
                  }`}
                />
              )
            })}

            {/* 任意颜色，不限于这六个：系统取色器只有一次点击的距离，文字色
                按底色亮度算（utils/badge.js），所以随便挑一个十六进制也读得清。 */}
            <label
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white text-[11px] text-charcoal-light ring-1 ring-charcoal/15 transition hover:ring-charcoal/35"
              title="Pick any colour"
            >
              <input
                type="color"
                value={pickedColor || '#2B2B2B'}
                onChange={(event) => setColor(event.target.value)}
                aria-label="Batch badge custom colour"
                className="sr-only"
              />
              +
            </label>

            {pickedColor && (
              <button
                type="button"
                onClick={() => setColor('')}
                className="rounded-full px-2 py-1 text-[10.5px] text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
              >
                默认
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-cream-dark/60 px-3 py-2.5">
          <span className="text-[10px] uppercase tracking-wider text-charcoal-light">预览</span>
          <span
            style={pill || undefined}
            className={`max-w-[70%] truncate rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
              pill ? '' : 'bg-charcoal/80 text-cream'
            }`}
          >
            {draft.tag || '角标文字'}
          </span>
          {draft.tag.length >= BATCH_BADGE_MAX && (
            <span className="text-[10px] text-amber-700">已截断到 {BATCH_BADGE_MAX} 字</span>
          )}
        </div>

        {/* 落位统计：这一块是"点完到底看得见几件"的答案。第二行模式里，正在
            秒杀的商品第一行是 Limited Deal，新标只能排第二行 —— 但**看得见**，
            所以这里老老实实写"第二行"，不再骗人说什么"被折扣挤掉"。 */}
        <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-emerald-50 px-2.5 py-2 ring-1 ring-emerald-200/60">
              <div className="text-[16px] font-semibold tabular-nums text-emerald-700">
                {placement.first}
              </div>
              <div className="text-[10px] text-emerald-800/70">显示在第一行</div>
            </div>
            <div className="rounded-xl bg-cream-dark/60 px-2.5 py-2 ring-1 ring-charcoal/10">
              <div className="text-[16px] font-semibold tabular-nums text-charcoal-light">
                {placement.second}
              </div>
              <div className="text-[10px] text-charcoal-light/70">排在第二行</div>
            </div>
            <div className="rounded-xl bg-amber-50 px-2.5 py-2 ring-1 ring-amber-200/60">
              <div className="text-[16px] font-semibold tabular-nums text-amber-700">
                {placement.hidden}
              </div>
              <div className="text-[10px] text-amber-800/70">完全看不见</div>
            </div>
        </div>

        {/* ── 大促标（sub_tag） ──
            只在"第二行"模式下出现：第一行模式本身写的就是大促标，再给一个
            同义输入框只会让人猜"这两个是不是打架"。不勾选就完全不碰那一列。 */}
        {!overwrite && (
        <div className="mt-4 rounded-xl bg-white p-3 ring-1 ring-charcoal/5">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={subOn}
              onChange={(event) => setSubOn(event.target.checked)}
              aria-label="Also update secondary badge"
              className="mt-0.5 h-3.5 w-3.5 accent-charcoal"
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-charcoal">
                同时设置第一行的大促标（如 Black Friday）
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light">
                不勾选则完全不动这一列。大促标永远第一行 —— 秒杀派生的 Limited Deal 压不住它。
              </span>
            </span>
          </label>

          {subOn && (
            <div className="mt-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={subText}
                  onChange={(event) => setSubText(event.target.value)}
                  maxLength={BATCH_BADGE_MAX}
                  placeholder="Black Friday"
                  aria-label="Batch secondary badge text"
                  className="input-field min-w-0 flex-1 text-[13px]"
                />
                <span
                  className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-charcoal/10"
                  style={{ backgroundColor: normaliseBadgeColor(subColor) || '#2B2B2B' }}
                  title="Pick any colour"
                >
                  <input
                    type="color"
                    value={normaliseBadgeColor(subColor) || '#2B2B2B'}
                    onChange={(event) => setSubColor(event.target.value.toUpperCase())}
                    aria-label="Batch secondary badge colour"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </span>
                <span
                  style={subPill || undefined}
                  className={`max-w-[30%] shrink-0 truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    subPill ? '' : 'bg-charcoal/80 text-cream'
                  }`}
                >
                  {subDraft.subTag || '—'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {BATCH_BADGE_QUICK_PICKS.map((pick) => (
                  <button
                    key={pick}
                    type="button"
                    onClick={() => setSubText(pick)}
                    aria-pressed={subText === pick}
                    className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition ${
                      subText === pick
                        ? 'bg-charcoal text-cream'
                        : 'bg-cream-dark text-charcoal/70 hover:text-charcoal'
                    }`}
                  >
                    {pick}
                  </button>
                ))}
                {subText && (
                  <button
                    type="button"
                    onClick={() => setSubText('')}
                    className="ml-1 text-[10px] text-charcoal-light transition hover:text-charcoal"
                  >
                    清除
                  </button>
                )}
              </div>

              {!subDraft.subTag && (
                <p className="text-[10px] leading-relaxed text-amber-700">
                  文字留空会把所选商品的大促标全部清掉。
                </p>
              )}

              {subColumnMissing && (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                  sub_tag 列不存在，大促标存不进去。先在 Supabase 跑一次
                  supabase/11-sub-badge-deal-priority.sql。
                </p>
              )}
            </div>
          )}
        </div>
        )}

        {/* 第二行模式下最该说清的一件事：正在秒杀的商品，第一行是系统派生的
            Limited Deal，标题只会出现在第二行。想让它当第一行，切到「第一行 ·
            活动标」—— 这句话以前写成"前台看不到"，那是错的。 */}
        {!columnMissing && mode === 'append' && placement.second > 0 && (
          <p className="mt-3 rounded-lg bg-cream-dark/60 px-2 py-1.5 text-[10px] leading-relaxed text-charcoal-light ring-1 ring-charcoal/10">
            其中 {placement.second} 件已经有身份（大促标 / 秒杀）：常规目录里标题排在第二行，
            秒杀专区里它自己会升到第一行。想让「{draft.tag || '这段文字'}」直接当第一行，
            请改选「第一行 · 活动标」。
          </p>
        )}

        {!columnMissing && mode === 'overwrite' && (
          <p className="mt-3 rounded-lg bg-cream-dark/60 px-2 py-1.5 text-[10px] leading-relaxed text-charcoal-light ring-1 ring-charcoal/10">
            这段文字会写进<strong>大促标</strong>（替换原来那枚，普通标不动）。
            进了同名专区（如 Black Friday 专区）之后它会自动隐藏 —— 整页都是这场活动，不必每张卡再挂一遍。
          </p>
        )}

        {!columnMissing && mode === 'append' && placement.hidden > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            另外 {placement.hidden} 件是 Coming Soon：那枚角标独占一行，写进去也不会显示。
          </p>
        )}

        {columnMissing && (
          <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            badge_color 列不存在，颜色存不进去（文字会照常保存）。先在 Supabase 跑一次
            supabase/07-badge-color.sql。
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="mr-auto rounded-full px-2.5 py-2 text-[11.5px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
          >
            清空角标
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-cream-dark px-4 py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
          >
            取消
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={(!draft.tag && !sub) || busy}
            className="rounded-full bg-charcoal px-4 py-2.5 text-[12.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '保存中…' : `应用到 ${count} 件`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── bulk delete ───────────────── */

/**
 * Shield 2 — the circuit breaker.
 * Below 30% of the catalogue this is a normal one-click confirm. Above it the
 * selection is almost certainly a mistake (a stray "select all" on 190 rows),
 * so the confirm button is dead until the operator types the word DELETE — a
 * deliberate, keyboard-only act that a click cannot stumble into.
 */
function BulkDeleteDialog({ open, products, totalCount, onCancel, onConfirm }) {
  const count = products.length
  const guard = computeBulkDeleteGuard(count, totalCount)
  const [confirmText, setConfirmText] = useState('')

  // Fresh typed confirmation every time the dialog (re)opens.
  useEffect(() => {
    if (open) setConfirmText('')
  }, [open])

  const preview = products.slice(0, 6).map((p) => p.sku || p.name)
  const asinTotal = products.reduce((sum, p) => sum + (p.sku ? 1 : 0), 0)

  // Dead until DELETE is typed in the circuit-breaker branch; a small selection
  // stays a single click.
  const blocked = guard.overThreshold && confirmText !== 'DELETE'

  return (
    <Modal open={open} onClose={onCancel} title="永久删除所选商品" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug text-charcoal">
              Delete {count} product{count === 1 ? '' : 's'} permanently?
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-charcoal-light">{t('This cannot be undone.')}</p>
          </div>
        </div>

        {/* The warning ops must actually read */}
        <div className="mt-4 rounded-xl bg-red-50 px-3.5 py-3 ring-1 ring-red-200/70">
          <p className="text-[12px] font-medium leading-relaxed text-red-800">
            彻底删除不可恢复，且绝对不能重排剩余商品的 id，否则历史码会失效！
          </p>
        </div>

        <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-charcoal-light">
          <p>
            · 剩余商品的 id 保持不变，已经发出去的选品码照样能用。
          </p>
          <p>
            · 它们的 ASIN 映射会从 asins.js 删掉
            {asinTotal ? `（${asinTotal} 个货号）` : ''} —— 搜索里不会留下孤儿 ASIN。
          </p>
        </div>

        {preview.length > 0 && (
          <div className="mt-3 rounded-xl bg-cream-dark/70 px-3 py-2">
            <div className="text-[10px] font-medium tracking-wider text-charcoal-light">{t('Being deleted')}</div>
            <p className="mt-1 break-words font-mono text-[11px] text-charcoal/75">
              {preview.join(', ')}
              {count > preview.length && ` … 还有 ${count - preview.length} 件`}
            </p>
          </div>
        )}

        {/* Circuit breaker — a selection that is more than 30% of the catalogue
            is treated as a probable mistake and forced through a typed confirm. */}
        {guard.overThreshold && (
          <div className="mt-4 rounded-xl border-2 border-red-500 bg-red-50 px-3.5 py-3">
            <p className="text-[12.5px] font-semibold leading-relaxed text-red-700">
              这会永久删除 {count} 件商品（占全库 {guard.percent}%），不可撤销。
            </p>
            <label className="mt-3 block text-[11px] font-medium text-red-800">{t('Type')}<span className="font-mono font-bold">DELETE</span>{t('to enable deletion')}</label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
              aria-label="Type DELETE to confirm bulk deletion"
              className="mt-1.5 w-full rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-[13px] tracking-widest text-charcoal outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
            />
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full bg-cream-dark py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
          >{t('Cancel')}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={blocked}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-600 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-red-300 disabled:hover:bg-red-300"
          >
            <Trash className="h-3.5 w-3.5" />{t('Delete permanently')}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── import preview ───────────────── */

/**
 * Everything the operator has to agree to before a byte is written.
 *
 * The four counts are the ones that decide whether this sheet is safe to run:
 * how many 货号 are new (and will therefore be hidden), how many merge into
 * products ops has already curated, which rows cannot become variants at all,
 * and how many variants will exist without an ASIN. Anything else — conflicts,
 * duplicate rows, a 货号 spelled differently than the database — is a footnote,
 * because none of it changes what gets written.
 */
function ImportPreviewDialog({
  open,
  plan,
  fileName,
  busy,
  hideNewSkus,
  onHideNewSkusChange,
  onCancel,
  onConfirm,
}) {
  if (!plan) return null
  const s = plan.summary
  const nothingToWrite = planIsEmpty(plan)
  const errors = plan.parse.rejected

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title="导入预览"
      maxWidth="max-w-lg"
    >
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Upload className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold leading-snug text-charcoal">
              {fileName}
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-charcoal-light">
              货号 | ASIN | 颜色 | 尺寸 · 只追加颜色/尺码与 ASIN，绝不覆盖已有商品属性
            </p>
          </div>
        </div>

        {!plan.parse.headerLooksRight && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[11.5px] leading-relaxed text-amber-900/85">
              第一行不像表头（期望：货号 | ASIN | 颜色 | 尺寸）—— 已按列序强行读取，请核对下面的数量。
            </p>
          </div>
        )}

        {/* The four numbers that decide whether to run this sheet */}
        <div className="mt-4 space-y-2">
          <PreviewRow
            tone="new"
            label="全新货号"
            value={s.newSkus}
            hint="将被创建，默认隐藏"
          />
          <PreviewRow
            tone="merge"
            label="已有货号"
            value={s.mergedSkus}
            hint="将合并追加颜色/尺码与 ASIN"
          />
          <PreviewRow
            tone="error"
            label="严重格式错误"
            value={s.errorRows}
            unit="行"
            hint="缺货号/颜色/尺寸，无法建立变体，已跳过"
          />
          <PreviewRow
            tone="warn"
            label="缺少 ASIN"
            value={s.missingAsinRows}
            unit="行"
            hint="变体会照常建立，可稍后在编辑器补填"
          />
        </div>

        {errors.length > 0 && (
          <div className="mt-2 rounded-xl bg-red-50/70 px-3.5 py-2.5 ring-1 ring-red-200/60">
            <div className="text-[10px] font-medium tracking-wider text-red-700/80">
              被跳过的行
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-red-800/90">
              {errors.slice(0, 8).map((row) => (
                <li key={row.row}>
                  第 {row.row} 行 · {row.reason}
                </li>
              ))}
            </ul>
            {errors.length > 8 && (
              <p className="mt-1 text-[11px] text-red-700/70">…还有 {errors.length - 8} 行</p>
            )}
          </div>
        )}

        {/* Footnotes: reported, never silently applied */}
        {(plan.conflicts.length > 0 ||
          plan.droppedDuplicates > 0 ||
          plan.spellingFixes.length > 0 ||
          s.invalidAsinRows > 0) && (
          <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-charcoal-light">
            {plan.conflicts.length > 0 && (
              <p>
                · 同一变体给了两个不同 ASIN：{plan.conflicts.length} 处 —— 保留表中先出现的那一个
              </p>
            )}
            {s.invalidAsinRows > 0 && (
              <p>
                · {s.invalidAsinRows} 行 ASIN 格式不对（不是 10 位字母数字）—— 该 ASIN 已跳过，变体照常建立
              </p>
            )}
            {plan.droppedDuplicates > 0 && (
              <p>· {plan.droppedDuplicates} 行与前行完全重复，已合并</p>
            )}
            {plan.spellingFixes.length > 0 && (
              <p>
                · {plan.spellingFixes.length} 行货号大小写/空格与库中不一致，已按库中写法合并（如{' '}
                {plan.spellingFixes[0].from} → {plan.spellingFixes[0].to}）
              </p>
            )}
          </div>
        )}

        {/* Per-货号 detail */}
        {plan.details.length > 0 && (
          <div className="mt-3 rounded-xl bg-cream-dark/60 px-3 py-2.5">
            <div className="text-[10px] font-medium tracking-wider text-charcoal-light">
              按货号
            </div>
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-[11px] leading-relaxed">
              {plan.details.slice(0, 12).map((row) => (
                <li key={row.sku} className="flex items-baseline gap-1.5">
                  <span
                    className={
                      row.kind === 'new'
                        ? 'shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[9.5px] font-medium text-emerald-700'
                        : 'shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[9.5px] font-medium text-amber-700'
                    }
                  >
                    {row.kind === 'new' ? '新建' : '合并'}
                  </span>
                  <span className="truncate font-medium text-charcoal">{row.sku}</span>
                  <span className="shrink-0 text-charcoal-light">
                    {row.variants} 个变体
                    {row.kind === 'merge' && row.newColours + row.newSizes > 0
                      ? ` · 新增 ${row.newColours} 颜色 / ${row.newSizes} 尺码`
                      : ''}
                    {row.asins < row.variants ? ` · ${row.variants - row.asins} 个无 ASIN` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {plan.details.length > 12 && (
              <p className="mt-1 text-[11px] text-charcoal-light">…还有 {plan.details.length - 12} 个货号</p>
            )}
          </div>
        )}

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl bg-white px-3.5 py-3 ring-1 ring-charcoal/[0.07]">
          <input
            type="checkbox"
            checked={hideNewSkus}
            onChange={(event) => onHideNewSkusChange(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
          />
          <span className="text-[11.5px] leading-relaxed text-charcoal-light">
            新建货号先设为隐藏（<span className="font-medium text-charcoal">hidden = true</span>
            ）—— 前台看不到，补完图再去列表里取消隐藏。已有货号的状态永不动。
          </span>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full bg-cream-dark py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || nothingToWrite}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent py-2.5 text-[12.5px] font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            {busy ? '导入中…' : '确认导入'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** One of the four headline counts. Colour carries the meaning, so the number
 *  and the word never have to be re-read to find out which kind of row it is. */
function PreviewRow({ tone, label, value, unit = '个', hint }) {
  const tones = {
    new: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
    merge: 'bg-amber-50 text-amber-700 ring-amber-200/70',
    error: 'bg-red-50 text-red-700 ring-red-200/70',
    warn: 'bg-orange-50 text-orange-700 ring-orange-200/70',
  }
  return (
    <div
      data-import-stat={tone}
      className="flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-charcoal/[0.07]"
    >
      <span
        data-import-value={tone}
        className={`flex h-7 min-w-[3.25rem] shrink-0 items-center justify-center rounded-full px-2 text-[13px] font-semibold tabular-nums ring-1 ${tones[tone]}`}
      >
        {value}
        <span className="ml-0.5 text-[10px] font-normal">{unit}</span>
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-charcoal">{label}</div>
        <div className="text-[11px] leading-relaxed text-charcoal-light">{hint}</div>
      </div>
    </div>
  )
}

/* ───────────────── import result ───────────────── */

function ImportResultDialog({ open, stats, onClose }) {
  if (!stats) return null
  const asins = stats.asinsAdded + stats.asinsUpdated

  return (
    <Modal open={open} onClose={onClose} title="导入完成" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug text-charcoal">导入完成</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-charcoal-light">
              新建 {stats.created} 个货号 · 合并 {stats.merged} 个货号 · 补填 {asins} 条 ASIN
              {stats.asinsUpdated > 0 && `（更新 ${stats.asinsUpdated} 条原有值）`}
            </p>
          </div>
        </div>

        {stats.variantsWithoutAsin > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
            <p className="text-[11.5px] leading-relaxed text-amber-900/85">
              还有 {stats.variantsWithoutAsin} 个变体没有 ASIN —— 在编辑器里逐个补填，不影响已经建好的颜色/尺码。
            </p>
          </div>
        )}

        {stats.skipped.length > 0 && (
          <div className="mt-3 rounded-xl bg-red-50 px-3.5 py-3 ring-1 ring-red-200/60">
            <div className="text-[10px] font-medium tracking-wider text-red-700/80">
              {stats.skipped.length} 个货号没写进去
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-red-800/90">
              {stats.skipped.map((row) => (
                <li key={row.sku}>
                  {row.sku} · {row.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-accent py-2.5 text-[12.5px] font-medium text-white transition hover:bg-accent-dark active:scale-[0.98]"
          >
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── deal import ───────────────── */

/**
 * 秒杀导入预览
 * ──────────────
 * 确认前先看清三件事：匹配成功多少个货号、没找到多少个、以及表格本身有多少行
 * 因为格式问题被跳过（缺列 / 日期解析失败 / 价格解析失败）。确认才写库，
 * 取消零副作用。
 */
/* 导入 / 批量开秒杀时**必选**的一项。纯文字、不带图标 —— 这两类不是
 * "更好看 / 更醒目"的选择，而是决定这批商品进前台的哪个 Tab：
 * 常规秒杀按紧迫度、卡片带倒计时；大促按折扣区间、按折扣从高到低。 */
const DEAL_KINDS = [
  { id: 'regular', label: 'Regular Deals', hint: '常规秒杀 · 按紧迫度排序，卡片带倒计时' },
  { id: 'campaign', label: 'Campaign Deals', hint: '大促 · 按折扣区间浏览，按折扣从高到低' },
]

/**
 * 归属单选。`value` 为空 = 还没选，调用方的确认按钮应当禁用 ——
 * "必须选择"是需求原文，给个默认值等于让运营在不知情时把大促表导成常规。
 */
function DealTypeChoice({ value, onChange, disabled = false, missing = false }) {
  return (
    <fieldset className="mt-4" disabled={disabled}>
      <legend className="text-[10px] font-medium tracking-wider text-charcoal-light">
        这批属于哪一类
      </legend>
      <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {DEAL_KINDS.map((option) => {
          const on = value === option.id
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2.5 transition ${
                on
                  ? 'bg-accent/[0.08] ring-1 ring-accent/40'
                  : 'bg-cream-dark/50 ring-1 ring-charcoal/5 hover:ring-charcoal/15'
              }`}
            >
              <input
                type="radio"
                name="deal-kind"
                value={option.id}
                checked={on}
                onChange={() => onChange(option.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-charcoal">{option.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-charcoal-light">
                  {option.hint}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      {!value && (
        <p className="mt-1.5 text-[10px] text-amber-700">
          选择后才能继续 —— 它决定这批商品进哪个 Tab。
        </p>
      )}
      {missing && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">
          数据库没有 is_campaign 列，选「Campaign Deals」也会存成常规。
          先在 Supabase 跑一次 supabase/13-campaign.sql。
        </p>
      )}
    </fieldset>
  )
}

function DealImportPreviewDialog({
  open,
  plan,
  targets,
  fileName,
  busy,
  columnMissing,
  campaignColumnMissing,
  dealKind,
  onDealKindChange,
  onCancel,
  onConfirm,
}) {
  if (!plan || !targets) return null
  const matchedCount = targets.matched.length
  const missingCount = targets.missing.length
  const problemCount = plan.problems.length
  /* 没有原价的行：前台会隐藏划线价，只留秒杀价 + 折扣率。提前说一句，
   * 免得运营导完去看卡片，以为划线价"丢了"。 */
  const withoutOriginal = plan.plan.filter((deal) => !deal.originalPrice).length

  return (
    <Modal open={open} onClose={onCancel} title="Import deals" maxWidth="max-w-lg">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <p className="text-[11.5px] leading-relaxed text-charcoal-light">
          <span className="font-medium text-charcoal">{fileName}</span> · 按主卖货号 / 货号
          匹配，写入开始/结束时间（补全 00:00:00 与 23:59:59）、秒杀价、原价（可选）
          与折扣率（可选），以及这批商品的归属。
        </p>

        <DealTypeChoice
          value={dealKind}
          onChange={onDealKindChange}
          disabled={busy}
          missing={campaignColumnMissing}
        />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50 px-3 py-3 ring-1 ring-emerald-200/60">
            <div className="text-[20px] font-semibold tabular-nums text-emerald-700">{matchedCount}</div>
            <div className="text-[10px] text-emerald-800/70">匹配成功</div>
          </div>
          <div className="rounded-xl bg-amber-50 px-3 py-3 ring-1 ring-amber-200/60">
            <div className="text-[20px] font-semibold tabular-nums text-amber-700">{missingCount}</div>
            <div className="text-[10px] text-amber-800/70">未找到货号</div>
          </div>
          <div className="rounded-xl bg-cream-dark/60 px-3 py-3 ring-1 ring-charcoal/10">
            <div className="text-[20px] font-semibold tabular-nums text-charcoal-light">{problemCount}</div>
            <div className="text-[10px] text-charcoal-light/70">格式问题行</div>
          </div>
        </div>

        {withoutOriginal > 0 && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-charcoal-light">
            {withoutOriginal} 行没有原价 —— 前台会只显示秒杀价和折扣率，不显示划线价。
          </p>
        )}

        {columnMissing && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
            <p className="text-[11.5px] leading-relaxed text-amber-900/85">
              sale_* 列不存在，秒杀信息无法写入。先在 Supabase 跑一次
              supabase/09-deal.sql 再导入。
            </p>
          </div>
        )}

        {missingCount > 0 && (
          <div className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
            <div className="text-[10px] font-medium tracking-wider text-amber-800/80">
              未找到的货号（会被跳过）
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {targets.missing.map((sku) => (
                <span
                  key={sku}
                  className="rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] tabular-nums text-amber-900/80"
                >
                  {sku}
                </span>
              ))}
            </div>
          </div>
        )}

        {problemCount > 0 && (
          <div className="mt-2 max-h-32 overflow-y-auto rounded-xl bg-red-50 px-3.5 py-3 ring-1 ring-red-200/60">
            <div className="text-[10px] font-medium tracking-wider text-red-700/80">
              被跳过的行
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-red-800/90">
              {plan.problems.map((problem) => (
                <li key={problem.row}>
                  {problem.row === 0 ? problem.reason : `第 ${problem.row} 行 · ${problem.reason}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full bg-cream-dark px-4 py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal disabled:opacity-40"
          >{t('Cancel')}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || matchedCount === 0 || columnMissing || !dealKind}
            className="ml-auto rounded-full bg-accent px-4 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-accent-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '保存中…' : `应用到 ${matchedCount} 个`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DealImportResultDialog({ open, result, onClose }) {
  if (!result) return null

  return (
    <Modal open={open} onClose={onClose} title="秒杀导入完成" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug text-charcoal">秒杀信息已写入</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-charcoal-light">
              成功 {result.written} 个货号
              {result.missing?.length ? ` · 未找到 ${result.missing.length} 个` : ''}
              {result.problems?.length ? ` · 跳过 ${result.problems.length} 行` : ''}
            </p>
          </div>
        </div>

        {result.missing?.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
            <div className="text-[10px] font-medium tracking-wider text-amber-800/80">未找到的货号</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {result.missing.map((sku) => (
                <span
                  key={sku}
                  className="rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] tabular-nums text-amber-900/80"
                >
                  {sku}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-accent py-2.5 text-[12.5px] font-medium text-white transition hover:bg-accent-dark active:scale-[0.98]"
          >
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── batch deal ───────────────── */

/**
 * 批量开秒杀
 * ────────────
 * 黑五前一天要给三十件商品挂同一个窗口，一件件点开编辑器不现实。
 *
 * 这个弹窗只做一件事：把**同一组**原价 / 折后价 / 日期写成那五列。它不碰
 * 价格以外的任何字段（见 store 的 setProductsDeals），所以"批量开秒杀"永远
 * 不会顺手改掉库存、角标或排序。
 *
 * 置顶是可选的一项：留空 = 不动 `deal_priority`。这条很重要 —— 早上刚钉好
 * 的二十件商品，下午只想延后一天结束时，不该被"留空"重置成不置顶。
 */
function BatchDealDialog({
  open,
  products,
  columnMissing,
  priorityColumnMissing,
  campaignColumnMissing,
  onClose,
  onApply,
  onClear,
}) {
  const [form, setForm] = useState({
    originalPrice: '',
    salePrice: '',
    startDate: '',
    endDate: '',
    priority: '',
    /* 归属必选：这一批进常规 Tab 还是大促 Tab。空 = 还没选。 */
    dealKind: '',
  })
  const [busy, setBusy] = useState(false)

  const count = products.length
  /* 每次打开都从空白开始：上一次的窗口不该成为下一次的默认值。 */
  useEffect(() => {
    if (!open) return
    setForm({
      originalPrice: '',
      salePrice: '',
      startDate: '',
      endDate: '',
      priority: '',
      dealKind: '',
    })
    setBusy(false)
  }, [open])

  const { deal, error } = buildDealFromDates(form)
  const priority = parsePriorityInput(form.priority)
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  /* 一个真实用得到的预设：黑五周末。今天 + 7 天，省两次点日历。 */
  const nextWeek = () => {
    const now = new Date()
    const plus = (days) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    setForm((prev) => ({ ...prev, startDate: plus(0), endDate: plus(6) }))
  }

  const apply = async () => {
    if (error || busy || !form.dealKind) return
    setBusy(true)
    /* 失败由调用方 toast，弹窗自己保持打开、把按钮解回可点状态。 */
    try {
      await onApply(form)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onClear()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="批量改秒杀" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <p className="text-[11.5px] leading-relaxed text-charcoal-light">
          给 <span className="font-medium text-charcoal">{count} 件商品</span>
          设置同一个时间窗。只写秒杀那五个字段、这批的归属（外加你填了的置顶
          权重）—— 价格、库存、角标、排序都原样保留。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Original price')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.originalPrice}
              onChange={set('originalPrice')}
              placeholder="49.99"
              aria-label="Batch original price"
              className="input-field mt-1 text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Sale price')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.salePrice}
              onChange={set('salePrice')}
              placeholder="29.99"
              aria-label="Batch sale price"
              className="input-field mt-1 text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Starts')}</span>
            <input
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
              aria-label="Batch sale start"
              className="input-field mt-1 text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Ends')}</span>
            <input
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              aria-label="Batch sale end"
              className="input-field mt-1 text-[13px]"
            />
          </label>
        </div>

        <DealTypeChoice
          value={form.dealKind}
          onChange={(id) => setForm((prev) => ({ ...prev, dealKind: id }))}
          disabled={busy}
          missing={campaignColumnMissing}
        />

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={nextWeek}
            className="rounded-full bg-cream-dark px-2.5 py-1 text-[10.5px] font-medium text-charcoal transition hover:bg-cream-dark/70"
          >{t('Next 7 days')}</button>
          <span className="text-[10px] text-charcoal-light/70">{t('ends include the whole day (23:59:59)')}</span>
        </div>

        <div className="mt-4 flex items-start gap-2">
          <label className="block w-24 shrink-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Pin')}</span>
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              value={form.priority}
              onChange={set('priority')}
              placeholder="—"
              aria-label="Batch deal priority"
              disabled={priorityColumnMissing}
              className="input-field mt-1 text-[13px] disabled:opacity-50"
            />
          </label>
          <p className="mt-4 min-w-0 flex-1 text-[10px] leading-relaxed text-charcoal-light">
            数值越大越靠前（只在秒杀专区内生效）。留空 = 保持每件商品原有的置顶权重不变。
          </p>
        </div>

        {/* 预览：写进去的就是这几个字符串，不是"差不多的日期"。 */}
        <div className="mt-3 rounded-xl bg-cream-dark/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-charcoal-light">{t('Preview')}</span>
            {deal ? (
              <span className="truncate rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white">
                ⚡ {form.salePrice} / 原价 {form.originalPrice}
              </span>
            ) : (
              <span className="text-[10px] text-charcoal-light/60">{t('fill the four fields')}</span>
            )}
          </div>
          {deal && (
            <p className="mt-1 text-[10px] leading-relaxed text-charcoal/70">
              {deal.saleStart} → {deal.saleEnd}
              {priority !== null && ` · pin ${priority}`}
            </p>
          )}
          {error && (
            <p className="mt-1 text-[10px] font-medium text-red-600">{error}</p>
          )}
        </div>

        {columnMissing && (
          <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            sale_* 列不存在，秒杀写不进去。先在 Supabase 跑一次
            supabase/09-deal.sql。
          </p>
        )}

        {priorityColumnMissing && !columnMissing && (
          <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            置顶存不进去：缺 deal_priority 列。先在 Supabase 跑一次
            supabase/11-sub-badge-deal-priority.sql（秒杀本身不受影响）。
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="mr-auto rounded-full px-2.5 py-2 text-[11.5px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
          >{t('Clear deal')}</button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-cream-dark px-4 py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
          >{t('Cancel')}</button>
          <button
            type="button"
            onClick={apply}
            disabled={Boolean(error) || busy || columnMissing || !form.dealKind}
            className="rounded-full bg-charcoal px-4 py-2.5 text-[12.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '保存中…' : `应用到 ${count} 件`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── batch category ───────────────── */

const NEW_CATEGORY = '__new__'

/**
 * 批量改分类
 * ────────────
 * 两种语义都摆出来，因为"覆盖还是追加"取决于这批货从哪来：
 *   - 刚导入的 40 件还在 Uncategorised → 想"只补空的"
 *   - 从夏季挪到秋季的一批 → 想"全部覆盖"
 *
 * 一个商品只有一个 category 列（FK 指向 categories.name），所以"追加"不可能
 * 真的变成两个分类 —— 这里的第二种是"只补没分类的"，并且把真实影响件数
 * 直接印在选项上，而不是让运营自己猜。
 */
function BatchCategoryDialog({ open, products, categories, onClose, onApply }) {
  const [choice, setChoice] = useState('')
  const [custom, setCustom] = useState('')
  const [mode, setMode] = useState('replace')
  const [busy, setBusy] = useState(false)

  const count = products.length
  const fillCount = countFillTargets(products, UNCATEGORISED)

  useEffect(() => {
    if (!open) return
    setChoice('')
    setCustom('')
    setMode('replace')
    setBusy(false)
  }, [open])

  const isNew = choice === NEW_CATEGORY
  const typed = isNew ? custom : choice
  const { name, isNew: willCreate } = resolveCategoryName(typed, categories)

  const apply = async () => {
    if (!name || busy) return
    setBusy(true)
    try {
      await onApply({ category: name, mode })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="批量改分类" maxWidth="max-w-md">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <p className="text-[11.5px] leading-relaxed text-charcoal-light">
          把 <span className="font-medium text-charcoal">{count} 件商品</span>
          移到一个分类。只写分类这一列，别的不动。
        </p>

        <div className="mt-4">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('Category')}</span>
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              aria-label="Batch category"
              className="input-field mt-1 text-[13px]"
            >
              <option value="">{t('Choose a category…')}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
              <option value={NEW_CATEGORY}>{t('＋ New category…')}</option>
            </select>
          </label>

          {isNew && (
            <label className="mt-2 block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-charcoal-light">{t('New category name')}</span>
              <input
                type="text"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="例如 Black Friday"
                aria-label="New batch category name"
                className="input-field mt-1 text-[13px]"
              />
              {willCreate && name && (
                <span className="mt-1 block text-[10px] text-charcoal-light/70">{t('will be added to the categories table')}</span>
              )}
            </label>
          )}
        </div>

        <div className="mt-4 space-y-1.5">
          {CATEGORY_MODES.map((option) => {
            const affected = option.id === 'fill' ? fillCount : count
            const active = mode === option.id
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2.5 transition ${
                  active ? 'bg-cream-dark/70 ring-1 ring-charcoal/15' : 'hover:bg-cream-dark/40'
                }`}
              >
                <input
                  type="radio"
                  name="batch-category-mode"
                  value={option.id}
                  checked={active}
                  onChange={() => setMode(option.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-charcoal"
                />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-medium text-charcoal">{t(option.label)}</span>
                    <span className="text-[10px] tabular-nums text-charcoal-light">
                      {affected} 件
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light">
                    {option.hint}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-cream-dark px-4 py-2.5 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
          >{t('Cancel')}</button>
          <button
            type="button"
            onClick={apply}
            disabled={!name || busy || (mode === 'fill' && fillCount === 0)}
            className="ml-auto rounded-full bg-charcoal px-4 py-2.5 text-[12.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '保存中…' : name ? `移到「${name}」` : `移动 ${count} 件`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
