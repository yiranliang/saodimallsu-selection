import { useEffect, useState } from 'react'
import { ChevronDown, Close } from '../icons.jsx'
import { getCategoryGroupStatus } from '../../utils/categoryStore.js'
import CategoryLayoutEditor from './CategoryLayoutEditor.jsx'

/**
 * 站点设置
 * ════════
 *
 * 两块内容：
 *   1. 专区名称（前台 Sale 菜单 / 节日入口显示的名字）
 *   2. 分类 & 分组布局（顺序、增删改都在这里，直接写库）
 *
 * 折叠是默认的：整块设置很长，一次只展开一块。
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
  const [openSection, setOpenSection] = useState('names')
  const groupColumnStatus = getCategoryGroupStatus()

  /* 打开时锁住页面滚动：滚轮只作用在弹窗里。 */
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

  const header = (key, title, hint) => (
    <button
      type="button"
      onClick={() => setOpenSection((current) => (current === key ? null : key))}
      aria-expanded={openSection === key}
      className="flex w-full items-start justify-between gap-3 border-t border-charcoal/[0.06] pt-4 text-left first:border-t-0 first:pt-0"
    >
      <span>
        <span className="block text-[11px] font-medium tracking-wider text-charcoal-light">
          {title}
        </span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light/80">
          {hint}
        </span>
      </span>
      <ChevronDown
        className={`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform ${
          openSection === key ? 'rotate-180' : ''
        }`}
      />
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-charcoal/30 p-4 backdrop-blur-sm sm:p-8">
      <div className="mx-auto my-4 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
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
          <div>
            {header('names', '专区名称', '前台 Sale 菜单和节日入口显示的名字。')}

            {openSection === 'names' && (
              <div className="mt-3 space-y-6">
                {fields.map((field) => (
                  <div key={field.key}>
                    <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
                      {field.title}
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-charcoal-light/80">
                      {field.hint}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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
              </div>
            )}
          </div>

          <div>
            {header('layout', '分类 & 分组布局', '顺序、增删改都在这里，改动立即生效。')}

            {openSection === 'layout' && (
              <div className="mt-3">
                {groupColumnStatus === 'missing' && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                    分组暂时存不进去：数据库里没有{' '}
                    <code className="font-mono">group_name</code> 列。先在 Supabase 跑一次{' '}
                    <code className="font-mono">supabase/20-category-group.sql</code>。
                  </p>
                )}
                <CategoryLayoutEditor model={categories} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
