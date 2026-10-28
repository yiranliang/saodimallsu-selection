import { useState, useEffect, useMemo, useRef } from 'react'
import Modal from './Modal.jsx'
import QuantityStepper from './QuantityStepper.jsx'
import CrossfadeImage from './CrossfadeImage.jsx'
import { Close, Plus, Check, Trash, AlertCircle } from './icons.jsx'
import { resolveProductImage, PLACEHOLDER_IMAGE } from '../utils/variantImage.js'
import { lineKey, isComplete, sanitizeSpecs, specTypesOf } from '../utils/lines.js'
import { isSizeType, sortSizes } from '../utils/sizes.js'
import { isSoldOut, isOptionAvailable } from '../utils/soldOut.js'
import { specPair } from '../utils/sku.js'
import { useAmazonLinks } from '../hooks/useAmazonLinks.js'
import { amazonUrlFor, hasListingFor, listingKnownFor } from '../store/linkStore.js'
import { badgeStyle } from '../utils/badge.js'
import { sizedImage, imageSrcSet, DETAIL_IMAGE_SIZES } from '../utils/image.js'
import { isTeaser } from '../utils/teaser.js'
import { isAcc, campaignIdOf } from '../utils/acc.js'
import { copyToClipboard } from '../utils/clipboard.js'
import {
  BADGE_ZONE,
  badgeStackFor,
  countdownDisplay,
  dealPhase,
  dealPriceInfo,
  dealWindow,
} from '../utils/deal.js'

/**
 * 双栏布局的生效条件 —— 必须和 tailwind.config.js 里 `split` screen 的 raw
 * 查询逐字一致。桌面（≥1024）或者横过来的手机/平板（≥768 且 landscape）：
 * 后者宽度够放两栏，竖着堆只会把规格压进一条 150px 高的滚动带。
 */
const TWO_PANE_QUERY =
  '(min-width: 1024px), (min-width: 768px) and (orientation: landscape)'

/**
 * Product detail sheet
 * ──────────────────────
 * Large image, spec pickers, quantity controls.
 *
 * Nothing is pre-selected: colour and size must be chosen deliberately before
 * the piece can be added. That removes a whole class of "wrong variant" orders
 * — a defaulted first option is invisible to the creator and to ops.
 *
 * ONE PRODUCT, SEVERAL LINES
 * The footer always acts on the combination currently shown in the pickers, not
 * on the product as a whole. Pick Black/M and add, switch to White/L and add,
 * switch back to Black/M — the footer shows Black/M's own quantity again. The
 * "also in your selection" list underneath makes the other lines visible and
 * removable without going back to the cart.
 *
 * A DELETED COLOUR CANNOT BE ADDED
 * The seed is sanitised against the product's current option list, so a
 * combination the admin removed since the creator picked it comes back as
 * incomplete and the button asks for a new choice instead of silently ordering
 * something that no longer exists.
 */
export default function ProductDetail({
  product,
  open,
  lines = [],
  onAdd,
  onIncrement,
  onDecrement,
  onRemove,
  onClose,
}) {
  const [spec, setSpec] = useState({})
  const [beat, setBeat] = useState(false)

  /* Subscribed here rather than passed down: the ASIN depends on the colour and
   * size currently in the pickers, which only this component knows. */
  useAmazonLinks()

  const specTypes = useMemo(() => specTypesOf(product), [product])

  /* Seed from the most recent line of this product, minus anything the
   * catalogue no longer offers. Re-runs when the product changes or the sheet
   * reopens — `lines` is intentionally not a dependency, otherwise adding a
   * variant would reset the pickers mid-flow. */
  useEffect(() => {
    if (!open || !product) return
    const recent = lines[lines.length - 1]
    setSpec(recent ? sanitizeSpecs(product, recent.specs) : {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id])

  /* ── the deal clock ──
   * One ticker for the whole sheet, and only when there is something to count
   * down: a product with no window, or a teaser (Coming Soon wins, so its price
   * is never shown) starts no timer at all.
   *
   * `setInterval` + local state, zero network: the window is five text fields
   * already in the catalogue, so re-reading them would be a request per second
   * for data the page is holding. When the count reaches zero the interval
   * clears itself and the next render simply finds `active: false` — the badge,
   * the strikethrough and the countdown all disappear and the normal price
   * (i.e. no price block) comes back. */
  const [now, setNow] = useState(() => Date.now())
  /* 倒计时归零之后，那一格不立刻消失，先换成 "Deal ended" 停 1.8 秒再收起。
   * 直接卸载会让"还剩 1 秒"跳成空白 —— 看起来像页面坏了，而不是活动结束了。 */
  const [justEnded, setJustEnded] = useState(false)
  const endedTimer = useRef(null)

  /* 换商品 / 重开弹层：把上一款的"已结束"尾巴清掉。 */
  useEffect(() => {
    setJustEnded(false)
    clearTimeout(endedTimer.current)
  }, [product?.id, open])

  useEffect(() => () => clearTimeout(endedTimer.current), [])

  useEffect(() => {
    if (!open || !product) return undefined

    const tick = () => setNow(Date.now())
    tick()

    /* Runs for `scheduled` too: a sheet opened ten minutes before the start has
     * to flip to "ends in" on its own, without a reload. */
    const opening = isTeaser(product) ? 'off' : dealPhase(product, Date.now())
    if (opening !== 'live' && opening !== 'scheduled') return undefined

    const id = setInterval(() => {
      const at = Date.now()
      setNow(at)
      /* Stop at the end rather than ticking once a second for the life of the
       * sheet: past that point every tick would render the same DOM. */
      const current = isTeaser(product) ? 'off' : dealPhase(product, at)
      if (current === 'ended' || current === 'off') {
        clearInterval(id)
        /* 只在这个 ticker 跑起来过的前提下才会走到这里，也就是"刚才还在
         * live/scheduled"—— 所以这一次切换确实是从有到无，值得给个交代。 */
        setJustEnded(true)
        clearTimeout(endedTimer.current)
        endedTimer.current = setTimeout(() => setJustEnded(false), 1800)
      }
    }, 1000)

    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id, product?.saleStart, product?.saleEnd, product?.isTeaser])

  /* ── ACC 的复制反馈 ──
   * 复制成功后按钮变成 Copied 1.8 秒。定时器存在 ref 里并在卸载时清掉：
   * 一个已经关掉的弹层不该再 setState。换商品时也要复位，否则第二个商品
   * 一打开就顶着上一个商品的 "Copied"。
   *
   * 状态必须放在下面的 early return 之前 —— 这是 hook 顺序的硬要求。 */
  const [accCopied, setAccCopied] = useState(false)
  const accTimer = useRef(null)

  useEffect(() => {
    setAccCopied(false)
    clearTimeout(accTimer.current)
  }, [product?.id])

  useEffect(() => () => clearTimeout(accTimer.current), [])

  /* ── 手机端：图片吸顶后收缩 ──
   * 图片是滚动区里的 `sticky` 元素，规格从它下面滑过去。吸住之后把高度从
   * 36vh 收到 30vh，把空间让给规格 —— 不然"吸住了"只是换了个方式占屏。
   *
   * 两个阈值是有意的：往下滚过 56px 才算吸住，往回收要回到 24px 以内才还原。
   * 同一个阈值会让高度一变就立刻抖回来（收缩本身改变了 scrollTop 的相对位置），
   * 于是来回抽搐。桌面是双栏，图片根本不滚，直接复位。
   */
  const [stuck, setStuck] = useState(false)
  const scrollerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const el = scrollerRef.current
    if (!el) return undefined

    /* 换商品 / 重新打开都从顶部开始，否则上一款滚到的位置会留在这一款上 */
    el.scrollTop = 0
    setStuck(false)

    /* 与 tailwind.config.js 的 `split` screen 是同一条查询：桌面，或横过来的
     * 手机。两处必须一致，否则会出现"已经是双栏了，图片还在收缩"的错位。 */
    const desktop = window.matchMedia(TWO_PANE_QUERY)
    let frame = 0

    /* 收缩要"有地方可让"才做。内容本来就只超出几十像素时，把图片收掉 40px
     * 会把滚动行程一起吃掉 —— 用户滚到一半发现页面瞬间往回缩。
     *
     * 门槛 = 吸住阈值（56）+ 收缩量（约 40）。低于它，收完就会触发浏览器的
     * scrollTop 钳位，看起来像"滚回去了一点"。够格就只吸住、不收。
     * 这个判断只在**从未吸住变成吸住**时做一次，不参与每帧计算，否则
     * scrollHeight 会随状态变化，条件自己打架、来回抽搐。 */
    const SHRINK_MIN_OVERFLOW = 100

    const read = () => {
      frame = 0
      if (desktop.matches) {
        setStuck(false)
        return
      }
      const top = el.scrollTop
      setStuck((prev) => {
        /* 两个阈值：吸住 56、还原 24。同一个阈值会在收缩后立刻抖回来。 */
        if (prev) return top > 24
        if (top <= 56) return false
        return el.scrollHeight - el.clientHeight > SHRINK_MIN_OVERFLOW
      })
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(read)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    desktop.addEventListener('change', read)
    read()

    return () => {
      el.removeEventListener('scroll', onScroll)
      desktop.removeEventListener('change', read)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [open, product?.id])

  /* "No ASIN" folds into the same answer as sold out: a combination the ASIN
   * table has nothing for cannot be ordered either, so it greys out exactly
   * like a sold-out one. The lookup reuses `listingKnownFor`, which reads the
   * public `product_links` view — the one storefront-safe signal for "does this
   * colour/size have a listing", since the real ASINs stay behind RLS.
   *
   * MUST stay above the `if (!product) return null` below. A hook after an
   * early return runs only on the renders that get past it, so the sheet ran
   * one hook more once a product arrived — React #310, "rendered more hooks
   * than during the previous render". `product?.id` keeps the null case safe. */
  const asinLookup = useMemo(
    () => (colour, size) => listingKnownFor(product?.id, colour, size),
    [product?.id],
  )

  if (!product) return null

  const campaignId = campaignIdOf(product)

  const copyCampaignId = async () => {
    if (!campaignId) return
    const ok = await copyToClipboard(campaignId)
    if (!ok) return
    setAccCopied(true)
    clearTimeout(accTimer.current)
    accTimer.current = setTimeout(() => setAccCopied(false), 1800)
  }

  const complete = isComplete(product, spec)
  const missing = specTypes.filter((type) => !spec[type])

  /* Sold out is checked against the *complete* combination, never per option:
   * Green being out of M says nothing about Green in L. `isOptionAvailable`
   * applies the same rule per button, using whatever is picked so far.
   *
   * `asinLookup` (defined above the early return) makes a combination with no
   * ASIN answer "unavailable" too, so the same grey-out covers both. */
  const soldOutNow = complete && isSoldOut(product, spec, asinLookup)

  /* The combination currently in the pickers — this is what the footer edits */
  const currentKey = complete ? lineKey(product, spec) : ''
  const currentLine = currentKey ? lines.find((line) => line.key === currentKey) : undefined
  const others = lines.filter((line) => line.key !== currentKey)

  /* Coming Soon locks the purchase, not the browsing: colour stays pickable so
   * the creator can preview every variant photo, but no size can be chosen and
   * the add button never appears. */
  const teaser = isTeaser(product)

  /* Coming Soon outranks the sale, hard: a locked style quoting "50% OFF" is an
   * invitation to tap something that cannot be bought. So the window is not
   * even computed for a teaser, which is also what lets the ticker above skip
   * the timer entirely. */
  const saleWindow = teaser ? null : dealWindow(product, now)
  const phase = teaser ? 'off' : dealPhase(product, now)
  /* Scheduled deals show too — the whole point of putting them in the deals tab
   * is that a creator can read the details and add the piece before the window
   * opens. The countdown just counts the other way ("starts in"). */
  const dealShown = phase === 'live' || phase === 'scheduled'
  const priceInfo = dealShown ? dealPriceInfo(product) : null
  const countdownMs = phase === 'scheduled' ? saleWindow?.msUntilStart : saleWindow?.msLeft

  // Re-renders on every pick, so choosing a colour swaps the photo in place
  const resolved = resolveProductImage(product, spec)
  /* 角标栈 —— 和卡片同一个函数，但用的是 `detail` 面：**详情页永远给完整信息**
   * （折扣行 + ACC 身份），不跟着用户从哪个 tab 点进来变。这是刻意的：
   * 卡片是"扫"，详情是"判断"，同一个商品在两个面上的差异必须只跟位置有关，
   * 不能跟来路有关。 */
  const badges = badgeStackFor(product, now, { zone: BADGE_ZONE.DETAIL })
  const countdown = dealShown ? countdownDisplay(phase, countdownMs) : null

  /* Link is product-level (the first ASIN); "has a listing" is per combination,
   * so a creator who picked a colour that was never linked is told so instead
   * of being sent to a dead Amazon page. */
  const amazonUrl = amazonUrlFor(product.id)
  const { colour, size } = specPair(spec)
  const listingLinked = complete ? hasListingFor(product.id, colour, size) : true

  const handlePick = (type, value) => {
    setSpec((prev) => ({ ...prev, [type]: value }))
  }

  const handleAdd = () => {
    if (teaser || !complete || soldOutNow) return
    setBeat(true)
    setTimeout(() => setBeat(false), 420)
    onAdd(product, spec)
    /* 加购成功后自动收起弹层，回到列表。留 ~180ms 让 beat 动画和父组件
     * 的 Toast 先出现一帧，再关 —— 直接 `onClose()` 会在动画起步前就卸载，
     * 反馈一闪而过。Coming Soon / 未选全 / 售罄 在上面已经 return，不会走到
     * 这里，所以"不可加购就不关"是这条代码的天然性质。 */
    setTimeout(() => onClose(), 180)
  }

  const describe = (line) => Object.values(line.specs).filter(Boolean).join(' / ')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      /* Two columns need room. The sheet stays 512px on phones and tablets, and
       * widens to 1024px exactly where the split layout takes over. */
      maxWidth="max-w-lg split:max-w-5xl"
    >
      {/* One DOM for two layouts.
       *
       * MOBILE — a flex column: photo (sticky inside the scroller), info, action
       * bar. `min-h-0` on the scroller is what lets it actually shrink inside a
       * `max-h` flex parent.
       *
       * SPLIT — `split:grid` + `split:contents` on the scroller: the scroll box
       * stops generating a box, so its two children become grid items directly.
       * That is what allows the photo to span both rows on the left (footer
       * included) while the info pane scrolls on its own on the right — without
       * rendering the image twice or duplicating the markup.
       *
       * `split` is a custom screen in tailwind.config.js: a desktop, OR a phone
       * held sideways. Same query as TWO_PANE_QUERY below — keep them in sync. */}
      <div className="flex max-h-[92vh] flex-col split:grid split:h-[min(88vh,860px)] split:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] split:grid-rows-[minmax(0,1fr)_auto]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-charcoal shadow-sm backdrop-blur transition hover:bg-white"
        >
          <Close className="h-4 w-4" />
        </button>

        <div
          ref={scrollerRef}
          data-detail-scroll
          className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain split:contents"
        >
          {/* Same white `object-contain` frame as the card, so the photo the
              creator tapped is framed exactly as she tapped it — no jump in
              composition between grid and sheet.

              MOBILE: `sticky top-0`. Selection used to force a choice between
              scrolling up to check the colour and scrolling down to pick the
              size; sticking the photo keeps both in view. It also shrinks to
              30vh once stuck, so the specs get the space instead.
              DESKTOP: a plain grid cell spanning both rows — it never scrolls,
              so "sticky" has nothing to do there. */}
          <div
            data-detail-photo
            className={`sticky top-0 z-10 shrink-0 overflow-hidden bg-white transition-[height] duration-300 ease-out motion-reduce:transition-none split:static split:z-0 split:row-span-2 split:h-full ${
              stuck
                ? 'h-[clamp(160px,30vh,260px)] border-b border-charcoal/10 shadow-[0_10px_18px_-14px_rgba(43,43,43,0.45)]'
                : 'h-[clamp(180px,36vh,380px)]'
            }`}
          >
            <div className="relative h-full w-full">
              {/* The one image the user explicitly asked for: eager, because a
                  spinner here is worse than a byte, but still sized — 640 covers
                  a 512 px square at 2× and saves 40% against the listing size.
                  `CrossfadeImage` keeps the old colour on screen until the new
                  one has decoded, so switching is a fade instead of a white
                  flash. */}
              {/* `fetchpriority` is lowercase on purpose: React 18 does not know
                  the camelCase `fetchPriority` and warns about it on every render
                  ("React does not recognize the `fetchPriority` prop"). A
                  lowercase attribute is passed through to the DOM as-is, which is
                  what the browser actually wants. */}
              <CrossfadeImage
                key={product.id}
                src={sizedImage(resolved, 640)}
                srcSet={imageSrcSet(resolved, [640, 960])}
                sizes={DETAIL_IMAGE_SIZES}
                fallback={product.image || PLACEHOLDER_IMAGE}
                alt={product.name}
                loading="eager"
                fetchpriority="high"
                className="h-full w-full object-contain"
              />
              {badges.length > 0 && (
                /* 纵向 Flex，8px 间距（gap-2）：详情页的文字比卡片大一号，
                   间距也要跟着放大一档，两枚才不会被读成一块。 */
                <div
                  data-badge-stack
                  className="absolute left-4 top-4 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2"
                >
                  {badges.map((entry, index) => {
                    const style = badgeStyle(entry.value)
                    return (
                      <span
                        key={`${entry.kind}-${index}`}
                        style={style || undefined}
                        className={`max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          style ? '' : 'bg-charcoal/80 text-cream backdrop-blur-sm'
                        }`}
                      >
                        {entry.text}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div
            data-detail-pane="info"
            className="no-scrollbar px-5 pb-6 pt-5 sm:px-7 split:min-h-0 split:overflow-y-auto split:py-7 split:pr-12"
          >
            {product.category && (
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-charcoal-light">
                {product.category}
              </div>
            )}
            <h2 className="mt-1 text-xl font-semibold leading-snug tracking-tight text-charcoal">
              {product.name}
            </h2>

            {/* Deal countdown — right under the name, where the price will be.
                Local arithmetic on a string already in the catalogue: no
                request, no server clock, no drift between creator and admin.

                `flex w-fit`, not `inline-flex`: the Amazon link below is also
                inline, and the two were sharing a line — a countdown wedged
                against a link reads as one control. Its own row, still only as
                wide as its content. */}
            {countdown && (
              /* `key` 带上 phase 和 mode：排期中跨过开始时间、或者倒计时从
                 "3 days" 掉进 "23:59:59" 时，React 会重挂这一格，`animate-fade-in`
                 才有机会重播 —— 否则数字是"跳"过去的，不是"换"过去的。 */
              <div
                key={`${phase}-${countdown.mode}`}
                data-deal-countdown={countdown.mode}
                className="mt-2 flex w-fit items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] font-semibold text-red-600 ring-1 ring-red-100 animate-fade-in motion-reduce:animate-none"
              >
                {countdown.lead && <span>{countdown.lead}</span>}
                <span className={countdown.mode === 'days' ? '' : 'tabular-nums'}>
                  {countdown.value}
                </span>
              </div>
            )}
            {!countdown && justEnded && (
              /* 归零后的落点。1.8 秒后自己消失，价格区在这期间已经换回原价 ——
                 用户看到的是"刚结束"，不是"页面忽然空了"。 */
              <div
                data-deal-ended
                className="mt-2 flex w-fit items-center gap-1.5 rounded-lg bg-cream-dark/60 px-2.5 py-1.5 text-[12px] font-medium text-charcoal-light ring-1 ring-charcoal/10 animate-fade-in motion-reduce:animate-none"
              >
                <span>Deal ended</span>
              </div>
            )}

            {/* Amazon — size chart and reviews live there */}
            {amazonUrl ? (
              <a
                href={amazonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-charcoal/75 underline decoration-charcoal/20 underline-offset-2 transition hover:text-charcoal hover:decoration-charcoal/50"
              >
                View on Amazon
                <span aria-hidden="true">↗</span>
                <span className="text-charcoal-light/60">· size chart &amp; reviews</span>
              </a>
            ) : (
              <p className="mt-2 text-[11.5px] text-charcoal-light/70">Listing not linked yet</p>
            )}

            {/* ACC（Amazon Creator Connections）
                Sits between the listing link and the pickers: it explains what
                the shopping is worth before she chooses sizes, not after. The
                card exists whenever the switch is on, even with no ID yet — the
                "Still pending" state is honest, and hiding the card would make
                the badge on the card look unexplained. */}
            {isAcc(product) && (
              <div
                data-acc-card
                className="mt-3 flex items-start gap-3 rounded-xl bg-amber-50/70 px-3 py-2.5 ring-1 ring-amber-200/70"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
                    <span aria-hidden="true">💰</span>
                    <span>Earn Commission</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-900/70">
                    Amazon Creator Connections campaign — order this style through the
                    campaign and the commission is tracked on Amazon&apos;s side.
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-amber-900/50">
                      Campaign ID
                    </span>
                    {campaignId ? (
                      <span
                        data-acc-id
                        className="max-w-full truncate font-mono text-[11.5px] leading-relaxed text-amber-900"
                        title={campaignId}
                      >
                        {campaignId}
                      </span>
                    ) : (
                      <span className="text-[11px] italic text-amber-900/55">Still pending</span>
                    )}
                  </div>
                </div>

                {/* `disabled` when there is nothing to copy, rather than hiding the
                    button: a card that silently loses its control looks broken. */}
                <button
                  type="button"
                  onClick={copyCampaignId}
                  disabled={!campaignId}
                  aria-label="Copy campaign ID"
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                    campaignId
                      ? 'bg-amber-700 text-white hover:bg-amber-800 active:scale-95'
                      : 'cursor-not-allowed bg-amber-700/15 text-amber-900/40'
                  }`}
                >
                  <span aria-live="polite">{accCopied ? 'Copied' : 'Copy ID'}</span>
                </button>
              </div>
            )}

            {/* Specs — all required */}
            {specTypes.length > 0 && (
              <div className="mt-5 space-y-4">
                {specTypes.map((type) => {
                  const declared = Array.isArray(product.specs[type])
                    ? product.specs[type]
                    : [product.specs[type]]
                  /* Sizes are ordinal, colours are not. The stored array is
                   * import order — roughly a third of the catalogue has
                   * `["XXL","S","L","M","XL"]` — so sizes get sorted here and
                   * colours keep the admin's own order. Read-only: `specs` is
                   * never rewritten (utils/sizes.js explains why). */
                  const options = isSizeType(type) ? sortSizes(declared) : declared
                  /* Teaser locks the size axis only — colour stays pickable so
                   * every variant photo can still be previewed. */
                  const locked = teaser && isSizeType(type)

                  return (
                    <div key={type} data-spec-group={type}>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-light">
                        {type}
                        <span className="text-charcoal/40">·</span>
                        <span
                          className={`font-normal normal-case tracking-normal ${
                            locked ? 'text-charcoal/45' : spec[type] ? 'text-charcoal/70' : 'text-accent'
                          }`}
                        >
                          {locked ? 'Coming soon' : spec[type] || 'Required'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {options.map((opt) => {
                          const active = spec[type] === opt
                          /* Never grey out what is already selected — she needs
                           * to see her own choice, and the footer explains that
                           * this combination is gone. Greying it would look
                           * like the colour vanished from the product. */
                          const gone = !active && !isOptionAvailable(product, spec, type, opt, asinLookup)
                          /* A teaser locks every size, including one that was
                           * selected before the style went on pre-order — there
                           * is no valid combination to add. */
                          const dimmed = locked || gone
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handlePick(type, opt)}
                              disabled={dimmed}
                              aria-pressed={active}
                              aria-disabled={dimmed}
                              className={`rounded-full px-3.5 py-2 text-[13px] transition-all duration-200 active:scale-95 ${
                                dimmed
                                  ? 'cursor-not-allowed bg-cream-dark/50 text-charcoal/35 ring-1 ring-charcoal/[0.06]'
                                  : active
                                    ? 'bg-charcoal text-cream'
                                    : 'bg-white text-charcoal/80 ring-1 ring-charcoal/10 hover:ring-charcoal/25'
                              }`}
                            >
                              <span className={gone && !locked ? 'line-through' : ''}>{opt}</span>
                              {gone && !locked && (
                                <span className="ml-1.5 text-[10px] tracking-wide text-charcoal/35">
                                  (Sold out)
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {specTypes.length === 0 && (
              <p className="mt-4 text-[13px] text-charcoal-light">One size only.</p>
            )}

            {/* No ASIN for this combination — but "no ASIN = sold out" now means
                the footer already says Sold out for this exact case, so the
                softer "no listing" hint only shows when the combination is not
                being blocked as sold out (e.g. the links view is unavailable). */}
            {complete && !listingLinked && !soldOutNow && (
              <p className="mt-4 rounded-xl bg-cream-dark/70 px-3 py-2 text-[11.5px] leading-relaxed text-charcoal-light">
                No listing linked for this colour / size yet. Your contact can
                confirm stock before it ships.
              </p>
            )}

            {/* Other variants of this piece already in the selection */}
            {others.length > 0 && (
              <div className="mt-5 border-t border-charcoal/[0.07] pt-4">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-charcoal-light">
                  Also in your selection
                </div>
                <div className="mt-2 space-y-1.5">
                  {others.map((line) => (
                    <div
                      key={line.key}
                      className="flex items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-2 ring-1 ring-charcoal/[0.06]"
                    >
                      <button
                        type="button"
                        onClick={() => setSpec(sanitizeSpecs(product, line.specs))}
                        className="min-w-0 flex-1 truncate text-left text-[12px] text-charcoal/80 transition hover:text-charcoal"
                      >
                        {describe(line)}
                        <span className="ml-1.5 tabular-nums text-charcoal/45">×{line.qty}</span>
                        {isSoldOut(product, line.specs, asinLookup) && (
                          <span className="ml-1.5 text-[10px] font-medium text-red-500">
                            Sold out
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(line.key)}
                        aria-label={`Remove ${describe(line)}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — acts on the combination currently in the pickers.
         * Sold out wins over everything: a line that is already in the
         * selection cannot be stepped up, and a new one cannot be added.
         *
         * In the split layout it belongs to the right column only (`split:col-start-2`),
         * directly under the info pane — a 1024px-wide button bar under a photo
         * reads as a checkout bar, not a product sheet. */}
        <div
          data-detail-footer
          className="shrink-0 border-t border-charcoal/[0.07] bg-cream px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:pb-5 split:col-start-2 split:row-start-2"
        >
          {/* Deal price, above the action it belongs to. Large on purpose: this
              is the one number the creator came for, and it must not be a
              footnote under a paragraph. Shown for a scheduled deal as well —
              "this is what it will cost in 20 minutes" is the reason to wait.
              Absent once the window closes, and absent for a teaser (Coming Soon
              replaces the whole block). */}
          {priceInfo && (
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[26px] font-semibold leading-none tabular-nums text-red-600">
                {priceInfo.price}
              </span>
              {priceInfo.was && (
                <span className="text-[13px] leading-none tabular-nums text-charcoal-light line-through">
                  {priceInfo.was}
                </span>
              )}
              {priceInfo.label && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                  {priceInfo.label}
                </span>
              )}
            </div>
          )}
          {teaser ? (
            /* Coming Soon replaces the add button outright. It is checked
             * before `complete`, because a one-size teaser is "complete" and
             * would otherwise slip through. */
            <div className="space-y-2">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-charcoal/10 py-3.5 text-[15px] font-medium text-charcoal/40"
              >
                Coming Soon
              </button>
              {currentLine && (
                <button
                  type="button"
                  onClick={() => onRemove(currentLine.key)}
                  className="w-full rounded-full py-2.5 text-[12px] font-medium text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
                >
                  Remove from my selection
                </button>
              )}
            </div>
          ) : currentLine && soldOutNow ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-red-500">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Sold out — remove it or pick another</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(currentLine.key)}
                className="shrink-0 rounded-full bg-red-500 px-3 py-2 text-[12px] font-medium text-white transition hover:bg-red-600 active:scale-95"
              >
                Remove
              </button>
            </div>
          ) : currentLine ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <QuantityStepper
                  qty={currentLine.qty}
                  size="lg"
                  onIncrement={() => onIncrement(currentLine.key)}
                  onDecrement={() => onDecrement(currentLine.key)}
                />
                <span className="flex items-center gap-1 text-[12px] font-medium text-accent">
                  <Check className="h-3.5 w-3.5" />
                  In your selection
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(currentLine.key)}
                className="rounded-full px-3 py-2 text-[12px] text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
              >
                Remove
              </button>
            </div>
          ) : soldOutNow ? (
            <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-3.5 py-3 text-[12px] leading-snug text-red-600">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This colour and size is sold out. Pick another combination — the rest of
                this piece is still available.
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={!complete}
              className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-medium transition-all duration-200 ${
                complete
                  ? 'bg-accent text-white shadow-lg shadow-accent/20 hover:bg-accent-dark active:scale-[0.97]'
                  : 'cursor-not-allowed bg-charcoal/10 text-charcoal/35'
              } ${beat ? 'animate-pop' : ''}`}
            >
              {complete ? (
                <>
                  <Plus className="h-4 w-4" />
                  Add to my selection
                </>
              ) : (
                `Choose ${missing.join(' & ').toLowerCase()}`
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
