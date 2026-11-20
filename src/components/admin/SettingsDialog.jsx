import { useEffect, useState } from 'react'
import { ChevronDown, Close, Plus, Trash } from '../icons.jsx'
import { CATEGORY_GROUP_TITLES } from '../../utils/categoryStore.js'

/**
 * 站点设置对话框
 * ═════════════
 *
 * 两块站点级配置：前台的专区名字、分类管理。以前它们是商品库顶部的一行内联
 * 卡片，后来塞进通用 `Modal` —— 那个组件自带滚动容器，内容一长就会把标题顶出
 * 面板（截图里"字被白块盖住"的那种）。
 *
 * 所以这里自己画遮罩和面板：外层负责滚动与留白，里面就是普通纵向表单，布局
 * 完全可控，不依赖 `Modal` 的内部实现。
 */
export default function SettingsDialog({
  open,
  onClose,
  settings,
  status,
  defaults,
  normalise,
  drafts,
  saving,
  onSave,
  onReset,
  categories,
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [dragName, setDragName] = useState('')

  /* 弹窗打开时锁住 body 的滚动：滚轮只作用在弹窗内容上，背后的列表不动。 */
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  const fields = [
    {
      key: 'deals',
      title: '秒杀专区名称',
      hint: '前台顶部 Sale 菜单里那场活动的名字。',
      draft: drafts.deals,
      setDraft: drafts.setDeals,
      placeholder: defaults.deals,
      maxLength: 32,
      normalise: normalise.deals,
      saved: settings.dealsTabLabel,
      resetDisabled: settings.dealsTabLabel === defaults.deals,
      busy: saving.deals,
      save: onSave.deals,
      reset: onReset.deals,
    },
    {
      key: 'holiday',
      title: '节日专区名称',
      hint: '前台导航里 New / Bestseller 后面那一项；换季就改这里。',
      draft: drafts.holiday,
      setDraft: drafts.setHoliday,
      placeholder: defaults.holiday,
      maxLength: 24,
      normalise: normalise.holiday,
      saved: settings.holidayLabel,
      resetDisabled: settings.holidayLabel === defaults.holiday,
      busy: saving.holiday,
      save: onSave.holiday,
      reset: onReset.holiday,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 overscroll-contain overflow-y-auto bg-charcoal/30 p-4 backdrop-blur-sm sm:p-8">
      <div className="mx-auto my-4 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-charcoal">设置</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-full p-1.5 text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
          >
            <Close className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          {fields.map((field, index) => (
            <div key={field.key} className={index === 0 ? '' : 'border-t border-charcoal/[0.06] pt-5'}>
              <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
                {field.title}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-charcoal-light/80">{field.hint}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={field.draft}
                  onChange={(event) => field.setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') field.save()
                    if (event.key === 'Escape') field.setDraft(field.saved)
                  }}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  aria-label={field.title}
                  className="min-w-0 flex-1 rounded-lg bg-cream px-3 py-2 text-[13px] text-charcoal placeholder:text-charcoal-light/50 focus:outline-none focus:ring-1 focus:ring-charcoal/25"
                />
                <button
                  type="button"
                  onClick={field.save}
                  disabled={field.busy || field.normalise(field.draft) === field.saved}
                  className="shrink-0 rounded-full bg-charcoal px-3.5 py-2 text-[11.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {field.busy ? '保存中…' : '改名'}
                </button>
                <button
                  type="button"
                  onClick={field.reset}
                  disabled={field.busy || field.resetDisabled}
                  className="shrink-0 rounded-full bg-cream-dark px-3 py-2 text-[11.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  恢复默认
                </button>
              </div>
            </div>
          ))}

          {status === 'missing' && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              settings 表不存在，改名存不进去。先在 Supabase 跑一次 supabase/12-settings.sql。
            </p>
          )}

          {/* 分类管理 */}
          <div className="border-t border-charcoal/[0.06] pt-5">
            <button
              type="button"
              onClick={() => setPanelOpen((prev) => !prev)}
              aria-expanded={panelOpen}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-medium tracking-wider text-charcoal-light">
                  分类
                </span>
                <span className="rounded-full bg-cream-dark px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-charcoal/60">
                  {categories.list.length}
                </span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform duration-200 ${
                  panelOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {panelOpen && (
              <div className="mt-3 space-y-1.5">
                {categories.list.map(({ name, count }, index) => (
                  <div
                    key={name}
                    draggable
                    onDragStart={() => setDragName(name)}
                    onDragEnd={() => setDragName('')}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!dragName || dragName === name) return
                      const from = categories.list.findIndex((item) => item.name === dragName)
                      if (from < 0) return
                      categories.reorder(dragName, index - from)
                      setDragName('')
                    }}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                      dragName === name ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-cream/60'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      title="拖动排序"
                      className="shrink-0 cursor-grab select-none px-0.5 text-[11px] text-charcoal-light/50"
                    >
                      ⠿
                    </span>
                    <input
                      type="text"
                      defaultValue={name}
                      onBlur={(event) => {
                        const next = event.target.value
                        if (next.trim() && next.trim() !== name) categories.rename(name, next)
                      }}
                      aria-label={`重命名分类 ${name}`}
                      className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[12px] text-charcoal focus:bg-white focus:outline-none focus:ring-1 focus:ring-charcoal/20"
                    />
                    <select
                      value={categories.groups?.[name] || ''}
                      onChange={(event) => categories.setGroup?.(name, event.target.value)}
                      aria-label={`${name} 的一级分组`}
                      className="w-28 shrink-0 rounded-md bg-white px-1.5 py-1 text-[10.5px] text-charcoal ring-1 ring-charcoal/10 focus:outline-none focus:ring-charcoal/30"
                    >
                      <option value="">未分组</option>
                      {CATEGORY_GROUP_TITLES.map((title) => (
                        <option key={title} value={title}>
                          {title}
                        </option>
                      ))}
                    </select>
                    <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">{count}</span>
                    <button
                      type="button"
                      onClick={() => categories.move(name, -1)}
                      aria-label={`上移 ${name}`}
                      className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => categories.move(name, 1)}
                      aria-label={`下移 ${name}`}
                      className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => categories.remove(name)}
                      aria-label={`删除分类 ${name}`}
                      className="rounded p-1 text-charcoal-light transition hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                <div className="mt-2 flex gap-1.5">
                  <input
                    type="text"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      categories.add(newName)
                      setNewName('')
                    }}
                    placeholder="新分类名"
                    aria-label="新分类名"
                    className="min-w-0 flex-1 rounded-full bg-cream-dark/70 px-3 py-1.5 text-[11.5px] text-charcoal placeholder:text-charcoal-light/55 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      categories.add(newName)
                      setNewName('')
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    添加
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
