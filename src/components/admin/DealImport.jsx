import { useMemo, useRef, useState } from 'react'
import { useProducts } from '../../hooks/useProducts.js'
import { useToast } from '../../hooks/useToast.js'
import { readSheetGrid } from '../../utils/sheetFile.js'
import { dropsCampaignTag } from '../../utils/deal.js'
import { planDealImport, resolveDealTargets } from '../../utils/dealImport.js'
import { loadProducts, setProductsDeals } from '../../store/productStore.js'
import { appendDealSlots } from '../../store/dealStore.js'
import { Sparkle } from '../../components/icons.jsx'
import { t } from '../../i18n/admin.js'
import {
  DealImportPreviewDialog,
  DealImportResultDialog,
} from '../../pages/admin/ProductsPage.jsx'

/**
 * 导入秒杀（档期页的入口）
 * ═══════════════════════
 *
 * 原来这个按钮在商品库，逻辑一样，只是挪到「秒杀档期」——因为运营的心智是
 * "我在排期，所以我在排期页导入"。
 *
 * 一次导入做两件事：
 *   1. 把这一批的"当前档期"写回 `products`（兼容旧逻辑、卡片立刻有价）；
 *   2. 把**每一行**追加进 `deals`（同一货号可以有多档，互不覆盖）。
 */
export default function DealImport({ onImported }) {
  const products = useProducts()
  const { showToast } = useToast()
  const fileRef = useRef(null)

  const [sheet, setSheet] = useState(null)
  const [kind, setKind] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const plan = useMemo(() => (sheet ? planDealImport(sheet.grid) : null), [sheet])
  const targets = useMemo(() => {
    if (!plan) return null
    const bySku = new Map(products.map((p) => [p.sku, p.id]))
    return resolveDealTargets(plan.plan, bySku)
  }, [plan, products])

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const grid = await readSheetGrid(file)
      setSheet({ grid, fileName: file.name })
      setKind('')
    } catch (err) {
      showToast?.(`Could not read ${file.name}: ${err.message}`, 'error', 6000)
    }
  }

  const run = async () => {
    if (!targets || !targets.matched.length || busy || !kind) return
    setBusy(true)

    const byId = new Map(products.map((product) => [String(product.id), product]))
    const droppedTags = targets.matched.filter(({ id, deal }) =>
      dropsCampaignTag(byId.get(String(id)), deal),
    ).length

    try {
      /* 商品行只能装一档：按 id 去重，只写"最早开始"的那一档。 */
      const firstById = new Map()
      for (const target of targets.matched) {
        const current = firstById.get(target.id)
        if (!current || String(target.deal.saleStart) < String(current.deal.saleStart)) {
          firstById.set(target.id, target)
        }
      }

      const count = await setProductsDeals([...firstById.values()], {
        isCampaign: kind === 'campaign',
      })

      try {
        await appendDealSlots(
          targets.matched.map(({ sku, deal }) => ({
            sku,
            saleStart: deal.saleStart,
            saleEnd: deal.saleEnd,
            salePrice: deal.salePrice,
            originalPrice: deal.originalPrice,
            discountLabel: deal.discountLabel,
            isCampaign: kind === 'campaign',
          })),
        )
      } catch (slotError) {
        showToast?.(`档期表未写入：${slotError.message}`, 'error', 6000)
      }

      await loadProducts({ silent: true })
      setSheet(null)
      setResult({ written: count, missing: targets.missing, problems: plan.problems })
      showToast?.(
        `${kind === 'campaign' ? 'Campaign' : 'Regular'} deals set on ${count} product${
          count === 1 ? '' : 's'
        }` +
          (droppedTags ? ` · ${droppedTags} old campaign label${droppedTags === 1 ? '' : 's'} cleared` : ''),
        'success',
        4000,
      )
      onImported?.()
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[11.5px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/30"
      >
        <Sparkle className="h-3.5 w-3.5" />
        {t('Import Deals')}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFile}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-file-role="deals"
      />

      <DealImportPreviewDialog
        open={Boolean(sheet && plan && targets)}
        plan={plan}
        targets={targets}
        fileName={sheet?.fileName}
        busy={busy}
        dealKind={kind}
        onDealKindChange={setKind}
        onCancel={() => setSheet(null)}
        onConfirm={run}
      />

      <DealImportResultDialog open={Boolean(result)} result={result} onClose={() => setResult(null)} />
    </>
  )
}
