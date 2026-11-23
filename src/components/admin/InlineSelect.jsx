import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '../icons.jsx'

/**
 * 行内下拉（设置里那种小尺寸）
 * ═════════════════════════════
 *
 * 原生 `<select>` 的弹层由系统绘制，中文和圆角都对不上这套界面 —— 这里换成
 * 按钮 + 面板，外观和商品库的筛选用同一套，只是尺寸更小。
 *
 * 受控：`value` / `onChange` 由调用方持有。
 */
export default function InlineSelect({
  value,
  options = [],
  /* 可选：按分组渲染（分组名不可点，成员缩进）。传了它就忽略 options。 */
  groups = [],
  onChange,
  placeholder = '未分组',
  ariaLabel,
  width = 'w-[8.5rem]',
  /* 面板可以比触发器宽：PC 上空间够，选项名（比如 Long Cardigans）不该被截断。 */
  panelWidth = 'w-64',
  align = 'right',
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((option) => option.value === value)

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex ${width} items-center justify-between gap-1 rounded-lg bg-white px-2 py-1 text-[10.5px] text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25`}
      >
        <span className={`min-w-0 truncate ${current ? '' : 'text-charcoal-light/70'}`}>
          {current?.label || placeholder}
        </span>
        <ChevronDown
          className={`h-2.5 w-2.5 shrink-0 text-charcoal-light transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`absolute top-full z-40 mt-1 max-h-[22rem] overflow-y-auto rounded-xl bg-white p-1 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10 ${panelWidth} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {(groups.length ? groups : [{ title: '', items: options }]).map((group) => (
            <div key={group.title || '__flat'}>
              {group.title && (
                <div className="px-2 pb-0.5 pt-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-charcoal-light/60">
                  {group.title}
                </div>
              )}
              {group.items.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange?.(option.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[10.5px] transition ${
                  active
                    ? 'bg-charcoal/[0.06] font-medium text-charcoal'
                    : 'text-charcoal/75 hover:bg-charcoal/[0.04]'
                }`}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {option.count !== undefined && (
                  <span className="shrink-0 tabular-nums text-charcoal-light/60">{option.count}</span>
                )}
              </button>
            )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
