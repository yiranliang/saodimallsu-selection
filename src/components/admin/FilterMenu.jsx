import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '../icons.jsx'

/**
 * 后台筛选用的自绘下拉
 * ═══════════════════
 *
 * 原生 `<select>` 的弹层由操作系统绘制：方角、系统蓝高亮、中文排版也对不上这套
 * 界面。这里用「按钮 + 绝对定位面板」替代，外观和商品库那几个胶囊一致。
 *
 * 行为约定：
 *   - 点触发器 = 切换（打开 / 收起）；
 *   - 点面板以外的地方、或按 Esc，收起；
 *   - 开合状态可以由父组件控制（这样同一行只会有一个下拉是开的）。
 */
export default function FilterMenu({
  label,
  value,
  options = [],
  onChange,
  ariaLabel,
  align = 'left',
  maxWidth = 'max-w-[16rem]',
  panelWidth = 'w-64',
  open: openProp,
  onOpenChange,
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const open = openProp ?? selfOpen
  const containerRef = useRef(null)

  const applyOpen = (next) => {
    setSelfOpen(next)
    onOpenChange?.(next)
  }

  /* 切换：之前把「函数」直接传给了父组件的 next，函数是 truthy，
   * 于是永远只会打开、点第二次也关不掉。 */
  const toggle = () => applyOpen(!open)

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) applyOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') applyOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const current = options.find((option) => option.value === value)

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
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
          className={`absolute top-full z-30 mt-1 max-h-[22rem] overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10 ${panelWidth} ${
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
                  applyOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg py-1.5 text-left text-[12px] transition ${
                  option.depth ? 'pl-5 pr-2.5' : 'px-2.5'
                } ${
                  active
                    ? 'bg-charcoal/[0.06] font-medium text-charcoal'
                    : option.depth
                      ? 'text-charcoal/65 hover:bg-charcoal/[0.04]'
                      : 'text-charcoal/80 hover:bg-charcoal/[0.04]'
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
