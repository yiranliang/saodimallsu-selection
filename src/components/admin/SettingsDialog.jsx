import { useEffect, useState } from 'react'
import { ChevronDown, Close, Plus, Trash } from '../icons.jsx'
import { getCategoryGroupStatus } from '../../utils/categoryStore.js'
import InlineSelect from './InlineSelect.jsx'

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
  const [newGroupName, setNewGroupName] = useState('')
  /* 菜单布局草稿：只在本地改，点「保存布局」才写库。 */
  const [menuDraft, setMenuDraft] = useState([])
  const [menuDirty, setMenuDirty] = useState(false)
  const [menuSaving, setMenuSaving] = useState(false)
  /* 单开手风琴：同一次只展开一块，默认都收起（太长）。 */
  const [openSection, setOpenSection] = useState(null)
  /* 分组列在不在：不在时下面给一条「先跑迁移」的提示。 */
  const groupColumnStatus = getCategoryGroupStatus()
  const [dragName, setDragName] = useState('')

  /* 弹窗打开时锁住 body 的滚动：滚轮只作用在弹窗内容上，背后的列表不动。 */
  useEffect(() => {
    if (!open) return undefined
    /* 草稿 = 当前的分组顺序 + 每组的分类；未分组的分类放进最后一块。 */
    /* categories.list 里是 { name, count }，这里只要名字。 */
    const allNames = (categories.list || []).map((item) =>
      typeof item === 'string' ? item : String(item?.name ?? ''),
    )
    const built = []
    const used = new Set()
    for (const title of categories.groupList || []) {
      const items = allNames.filter((name) => (categories.groups?.[name] || '') === title)
      items.forEach((name) => used.add(name))
      built.push({ title, categories: items })
    }
    const loose = allNames.filter((name) => !used.has(name))
    if (loose.length) built.push({ title: '', categories: loose })
    setMenuDraft(built)
    setMenuDirty(false)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  const moveMenuGroup = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= menuDraft.length) return
    const next = [...menuDraft]
    ;[next[index], next[target]] = [next[target], next[index]]
    setMenuDraft(next)
    setMenuDirty(true)
  }

  const moveMenuCategory = (groupIndex, index, direction) => {
    const group = menuDraft[groupIndex]
    const target = index + direction
    if (!group || target < 0 || target >= group.categories.length) return
    const next = [...menuDraft]
    const items = [...group.categories]
    ;[items[index], items[target]] = [items[target], items[index]]
    next[groupIndex] = { ...group, categories: items }
    setMenuDraft(next)
    setMenuDirty(true)
  }

  const saveMenuDraft = async () => {
    setMenuSaving(true)
    try {
      await categories.saveLayout?.(menuDraft)
      setMenuDirty(false)
    } finally {
      setMenuSaving(false)
    }
  }

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

          <button
            type="button"
            onClick={() => setOpenSection((current) => (current === 'layout' ? null : 'layout'))}
            aria-expanded={openSection === 'layout'}
            className="flex w-full items-center justify-between gap-3 border-t border-charcoal/[0.06] pt-4 text-left"
          >
            <span>
              <span className="block text-[11px] font-medium tracking-wider text-charcoal-light">
                菜单布局（草稿）
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light/80">
                排好再保存；不保存不影响前台。
              </span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform ${
                openSection === 'layout' ? 'rotate-180' : ''
              }`}
            />
          </button>

          {openSection === 'layout' && (
            <>
              {/* 菜单布局草稿：改完再保存，避免每次拖动都写库 */}
          <div className="border-t border-charcoal/[0.06] pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
                  菜单布局（草稿）
                </div>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-charcoal-light/80">
                  在这里排好再点保存；不保存就关掉，前台不受影响。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMenuDirty(false)}
                  className="rounded-full px-2.5 py-1.5 text-[11px] text-charcoal-light transition hover:text-charcoal"
                >
                  撤销
                </button>
                <button
                  type="button"
                  onClick={saveMenuDraft}
                  disabled={!menuDirty || menuSaving}
                  className="rounded-full bg-charcoal px-3.5 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {menuSaving ? '保存中…' : menuDirty ? '保存布局' : '已保存'}
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {menuDraft.map((group, groupIndex) => (
                <div key={`${group.title || 'loose'}-${groupIndex}`} className="rounded-xl bg-cream/60 p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-charcoal">
                      {group.title || '未分组'}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveMenuGroup(groupIndex, -1)}
                      disabled={groupIndex === 0}
                      aria-label={`上移分组 ${group.title}`}
                      className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMenuGroup(groupIndex, 1)}
                      disabled={groupIndex === menuDraft.length - 1}
                      aria-label={`下移分组 ${group.title}`}
                      className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>

                  <div className="mt-1 space-y-0.5">
                    {group.categories.map((name, index) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1"
                      >
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-charcoal/80">
                          {name}
                        </span>
                        <button
                          type="button"
                          onClick={() => moveMenuCategory(groupIndex, index, -1)}
                          disabled={index === 0}
                          aria-label={`上移 ${name}`}
                          className="rounded p-0.5 text-charcoal-light transition hover:bg-cream hover:text-charcoal disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMenuCategory(groupIndex, index, 1)}
                          disabled={index === group.categories.length - 1}
                          aria-label={`下移 ${name}`}
                          className="rounded p-0.5 text-charcoal-light transition hover:bg-cream hover:text-charcoal disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                    {group.categories.length === 0 && (
                      <p className="px-2 py-1 text-[10.5px] text-charcoal-light/60">
                        这个分组还没有分类
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

            </>
          )}

          <button
            type="button"
            onClick={() => setOpenSection((current) => (current === 'groups' ? null : 'groups'))}
            aria-expanded={openSection === 'groups'}
            className="flex w-full items-center justify-between gap-3 border-t border-charcoal/[0.06] pt-4 text-left"
          >
            <span>
              <span className="block text-[11px] font-medium tracking-wider text-charcoal-light">
                分组
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light/80">
                前台 SHOP 菜单左栏的顺序就是这里的顺序。
              </span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform ${
                openSection === 'groups' ? 'rotate-180' : ''
              }`}
            />
          </button>

          {openSection === 'groups' && (
            <>
              {/* 分组本身：新增 / 排序 / 删除。 */}
          <div className="border-t border-charcoal/[0.06] pt-5">
            <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
              分组
            </div>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-charcoal-light/80">
              前台 SHOP 菜单左栏的顺序就是这里的顺序。
            </p>

            <div className="mt-2 space-y-1">
              {(categories.groupList || []).map((title, index) => (
                <div
                  key={title}
                  className="flex items-center gap-2 rounded-lg bg-cream/60 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-charcoal">
                    {title}
                  </span>
                  <button
                    type="button"
                    onClick={() => categories.moveGroup?.(title, -1)}
                    disabled={index === 0}
                    aria-label={`上移 ${title}`}
                    className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => categories.moveGroup?.(title, 1)}
                    disabled={index === (categories.groupList || []).length - 1}
                    aria-label={`下移 ${title}`}
                    className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => categories.removeGroup?.(title)}
                    aria-label={`删除分组 ${title}`}
                    className="rounded p-1 text-charcoal-light transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash className="h-3 w-3" />
                  </button>
                </div>
              ))}

              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    categories.addGroup?.(newGroupName)
                    setNewGroupName('')
                  }}
                  placeholder="新分组名，如 Knitwear"
                  aria-label="新分组名"
                  className="min-w-0 flex-1 rounded-full bg-cream-dark/70 px-3 py-1.5 text-[11.5px] text-charcoal placeholder:text-charcoal-light/55 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    categories.addGroup?.(newGroupName)
                    setNewGroupName('')
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95"
                >
                  <Plus className="h-3 w-3" />
                  添加分组
                </button>
              </div>
            </div>
          </div>

            </>
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

            {panelOpen && groupColumnStatus === 'missing' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                分组暂时存不进去：数据库里没有{' '}
                <code className="font-mono">group_name</code> 列。先在 Supabase 跑一次{' '}
                <code className="font-mono">supabase/20-category-group.sql</code>。
              </p>
            )}

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
                    <InlineSelect
                      value={categories.groups?.[name] || ''}
                      onChange={(next) => categories.setGroup?.(name, next)}
                      ariaLabel={`${name} 的分组`}
                      placeholder="未分组"
                      width="w-[7.5rem]"
                      options={[
                        { value: '', label: '未分组' },
                        ...(categories.groupList || []).map((title) => ({ value: title, label: title })),
                      ]}
                    />

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
