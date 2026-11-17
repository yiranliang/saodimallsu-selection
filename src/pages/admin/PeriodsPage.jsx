import { useMemo, useState } from 'react'
import { useDealRows } from '../../hooks/useDealSlots.js'
import { useProducts } from '../../hooks/useProducts.js'
import { deleteDealSlot, deleteEndedDealSlots, updateDealSlot } from '../../store/dealStore.js'
import { useToast } from '../../hooks/useToast.js'
import { Trash } from '../../components/icons.jsx'
import { t } from '../../i18n/admin.js'

/**
 * 档期面板（/admin/periods）
 * ═════════════════════════
 *
 * 一个货号可以有多个秒杀时间窗，前台只显示"此刻生效的那一档"。这个页面是唯一
 * 能看到**全部**档期的地方：几号开始、几号结束、什么价、属于哪个专区。
 *
 * 三件事：看、改（时间 / 价格）、删。sku 是关联键，不允许在这里改 —— 改货号
 * 应该走商品编辑器，那里会同步 ASIN 和选款码。
 */
export default function PeriodsPage() {
  const rows = useDealRows()
  const products = useProducts()
  const { showToast } = useToast()

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all') // all | live | upcoming | ended
  const [busyId, setBusyId] = useState('')
  const [savingId, setSavingId] = useState('')

  /* sku → 商品名，用来在列表里显示人话而不是货号。 */
  const nameBySku = useMemo(() => {
    const map = {}
    for (const product of products) {
      const key = String(product?.sku ?? '').trim()
      if (key) map[key] = product.name || product.sku
    }
    return map
  }, [products])

  const now = Date.now()

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      const start = new Date(row.sale_start).getTime()
      const end = new Date(row.sale_end).getTime()
      if (scope === 'live' && !(start <= now && end > now)) return false
      if (scope === 'upcoming' && !(start > now)) return false
      if (scope === 'ended' && !(end <= now)) return false
      if (!needle) return true
      return (
        String(row.sku ?? '').toLowerCase().includes(needle) ||
        String(nameBySku[row.sku] ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rows, query, scope, now, nameBySku])

  const counts = useMemo(() => {
    let live = 0
    let upcoming = 0
    let ended = 0
    for (const row of rows) {
      const start = new Date(row.sale_start).getTime()
      const end = new Date(row.sale_end).getTime()
      if (start <= now && end > now) live += 1
      else if (start > now) upcoming += 1
      else ended += 1
    }
    return { all: rows.length, live, upcoming, ended }
  }, [rows, now])

  const patch = async (row, changes) => {
    setSavingId(row.id)
    try {
      await updateDealSlot(row.id, changes)
    } catch (err) {
      showToast?.(err.message, 'error', 6000)
    } finally {
      setSavingId('')
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

  const toInput = (iso) => {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
      d.getMinutes(),
    )}`
  }

  return (
    <div className="mx-auto max-w-5xl lg:max-w-none">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-charcoal">{t('Periods')}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-light">
            一个货号可以有多个秒杀时间窗。前台只显示此刻生效的那一档：
            <span className="whitespace-nowrap">进行中 → 下一次 → 全部结束即普通商品。</span>
          </p>
        </div>
        <button
          type="button"
          onClick={clearEnded}
          className="shrink-0 rounded-full bg-white px-3 py-2 text-[11.5px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/30"
        >
          清理已结束（{counts.ended}）
        </button>
      </div>

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

      {rows.length === 0 && (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-[12.5px] text-charcoal-light ring-1 ring-charcoal/[0.07]">
          还没有档期。去商品库点「导入秒杀」，或在商品编辑器里开一次秒杀。
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((row) => {
          const live = new Date(row.sale_start).getTime() <= now && new Date(row.sale_end).getTime() > now
          return (
            <div
              key={row.id}
              className="rounded-2xl bg-white p-3 ring-1 ring-charcoal/[0.07]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px] text-charcoal">{row.sku}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-charcoal-light">
                  {nameBySku[row.sku] || '（目录里没有这个货号）'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    live
                      ? 'bg-emerald-50 text-emerald-700'
                      : new Date(row.sale_start).getTime() > now
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-charcoal/[0.06] text-charcoal-light'
                  }`}
                >
                  {live ? '进行中' : new Date(row.sale_start).getTime() > now ? '未开始' : '已结束'}
                </span>
                {row.is_campaign && (
                  <span className="rounded-full bg-cream-dark px-2 py-0.5 text-[10px] text-charcoal/70">
                    大促
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={busyId === row.id}
                  aria-label="Delete this period"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <label className="text-[10px] uppercase tracking-wider text-charcoal-light">
                  开始
                  <input
                    type="datetime-local"
                    defaultValue={toInput(row.sale_start)}
                    onBlur={(event) =>
                      event.target.value !== toInput(row.sale_start) &&
                      patch(row, { saleStart: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg bg-cream px-2 py-1.5 text-[12px] text-charcoal"
                  />
                </label>
                <label className="text-[10px] uppercase tracking-wider text-charcoal-light">
                  结束
                  <input
                    type="datetime-local"
                    defaultValue={toInput(row.sale_end)}
                    onBlur={(event) =>
                      event.target.value !== toInput(row.sale_end) &&
                      patch(row, { saleEnd: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg bg-cream px-2 py-1.5 text-[12px] text-charcoal"
                  />
                </label>
                <label className="text-[10px] uppercase tracking-wider text-charcoal-light">
                  秒杀价
                  <input
                    type="text"
                    defaultValue={row.sale_price ?? ''}
                    onBlur={(event) =>
                      String(event.target.value) !== String(row.sale_price ?? '') &&
                      patch(row, { salePrice: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg bg-cream px-2 py-1.5 text-[12px] text-charcoal"
                  />
                </label>
                <label className="text-[10px] uppercase tracking-wider text-charcoal-light">
                  原价
                  <input
                    type="text"
                    defaultValue={row.original_price ?? ''}
                    onBlur={(event) =>
                      String(event.target.value) !== String(row.original_price ?? '') &&
                      patch(row, { originalPrice: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg bg-cream px-2 py-1.5 text-[12px] text-charcoal"
                  />
                </label>
              </div>

              {savingId === row.id && (
                <p className="mt-1.5 text-[10.5px] text-charcoal-light">保存中…</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
