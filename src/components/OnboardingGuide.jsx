import { useEffect, useRef, useState } from 'react'
import { useScrollLock } from '../hooks/useScrollLock.js'
import {
  GUIDE_STEPS,
  GUIDE_TOTAL,
  clampStep,
  stepAt,
  stepLabel,
} from '../utils/guide.js'

/**
 * 新手操作指南
 * ════════════
 * 五步单页切换（不是一页滚到底），右下角常驻一个 `?`。
 *
 * 三条硬约束，写在这里免得后人"优化"掉：
 *   1. **零图片**。五个图形全部是 div/span + Tailwind 边框和圆角。不要换成
 *      icons.jsx（那个文件是项目自己的内联 SVG），也不要用 emoji 当图标 ——
 *      它们在安卓上会长得完全不一样。
 *   2. **零请求**。组件只在打开时挂载，打开前页面上只有那枚 36px 的按钮。
 *   3. **关闭必须解滚动锁**。锁在 `useScrollLock` 里，引用计数，四条关闭路径
 *      全部走同一个 `close()`。
 *
 * 为什么是单步切换而不是单页滚动
 * ──────────────────────────────
 * 五段文案叠成一页，390px 宽的手机上必然要滚，而"引导里还有滚动条"会让人
 * 以为没看完，Next 按钮还可能被推出视野。单步每屏约 260px，重点永远在一屏内。
 * 代价是多点四次 —— 用进度点和 `01 / 05` 抵掉。
 */

/* ── 五个纯 CSS 图形 ──
 * 都是 44×44 的浅色块，里面用边框/圆角/负边距拼。刻意保持极简：这些图形
 * 是"哪一步"的提示，不是插画。 */
function Figure({ name }) {
  const tile = 'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/[0.09]'

  if (name === 'grid') {
    /* 分类：两行两列的小方块，右下角选中 */
    return (
      <span className={tile} aria-hidden="true">
        <span className="flex flex-col gap-[3px]">
          <span className="flex gap-[3px]">
            <span className="h-3 w-3 rounded-[3px] bg-charcoal/25" />
            <span className="h-3 w-3 rounded-[3px] bg-charcoal/25" />
          </span>
          <span className="flex gap-[3px]">
            <span className="h-3 w-3 rounded-[3px] bg-charcoal/25" />
            <span className="h-3 w-3 rounded-[3px] bg-accent" />
          </span>
        </span>
      </span>
    )
  }

  if (name === 'zoom') {
    /* 看规格：放大镜 —— 一个圆环 + 一条 45° 的柄 */
    return (
      <span className={tile} aria-hidden="true">
        <span className="relative h-[15px] w-[15px] -translate-x-[2px] -translate-y-[2px] rounded-full border-2 border-accent">
          <span className="absolute -bottom-[5px] -right-[4px] h-[2px] w-[7px] origin-left rotate-45 rounded-full bg-accent" />
        </span>
      </span>
    )
  }

  if (name === 'swatches') {
    /* 颜色 / 尺码：三枚叠在一起的色卡 */
    return (
      <span className={tile} aria-hidden="true">
        <span className="flex -space-x-[6px]">
          <span className="h-[14px] w-[14px] rounded-full bg-accent ring-2 ring-cream" />
          <span className="h-[14px] w-[14px] rounded-full bg-charcoal/35 ring-2 ring-cream" />
          <span className="h-[14px] w-[14px] rounded-full bg-charcoal/15 ring-2 ring-cream" />
        </span>
      </span>
    )
  }

  if (name === 'list') {
    /* 生成码：三条购物行，最后一条是 accent（就是那一行"码"） */
    return (
      <span className={`${tile} flex-col gap-[4px]`} aria-hidden="true">
        <span className="h-[2px] w-[18px] rounded-full bg-charcoal/25" />
        <span className="h-[2px] w-[12px] rounded-full bg-charcoal/25" />
        <span className="h-[2px] w-[18px] rounded-full bg-accent" />
      </span>
    )
  }

  /* copy：两张错位的纸，前面那张写着两行字 */
  return (
    <span className={tile} aria-hidden="true">
      <span className="absolute left-[12px] top-[12px] h-[16px] w-[12px] rounded-[3px] border-2 border-charcoal/20" />
      <span className="absolute left-[17px] top-[17px] h-[16px] w-[12px] rounded-[3px] border-2 border-accent bg-cream">
        <span className="absolute left-[2px] right-[2px] top-[3px] h-[1.5px] rounded-full bg-accent/40" />
        <span className="absolute left-[2px] right-[4px] top-[7px] h-[1.5px] rounded-full bg-accent/40" />
      </span>
    </span>
  )
}

export default function OnboardingGuide({ open, onOpen, onClose }) {
  const [step, setStep] = useState(1)
  const cardRef = useRef(null)
  const nextRef = useRef(null)
  const touchX = useRef(null)

  useScrollLock(open)

  /* 每次重新打开都从第一步开始 —— `?` 是"从头讲一遍"，不是"接着上次"。 */
  useEffect(() => {
    if (open) setStep(1)
  }, [open])

  const next = () => {
    if (step >= GUIDE_TOTAL) onClose()
    else setStep((prev) => clampStep(prev + 1))
  }

  const prev = () => setStep((value) => clampStep(value - 1))

  /* 键盘：Esc 关，← → 翻。焦点落在 Next 上，Tab 在卡片内循环 —— 引导是
   * aria-modal 的对话框，让 Tab 跑到背后的网格里是明显的可访问性错误。 */
  useEffect(() => {
    if (!open) return undefined

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setStep((value) => clampStep(value + 1))
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setStep((value) => clampStep(value - 1))
        return
      }
      if (event.key !== 'Tab') return

      const card = cardRef.current
      if (!card) return
      const focusable = card.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) nextRef.current?.focus()
  }, [open, step])

  /* 左右滑动。阈值 40px：小于它多半是误触（手指按在按钮上抖了一下）。 */
  const onTouchStart = (event) => {
    touchX.current = event.changedTouches?.[0]?.clientX ?? null
  }
  const onTouchEnd = (event) => {
    const start = touchX.current
    touchX.current = null
    if (start === null) return
    const end = event.changedTouches?.[0]?.clientX
    if (end === undefined) return
    const dx = end - start
    if (Math.abs(dx) < 40) return
    if (dx < 0) setStep((value) => clampStep(value + 1))
    else setStep((value) => clampStep(value - 1))
  }

  const current = stepAt(step)

  return (
    <>
      {/* 常驻入口。底栏是 `fixed bottom-0 z-40` 且高约 72px，所以抬到 88px
          才不会压在「Generate my code」上；safe-area 让 iPhone 底部横条也躲开。 */}
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="How it works"
          className="fixed right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-charcoal/20 bg-cream/90 text-[13px] font-semibold leading-none text-charcoal/60 shadow-sm backdrop-blur-sm transition hover:border-charcoal/35 hover:text-charcoal active:scale-95"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
        >
          ?
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-title"
        >
          {/* 遮罩比商品弹层更重一点：引导要压住背景，否则看着像页面没反应 */}
          <div
            className="absolute inset-0 bg-charcoal/55 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <div
            ref={cardRef}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="guide-in relative z-10 max-h-[86vh] w-[min(92vw,400px)] overflow-y-auto rounded-3xl bg-cream p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-[38px] font-semibold leading-none tabular-nums text-accent/85">
                  {stepLabel(step)}
                </span>
                <Figure name={current.figure} />
              </div>

              {/* ✕ 纯 CSS：两条 1.5px 的斜线，不用图标 */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close guide"
                className="relative -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-charcoal/45 transition hover:bg-charcoal/5 hover:text-charcoal"
              >
                <span className="absolute h-[1.5px] w-3.5 rotate-45 rounded-full bg-current" />
                <span className="absolute h-[1.5px] w-3.5 -rotate-45 rounded-full bg-current" />
              </button>
            </div>

            {/* 定高：五段文案长度不一，不定高的话每翻一步整张卡片会上下跳 */}
            <div className="mt-4 min-h-[92px]">
              <h2
                id="guide-title"
                className="text-[17px] font-semibold leading-snug tracking-tight text-charcoal"
              >
                {current.title}
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-charcoal-light">
                {current.body}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {GUIDE_STEPS.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      index + 1 === step ? 'w-4 bg-accent' : 'w-1.5 bg-charcoal/15'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10.5px] tabular-nums tracking-wider text-charcoal-light">
                {stepLabel(step)} / {stepLabel(GUIDE_TOTAL)}
              </span>
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-charcoal/[0.07] pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-2 text-[12.5px] font-medium text-charcoal-light transition hover:bg-charcoal/5 hover:text-charcoal"
              >
                Skip
              </button>

              <div className="ml-auto flex items-center gap-2">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={prev}
                    className="rounded-full bg-cream-dark px-4 py-2 text-[12.5px] font-medium text-charcoal/75 transition hover:text-charcoal"
                  >
                    Back
                  </button>
                )}
                <button
                  ref={nextRef}
                  type="button"
                  onClick={next}
                  className="rounded-full bg-accent px-5 py-2 text-[12.5px] font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent-dark active:scale-[0.97]"
                >
                  {step >= GUIDE_TOTAL ? 'Got it' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
