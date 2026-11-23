import { useState } from 'react'
import { ChevronDown, Plus, Trash } from '../icons.jsx'

/**
 * 分类 & 分组布局
 * ═══════════════
 *
 * 一个面板同时管三件事，因为它们在数据上是一件事：
 *   分组（category_groups）→ 分类（categories.group_name）→ 分类顺序（sort_order）
 *
 * 直接写库（没有草稿态）：每次 ↑↓ / 改名 / 新增都立刻生效，前台随之更新。
 * 分组可以折叠，分类多的站点不会变成一堵墙。
 */
export default function CategoryLayoutEditor({ model }) {
  const [openGroups, setOpenGroups] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // { kind: 'group'|'category', name }
  const [draftName, setDraftName] = useState('')
  const [newCategory, setNewCategory] = useState({}) // groupTitle -> 输入值
  const [newGroup, setNewGroup] = useState('')
  const [busy, setBusy] = useState(false)

  const groups = model.groupList || []
  const categories = model.categories || [] // [{ name, count }]
  const groupsOf = model.groupsOf || {} // category -> group title
  const loose = categories.filter((item) => !groupsOf[item.name])

  const toggleGroup = (title) => {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const startEdit = (kind, name) => {
    setEditing({ kind, name })
    setDraftName(name)
  }

  const commitEdit = async () => {
    if (!editing) return
    const next = draftName.trim()
    setEditing(null)
    if (!next || next === editing.name) return
    setBusy(true)
    try {
      if (editing.kind === 'group') await model.renameGroup?.(editing.name, next)
      else await model.renameCategory?.(editing.name, next)
    } finally {
      setBusy(false)
    }
  }

  const renderName = (kind, name) =>
    editing && editing.kind === kind && editing.name === name ? (
      <input
        type="text"
        value={draftName}
        autoFocus
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitEdit()
          if (event.key === 'Escape') setEditing(null)
        }}
        className="min-w-0 flex-1 rounded-md bg-white px-2 py-1 text-[12px] text-charcoal ring-1 ring-charcoal/20 focus:outline-none"
      />
    ) : (
      <span className="min-w-0 flex-1 truncate text-[12px] text-charcoal">{name}</span>
    )

  const renderActions = (kind, index, length, name, handlers) => (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => handlers.move?.(name, -1)}
        disabled={index === 0 || busy}
        aria-label={`上移 ${name}`}
        className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => handlers.move?.(name, 1)}
        disabled={index === length - 1 || busy}
        aria-label={`下移 ${name}`}
        className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={() => startEdit(kind, name)}
        aria-label={`重命名 ${name}`}
        className="rounded p-1 text-[10px] text-charcoal-light transition hover:bg-white hover:text-charcoal"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={() => handlers.remove?.(name)}
        aria-label={`删除 ${name}`}
        className="rounded p-1 text-charcoal-light transition hover:bg-red-50 hover:text-red-500"
      >
        <Trash className="h-3 w-3" />
      </button>
    </span>
  )

  return (
    <div className="border-t border-charcoal/[0.06] pt-5">
      <p className="text-[10.5px] leading-relaxed text-charcoal-light/80">
        这里的顺序就是前台 SHOP 菜单的顺序；点箭头展开分组。
      </p>

      <div className="mt-2 space-y-2">
        {groups.map((title, groupIndex) => {
          const items = categories.filter((item) => groupsOf[item.name] === title)
          const expanded = openGroups.has(title)
          return (
            <div key={title} className="rounded-xl bg-cream/60 p-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(title)}
                  aria-expanded={expanded}
                  aria-label={`展开 ${title}`}
                  className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
                  />
                </button>
                {renderName('group', title)}
                <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">
                  {items.length}
                </span>
                {renderActions('group', groupIndex, groups.length, title, {
                  move: model.moveGroup,
                  remove: model.removeGroup,
                })}
              </div>

              {expanded && (
                <div className="mt-1.5 space-y-0.5 border-l border-charcoal/10 pl-3">
                  {items.map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1"
                    >
                      {renderName('category', item.name)}
                      <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">
                        {item.count}
                      </span>
                      {renderActions('category', index, items.length, item.name, {
                        move: model.moveCategory,
                        remove: model.removeCategory,
                      })}
                    </div>
                  ))}

                  <div className="mt-1 flex gap-1.5">
                    <input
                      type="text"
                      value={newCategory[title] || ''}
                      onChange={(event) =>
                        setNewCategory((current) => ({ ...current, [title]: event.target.value }))
                      }
                      placeholder="新增分类"
                      aria-label={`在 ${title} 下新增分类`}
                      className="min-w-0 flex-1 rounded-full bg-cream-dark/70 px-3 py-1 text-[11px] text-charcoal placeholder:text-charcoal-light/55 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const name = (newCategory[title] || '').trim()
                        if (!name) return
                        await model.addCategory?.(name, title)
                        setNewCategory((current) => ({ ...current, [title]: '' }))
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-charcoal px-2.5 py-1 text-[10.5px] font-medium text-cream transition hover:bg-charcoal/85"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      添加
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {loose.length > 0 && (
          <div className="rounded-xl bg-cream/60 p-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-charcoal">未分组</span>
              <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">
                {loose.length}
              </span>
              <button
                type="button"
                onClick={() => toggleGroup('__loose')}
                aria-expanded={openGroups.has('__loose')}
                aria-label="展开未分组"
                className="rounded p-1 text-charcoal-light transition hover:bg-white hover:text-charcoal"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    openGroups.has('__loose') ? '' : '-rotate-90'
                  }`}
                />
              </button>
            </div>

            {openGroups.has('__loose') && (
              <div className="mt-1.5 space-y-0.5 border-l border-charcoal/10 pl-3">
                {loose.map((item, index) => (
                  <div
                    key={item.name}
                    className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1"
                  >
                    {renderName('category', item.name)}
                    <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">
                      {item.count}
                    </span>
                    {renderActions('category', index, loose.length, item.name, {
                      move: model.moveCategory,
                      remove: model.removeCategory,
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 rounded-xl bg-amber-50/60 px-3 py-2.5 ring-1 ring-amber-200/70">
          <p className="text-[10.5px] leading-relaxed text-amber-900/80">
            历史数据修复：早期迁移把每件商品的主分类也写进了「同时归入」，
            改分类后这些行仍留在旧分类里，看起来像"没改成功"。
          </p>
          <button
            type="button"
            onClick={() => model.clearExtras?.()}
            className="mt-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-300 transition hover:bg-amber-50"
          >
            清空「同时归入」
          </button>
        </div>

        <div className="flex gap-1.5 pt-1">
          <input
            type="text"
            value={newGroup}
            onChange={(event) => setNewGroup(event.target.value)}
            placeholder="新增分组，如 Knitwear"
            aria-label="新增分组"
            className="min-w-0 flex-1 rounded-full bg-cream-dark/70 px-3 py-1.5 text-[11.5px] text-charcoal placeholder:text-charcoal-light/55 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={async () => {
              const name = newGroup.trim()
              if (!name) return
              await model.addGroup?.(name)
              setNewGroup('')
            }}
            className="flex shrink-0 items-center gap-1 rounded-full bg-charcoal px-3 py-1.5 text-[11px] font-medium text-cream transition hover:bg-charcoal/85"
          >
            <Plus className="h-3 w-3" />
            添加分组
          </button>
        </div>
      </div>
    </div>
  )
}
