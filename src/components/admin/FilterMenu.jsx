import { useState } from 'react'
import { ChevronDown } from '../icons.jsx'

/**
 * 后台筛选用的自绘下拉
 * ═══════════════════
 *
 * 原生 `<select>` 的弹层由操作系统绘制：方角、系统蓝高亮、中文排版也对不上这套
 * 界面。这里用「按钮 + 绝对定位面板」替代，外观和商品库那几个胶囊一致。
 *
 * 只做一件事：显示 label、渲染 options（`{ value, label, count }`）、选中回调。
 * 状态留在调用方，组件自己不记选中值。
 */
export default function FilterMenu({
  label,
  value,
  options = [],
  onChange,
  ariaLabel,
  align = 'left',
  maxWidth = 'max-w-[16rem]',
  panelWidth = 'w-56',
  open: openProp,
  onOpenChange,
}) {
  /* 开合可以由父组件控制（这样同一行里只会有一个下拉是开的）；
   * 不传就是自管。 */
  const [selfOpen, setSelfOpen] = useState(false)
  const open = openProp ?? selfOpen
  const setOpen = (next) => {
    setSelfOpen(next)
    onOpenChange?.(next)
  }

  const current = options.find((option) => option.value === value)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel || label}
        className={`flex items-center gap-1.5 rounded-full bg-white py-2.5 pl-3 pr-2 text-[12px] ring-1 ring-charcoal/[0.07] transition hover:ring-charcoal/25 ${maxWidth}`}
      >
        {label && <span className="shrink-0 text-[11px] text-charcoal-light">{label}</span>}
        <span className="min-w-0 truncate text-charcoal">{current?.label || '—'}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-charcoal-light transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`absolute top-full z-30 mt-1 max-h-[18rem] overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10 ${panelWidth} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange?.(option.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
                  active
                    ? 'bg-charcoal/[0.06] font-medium text-charcoal'
                    : 'text-charcoal/75 hover:bg-charcoal/[0.04]'
                }`}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {option.count !== undefined && (
                  <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">
                    {option.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
