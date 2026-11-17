import { useMemo, useState } from 'react'
import { useDealRows } from '../../hooks/useDealSlots.js'
import { useProducts } from '../../hooks/useProducts.js'
import {
  deleteDealSlot,
  deleteEndedDealSlots,
  getDealSlotsError,
  getDealSlotsStatus,
  setProductDiscountLabel,
  updateDealSlot,
} from '../../store/dealStore.js'
import { useToast } from '../../hooks/useToast.js'
import { Trash } from '../../components/icons.jsx'
import DealImport from '../../components/admin/DealImport.jsx'
import { loadDealSlots } from '../../store/dealStore.js'

/**
 * 秒杀档期（/admin/periods）
 * ═════════════════════════
 *
 * 一个货号可以有多个秒杀时间窗。这张表是唯一能看到**全部**档期的地方：
 * 货号、商品名、起止、价格、归属、状态。
 *
 * 商品列表和编辑器只显示"当前生效的那一档"（商品行本来就只装得下一档），
 * 排期请看这里。
 */
export default function PeriodsPage() {
  const rows = useDealRows()
  const products = useProducts()
  const { showToast } = useToast()

  /* 从商品编辑器跳过来时带 ?sku=P9B013：直接把搜索框填好。 */
  const [query, setQuery] = useState(() => {
    if (typeof window === 'undefined') return ''
    const m = window.location.hash.match(/[?&]sku=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  })
  const [scope, setScope] = useState('all')
  const [busyId, setBusyId] = useState('')

  const nameBySku = useMemo(() => {
    const map = {}
    for (const product of products) {
      const key = String(product?.sku ?? '').trim()
      if (key) map[key] = product.name || ''
    }
    return map
  }, [products])

  /* 导入时表里那列「折扣率」落在商品的 `discountLabel` 上（如 "45% OFF"）。
   * 档期表只存价格，所以价格算不出百分比时，用这个现成的文案兜底。 */
  const labelBySku = useMemo(() => {
    const map = {}
    for (const product of products) {
      const key = String(product?.sku ?? '').trim()
      if (!key) continue
      map[key] = product.discountLabel ? String(product.discountLabel) : ''
    }
    return map
  }, [products])

  /* 折扣文案存在**商品**上（前台卡片读它），所以这里改完要写回商品。 */
  const productIdBySku = useMemo(() => {
    const map = {}
    for (const product of products) {
      const key = String(product?.sku ?? '').trim()
      if (key) map[key] = product.id
    }
    return map
  }, [products])

  /* 折扣文案存在**档期行**上：前台合并档期时会用它覆盖商品上的值，
   * 所以这里改完既存进 deals，也立刻反映在表格和前台。 */
  const saveDiscount = async (row, value) => {
    const text = String(value ?? '').trim()
    if (text === String(row.discount_label || '')) return
    setBusyId(row.id)
    try {
      await updateDealSlot(row.id, { discountLabel: text })
      /* 商品库那边显示的是商品行上的文案，这里一并写过去，两边才不会一旧一新。 */
      const productId = productIdBySku[row.sku]
      if (productId) await setProductDiscountLabel(productId, text)
      showToast?.(text ? `折扣已改为「${text}」` : '已清空折扣文案', 'success')
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setBusyId('')
    }
  }
  const now = Date.now()

  const statusOf = (row) => {
    const start = new Date(row.sale_start).getTime()
    const end = new Date(row.sale_end).getTime()
    if (start <= now && end > now) return 'live'
    if (start > now) return 'upcoming'
    return 'ended'
  }

  const counts = useMemo(() => {
    const next = { all: rows.length, live: 0, upcoming: 0, ended: 0 }
    for (const row of rows) next[statusOf(row)] += 1
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, now])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows
      .filter((row) => (scope === 'all' ? true : statusOf(row) === scope))
      .filter((row) => {
        if (!needle) return true
        return (
          String(row.sku ?? '').toLowerCase().includes(needle) ||
          String(nameBySku[row.sku] ?? '').toLowerCase().includes(needle)
        )
      })
      .slice()
      .sort((a, b) => String(b.sale_start).localeCompare(String(a.sale_start)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, scope, nameBySku, now])

  const patch = async (row, changes) => {
    setBusyId(row.id)
    try {
      await updateDealSlot(row.id, changes)
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setBusyId('')
    }
  }

  const remove = async (row) => {
    setBusyId(row.id)
    try {
      await deleteDealSlot(row.id)
      showToast?.(`已删除 ${row.sku} 的这条档期`, 'success')
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setBusyId('')
    }
  }

  const clearEnded = async () => {
    try {
      const n = await deleteEndedDealSlots()
      showToast?.(`已清理 ${n} 条结束的档期`, 'success')
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    }
  }



  /* 折扣由「秒杀价 / 原价」算出来 —— 少任何一个都算不出百分比。
   * 档期表里原价是空的，所以这一列会显示 "—"：不是 bug，是缺数据。 */
  const percentOf = (row) => {
    const sale = Number(String(row.sale_price ?? '').replace(/[^0-9.]/g, ''))
    const original = Number(String(row.original_price ?? '').replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(sale) || !Number.isFinite(original)) return null
    if (!(original > 0) || !(sale > 0) || sale >= original) return null
    return Math.round((1 - sale / original) * 100)
  }

  const missingOriginal = useMemo(
    () => rows.filter((row) => percentOf(row) === null).length,
    [rows],
  )

  const toInput = (iso) => {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const status = getDealSlotsStatus()
  const slotsError = getDealSlotsError()

  /* 缺表才提示跑 16；其它错误（缺列、权限）把原始报错显示出来。 */
  const missing = status === 'missing'

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-charcoal">秒杀档期</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-charcoal-light">
            一个货号可以有多条时间窗。前台只显示此刻生效的那一档：进行中 → 下一次 → 全部结束就是普通商品。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DealImport onImported={() => loadDealSlots({ silent: true })} />

          <button
            type="button"
            onClick={clearEnded}
            className="rounded-full bg-white px-3 py-2 text-[11.5px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/30"
          >
            清理已结束（{counts.ended}）
          </button>
        </div>
      </div>

      {!missing && slotsError && (
        <p className="mb-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700 ring-1 ring-red-200">
          读取档期失败：<code className="font-mono">{slotsError}</code>
        </p>
      )}

      {missing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          数据库里还没有 <code className="font-mono">deals</code> 表 ——
          先在 Supabase 跑一次 <code className="font-mono">supabase/16-deals.sql</code>，再刷新本页。
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜货号或商品名"
          className="input-field min-w-[12rem] flex-1 text-[13px]"
        />
        {[
          ['all', `全部 ${counts.all}`],
          ['live', `进行中 ${counts.live}`],
          ['upcoming', `未开始 ${counts.upcoming}`],
          ['ended', `已结束 ${counts.ended}`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setScope(id)}
            aria-pressed={scope === id}
            className={`rounded-full px-3 py-2 text-[11.5px] font-medium transition ${
              scope === id
                ? 'bg-charcoal text-cream'
                : 'bg-white text-charcoal ring-1 ring-charcoal/10 hover:ring-charcoal/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-8 text-center text-[12.5px] leading-relaxed text-charcoal-light ring-1 ring-charcoal/[0.07]">
          这张表还没有数据。
          <br />
          在右上角点「导入秒杀」，把表格导进来即可；一个货号可以有多行时间窗。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-charcoal/[0.07]">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-charcoal-light">
                <th className="px-3 py-2 font-medium">货号</th>
                <th className="px-3 py-2 font-medium">商品</th>
                <th className="px-3 py-2 font-medium">开始</th>
                <th className="px-3 py-2 font-medium">结束</th>
                <th className="px-3 py-2 font-medium">秒杀价</th>
                <th className="px-3 py-2 font-medium">原价</th>
                <th className="px-3 py-2 font-medium">折扣</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = statusOf(row)
                return (
                  <tr key={row.id} className="border-t border-charcoal/[0.06] align-middle">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-charcoal">{row.sku}</td>
                    <td className="max-w-[16rem] px-3 py-2 text-[12px] text-charcoal-light">
                      <span className="line-clamp-1">{nameBySku[row.sku] || '（目录里没有这个货号）'}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="datetime-local"
                        defaultValue={toInput(row.sale_start)}
                        onBlur={(event) =>
                          event.target.value &&
                          event.target.value !== toInput(row.sale_start) &&
                          patch(row, { saleStart: event.target.value })
                        }
                        className="w-[11.5rem] rounded-lg bg-cream px-2 py-1 text-[11.5px] text-charcoal"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="datetime-local"
                        defaultValue={toInput(row.sale_end)}
                        onBlur={(event) =>
                          event.target.value &&
                          event.target.value !== toInput(row.sale_end) &&
                          patch(row, { saleEnd: event.target.value })
                        }
                        className="w-[11.5rem] rounded-lg bg-cream px-2 py-1 text-[11.5px] text-charcoal"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        defaultValue={row.sale_price ?? ''}
                        onBlur={(event) =>
                          String(event.target.value) !== String(row.sale_price ?? '') &&
                          patch(row, { salePrice: event.target.value })
                        }
                        className="w-20 rounded-lg bg-cream px-2 py-1 text-[11.5px] text-charcoal"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        defaultValue={row.original_price ?? ''}
                        onBlur={(event) =>
                          String(event.target.value) !== String(row.original_price ?? '') &&
                          patch(row, { originalPrice: event.target.value })
                        }
                        className="w-20 rounded-lg bg-cream px-2 py-1 text-[11.5px] text-charcoal"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {(() => {
                        const pct = percentOf(row)
                        const saved = String(row.discount_label || labelBySku[row.sku] || '')
                        return (
                          <input
                            type="text"
                            defaultValue={saved}
                            placeholder={pct === null ? '如 45% OFF' : `${pct}% OFF`}
                            onBlur={(event) => saveDiscount(row, event.target.value)}
                            disabled={busyId === row.id}
                            aria-label={`折扣 ${row.sku}`}
                            className="w-24 rounded-lg bg-cream px-2 py-1 text-[11.5px] text-charcoal placeholder:text-charcoal-light/40"
                          />
                        )
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          status === 'live'
                            ? 'bg-emerald-50 text-emerald-700'
                            : status === 'upcoming'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-charcoal/[0.06] text-charcoal-light'
                        }`}
                      >
                        {status === 'live' ? '进行中' : status === 'upcoming' ? '未开始' : '已结束'}
                      </span>
                      {row.is_campaign && (
                        <span className="ml-1 rounded-full bg-cream-dark px-2 py-0.5 text-[10px] text-charcoal/70">
                          大促
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        disabled={busyId === row.id}
                        aria-label={`删除 ${row.sku} 的这条档期`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
