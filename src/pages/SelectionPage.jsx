import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import Header from '../components/Header.jsx'
import { brandConfig } from '../data/products.js'
import CategoryNav from '../components/CategoryNav.jsx'
import ProductGrid from '../components/ProductGrid.jsx'
import ProductDetail from '../components/ProductDetail.jsx'
import CartDrawer from '../components/CartDrawer.jsx'
import BottomBar from '../components/BottomBar.jsx'
import CodeModal from '../components/CodeModal.jsx'
import Toast from '../components/Toast.jsx'
import StaffAccess from '../components/StaffAccess.jsx'
import OnboardingGuide from '../components/OnboardingGuide.jsx'
import { useProducts, useCatalogueStatus } from '../hooks/useProducts.js'
import { useSelection } from '../hooks/useSelection.js'
import { useToast } from '../hooks/useToast.js'
import { useAmazonLinks } from '../hooks/useAmazonLinks.js'
import { getInfluencerRef } from '../utils/storage.js'
import { generateCodeFromLines, saveRecord } from '../utils/code.js'
import { UNCATEGORISED, loadProducts, getCatalogueError } from '../store/productStore.js'
import { amazonUrlFor, listingKnownFor } from '../store/linkStore.js'
import { useCategories } from '../hooks/useCategories.js'
import { useSettings } from '../hooks/useSettings.js'
import { isComplete } from '../utils/lines.js'
import { isSoldOut } from '../utils/soldOut.js'
import { isTeaser } from '../utils/teaser.js'
import { DEALS_TAB, bucketCountsOf, bucketOf, discountOf, dealsOrder, filterDeals } from '../utils/deal.js'
import { hasSeenGuide, markGuideSeen, shouldAutoOpen } from '../utils/guide.js'
import { PAGE_SIZE, storefrontOrder, filterCatalogue, slicePage, nextLimit, hasMore } from '../utils/catalogue.js'

/**
 * Sold-out check that folds "no ASIN" in, for the storefront.
 * The storefront cannot read real ASINs (RLS), so `hasListingFor` — the public
 * `product_links` signal — stands in: a combination with no listing is
 * unorderable and must behave exactly like a sold-out one.
 */
function storefrontSoldOut(product, specs) {
  return isSoldOut(product, specs, (c, s) => listingKnownFor(product.id, c, s))
}

/**
 * Creator-facing selection page
 * ──────────────────────────────
 * Header → category rail → filtered grid → cart preview → code.
 *
 * The selection is a list of variant lines, not a map of products: the same
 * piece can be taken in two colours and both count. Everything that used to be
 * keyed by product id is now keyed by line, so the handlers below take a line
 * key wherever they act on a specific combination.
 */
export default function SelectionPage() {
  const { toasts, showToast } = useToast()
  const products = useProducts()
  const catalogueStatus = useCatalogueStatus()

  const categoryOrder = useCategories()
  /* 专区 Tab 的名字（后台可改成 `Black Friday Deals`）。卡片要用它去重：
   * 进了这个专区，挂"同一场活动"的角标是零信息。 */
  const { dealsTabLabel } = useSettings()
  // Subscribed so the cards re-render when the ASIN map lands
  useAmazonLinks()

  const influencerRef = useMemo(() => getInfluencerRef(), [])
  const influencerName = influencerRef === 'guest' ? '' : influencerRef

  const {
    lines,
    getQty,
    linesFor,
    add,
    increment,
    decrement,
    remove,
    removeAll,
    clearAll,
    renew,
    reconcile,
    expiredOnLoad,
  } = useSelection()

  const [detailProduct, setDetailProduct] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  /* `styles` / `units` are snapshotted into the modal so the code sheet quotes
   * the counts that produced THAT code, even if the creator keeps shopping. */
  const [codeModal, setCodeModal] = useState({ open: false, code: '', styles: 0, units: 0 })
  const [holdSkeleton, setHoldSkeleton] = useState(false)
  const dataLoading = catalogueStatus === 'idle' || catalogueStatus === 'loading'
  const [activeCategory, setActiveCategory] = useState('All')
  /* Which discount band the ⚡ Limited Deals tab is narrowed to. `'all'` is the
   * tab's own default; the four real bands come from DEAL_BUCKETS. */
  const [dealBucket, setDealBucket] = useState('all')
  /* Onboarding guide. `open` is the only state: whether it *should* open first
   * is decided once, below, from localStorage + whether the grid has data. */
  const [guideOpen, setGuideOpen] = useState(false)
  const [query, setQuery] = useState('')
  /* How many cards are on screen. Reset to one batch whenever the filter
   * changes — otherwise going Tops → All would keep the deeper limit and the
   * page would jump from 3 cards to 139. */
  const [limit, setLimit] = useState(PAGE_SIZE)

  /* The old code waited a flat 450 ms before it would even show the skeleton,
   * then let the fetch decide — so a fast connection stared at nothing and a
   * slow one got no head start. Now the skeleton is on screen from the first
   * frame (it is CSS, it costs nothing), and once the data lands it stays for
   * another 250 ms so it cannot flash for one frame on a warm start. */
  useEffect(() => {
    if (dataLoading) {
      setHoldSkeleton(true)
      return
    }
    if (!holdSkeleton) return
    const timer = setTimeout(() => setHoldSkeleton(false), 250)
    return () => clearTimeout(timer)
  }, [dataLoading, holdSkeleton])

  /* An aged-out draft is discarded silently by `useSelection` — without this it
   * looks like the site ate her cart. Fired once, only when there was actually
   * something to lose (see `expiredOnLoad`). */
  const expiryNoticeShown = useRef(false)
  useEffect(() => {
    if (!expiredOnLoad || expiryNoticeShown.current) return
    expiryNoticeShown.current = true
    showToast('Your previous selection has expired. Starting a fresh one!', 'default', 4500)
  }, [expiredOnLoad, showToast])

  const loading = dataLoading || holdSkeleton

  /* Auto-open once, and only when there is something to look at.
   *
   * The 500 ms delay is not decoration: the guide is a modal, so opening it on
   * the same frame the first cards paint would cover the very grid it is
   * describing. Half a second is enough for the grid to land and short enough
   * that nobody has started tapping yet.
   *
   * `shouldAutoOpen` also refuses on an error screen — that page is a retry
   * button, and a modal over it reads as "the site is broken AND chatty". */
  const guideChecked = useRef(false)
  useEffect(() => {
    if (guideChecked.current || loading) return
    if (!shouldAutoOpen({
      loading,
      failed: catalogueStatus === 'error',
      seen: hasSeenGuide(),
    })) {
      guideChecked.current = true
      return
    }

    const timer = setTimeout(() => {
      /* Re-read: another tab may have closed it while we waited. */
      if (hasSeenGuide()) return
      guideChecked.current = true
      setGuideOpen(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [loading, catalogueStatus])

  /* Every close path (Skip / Got it / ✕ / overlay / Esc) lands here, and the
   * "seen" flag is written here — never on open. Somebody who refreshes halfway
   * through has not seen it. */
  const closeGuide = useCallback(() => {
    markGuideSeen()
    setGuideOpen(false)
  }, [])

  /**
   * Hidden products are off the storefront entirely: no card, no category
   * count, no cart line, and they never enter a new code. They stay in the
   * catalogue, so codes already generated still decode with a name and image.
   *
   * This is a POLICY, not an accident: `hidden` is what keeps a draft off the
   * page. Batch import creates new 货号 as hidden by default precisely so a
   * half-prepared style cannot be ordered before its photos and ASINs are in.
   * `storefrontOrder` still knows how to sink hidden rows to the bottom, so
   * flipping this flag is all it takes to publish them — but flipping it also
   * publishes every draft on the next deploy.
   */
  const SHOW_HIDDEN_PRODUCTS = false
  const catalogue = useMemo(
    () => (SHOW_HIDDEN_PRODUCTS ? products.slice() : products.filter((p) => !p.hidden)),
    [products],
  )

  /* ⚡ Limited Deals — a VIEW over the same catalogue, not a category.
   *
   * `filterDeals` keeps live + scheduled windows (an ended deal is just a normal
   * product again, so it does not belong here). The count drives the chip: at
   * zero the tab disappears entirely.
   *
   * Recomputed only when the catalogue changes, so a window opening while a tab
   * sits open is picked up on the next catalogue load rather than on a timer —
   * the alternative is a re-render every second for a chip. */
  const dealPool = useMemo(() => filterDeals(catalogue), [catalogue])
  const isDeals = activeCategory === DEALS_TAB

  /**
   * Align a restored selection with the catalogue.
   * This is what removes a colour the admin deleted while the tab was open —
   * without it the cart keeps offering a variant that no longer exists.
   */
  useEffect(() => {
    reconcile(products)
  }, [products, reconcile])

  /* ── categories derived from the live catalogue ── */
  const categoryCounts = useMemo(() => {
    const counts = {}
    catalogue.forEach((p) => {
      const key = p.category || UNCATEGORISED
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, [catalogue])

  const categoryList = useMemo(() => {
    // Follow the managed category order so the rail never reshuffles when
    // products are added, and picks up renames immediately. Categories the
    // admin has never listed go before the Uncategorised bucket.
    const rank = (name) => {
      const i = categoryOrder.indexOf(name)
      if (i !== -1) return i
      return name === UNCATEGORISED ? 999 : 500
    }
    return Object.keys(categoryCounts).sort((a, b) => rank(a) - rank(b))
  }, [categoryCounts, categoryOrder])

  /* The search box stays fully responsive while the grid catches up.
   *
   * Typing used to re-filter 273 products and re-render 24 cards on every
   * keystroke, synchronously, on the same thread that has to echo the character
   * into the input. `useDeferredValue` lets React paint the input first and
   * re-run the filter at lower priority. On a slow phone that is the difference
   * between the box keeping up with the thumb and it lagging a character behind.
   *
   * The *deferred* value drives the list, the live one drives the input — so
   * what she typed is always what she sees in the field. */
  const deferredQuery = useDeferredValue(query)

  /* Filter once, page after — the slice is always the last step, so "load more"
   * keeps counting inside the current category + search, never the whole
   * catalogue. See utils/catalogue.js.
   *
   * The deals tab runs the same search against a narrower pool, then applies the
   * discount band. Order matters: search first (cheap, and it is what the user
   * just typed), band second. */
  /* The deals tab searches a narrower pool, then narrows to one band.
   *
   * Split into two steps so the band chips can count the SAME set the grid is
   * showing: counting the whole pool would promise cards that a live search
   * filters away, and that reads as a broken chip. */
  const dealSearch = useMemo(
    () =>
      isDeals
        ? filterCatalogue(dealPool, {
            category: 'All',
            query: deferredQuery,
            uncategorised: UNCATEGORISED,
          })
        : [],
    [dealPool, isDeals, deferredQuery],
  )

  /* `all` is the number of deals, not the sum of the bands — the difference is
   * exactly the deals under 10% (or with no price to compute one), which by
   * decision live only in All. Showing the numbers makes that legible instead
   * of looking like a bug. */
  const dealBucketCounts = useMemo(
    () => (isDeals ? bucketCountsOf(dealSearch) : null),
    [isDeals, dealSearch],
  )

  const filtered = useMemo(() => {
    if (isDeals) {
      if (dealBucket === 'all') return dealSearch
      /* `bucketOf` reads the number the badge prints (`discountOf`), so the
       * chip and the card can never disagree about a product. */
      return dealSearch.filter((product) => bucketOf(discountOf(product).max) === dealBucket)
    }

    return filterCatalogue(catalogue, {
      category: activeCategory,
      query: deferredQuery,
      uncategorised: UNCATEGORISED,
    })
  }, [catalogue, dealSearch, isDeals, dealBucket, activeCategory, deferredQuery])

  /* Badge first, THEN page. The order of those two steps is the whole feature:
 * slicing first would only shuffle the 24 cards already on screen, so a badged
 * style sitting at sort_order 191 would stay invisible until eight "Load more"
 * clicks — priority that nobody ever sees is not priority. Measured: three of
 * the 7 badged styles are at rank 191/194/196.
 *
 * Inside each group the order is whatever came out of the filter — i.e. the
 * admin's `sort_order` — so pinning something to the top of the storefront
 * never reshuffles the rest. See `storefrontOrder` in utils/catalogue.js:
 * badged → plain → Coming Soon → hidden, all four stable.
 *
 * Coming Soon sits third on purpose. It used to sit with the badged styles, and
 * ops reported what that looked like: a first screen of styles nobody can order
 * reads as "this shop has no stock", and the creator leaves before scrolling.
 * The first batch is now all shoppable, and a teaser is still published — it
 * shows up as you scroll, which is what a preview is for. */
const ordered = useMemo(
  () => (isDeals ? dealsOrder(filtered) : storefrontOrder(filtered)),
  [filtered, isDeals],
)

const visibleProducts = useMemo(() => slicePage(ordered, limit), [ordered, limit])

  const more = hasMore(limit, filtered.length)

  /* A new filter means a new result set: start from one batch again, and take
   * her back to the top if she had scrolled deep into the previous one. */
  useEffect(() => {
    setLimit(PAGE_SIZE)
    if (typeof window !== 'undefined' && window.scrollY > 300) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [activeCategory, query, dealBucket])

  const byId = useMemo(
    () => new Map(catalogue.map((product) => [String(product.id), product])),
    [catalogue],
  )

  /* ── cart lines for the preview drawer ── */
  const cartItems = useMemo(
    () =>
      lines
        .filter((line) => byId.has(line.productId))
        .map((line) => ({
          key: line.key,
          qty: line.qty,
          specs: line.specs,
          product: byId.get(line.productId),
        })),
    [lines, byId],
  )

  /**
   * Counts come from the visible cart, not from the raw line list. A style
   * hidden after the creator picked it must not be counted but invisible.
   */
  const visible = useMemo(() => {
    const styles = new Set(cartItems.map((item) => item.product.id)).size
    const units = cartItems.reduce((sum, item) => sum + item.qty, 0)
    return { styles, variants: cartItems.length, units }
  }, [cartItems])

  const detailLines = detailProduct ? linesFor(detailProduct.id) : []

  /**
   * Heart / action button.
   * Already in the cart → drop every variant of this product.
   * Has variants → open the sheet so colour & size get chosen deliberately.
   * One-size → add straight away.
   */
  const handleToggle = useCallback((product) => {
    if (getQty(product.id) > 0) {
      removeAll(product.id)
      showToast(`Removed ${product.name}`, 'default')
      return
    }

    /* Coming Soon: the heart must never add. For a one-size teaser there is no
     * size step to block later, so the guard has to be here as well as in the
     * sheet — opening the sheet still lets her preview the colours. */
    if (isTeaser(product)) {
      setDetailProduct(product)
      return
    }

    if (Object.keys(product.specs || {}).length > 0) {
      setDetailProduct(product)
      return
    }

    add(product, {})
    showToast(`Added ${product.name}`, 'success')
  }, [add, getQty, removeAll, showToast])

  /** Sheet: add the combination currently in the pickers */
  const handleAddFromDetail = (product, specs) => {
    add(product, specs)
    const label = Object.values(specs).filter(Boolean).join(' / ')
    showToast(label ? `Added ${product.name} · ${label}` : `Added ${product.name}`, 'success')
  }

  /** Open the sheet from the cart */
  const handleEditFromCart = (product) => {
    setCartOpen(false)
    setDetailProduct(product)
  }

  /** Build the code */
  const handleGenerate = () => {
    if (!visible.variants) return

    /* A Coming Soon line must be REMOVED, never silently dropped. The creator
     * picked it when it was available; if we just omitted it from the code she
     * would wonder why the order arrived short. Name it, block the button, and
     * let the one-tap banner in the drawer do the cleanup. */
    const teaserItems = cartItems.filter((item) => isTeaser(item.product))
    if (teaserItems.length) {
      showToast(
        `Remove the Coming Soon ${teaserItems.length === 1 ? 'item' : 'items'} before generating`,
        'error',
      )
      return
    }

    /* A sold-out line must not travel into a code. Ops would receive an order
     * nobody can fulfil, and the creator would have no idea which line caused
     * it. The button is disabled in the drawer; this is the belt to that
     * brace. */
    if (cartItems.some((item) => storefrontSoldOut(item.product, item.specs))) {
      showToast('Remove the sold-out items first', 'error')
      return
    }

    // Only lines for products the creator can actually see, and never a teaser
    // (the guard above already returned, this is the belt to that brace).
    const payloadLines = cartItems
      .filter((item) => !isTeaser(item.product))
      .filter((item) => isComplete(item.product, item.specs))
      .map((item) => ({ productId: item.product.id, qty: item.qty, specs: item.specs }))

    const { code, payload } = generateCodeFromLines(influencerRef, payloadLines)

    /* Counts are captured before the cart is emptied — the code sheet quotes
     * them, and they describe the code, not what is left on screen. */
    const summary = { styles: visible.styles, units: visible.units }

    saveRecord({
      code,
      ref: influencerRef,
      styles: summary.styles,
      units: summary.units,
      ts: payload.ts,
    })
    setCartOpen(false)
    setCodeModal({ open: true, code, ...summary })

    /* Keep the selection. Creators routinely generate a code, then spot one more
     * piece — clearing forced a second, separate code and ops had to merge the
     * two. `renew()` restarts the 7-day clock without touching the lines, so the
     * next generate includes everything picked so far. */
    renew()
  }

  /**
   * Drop every line that sold out after it was picked.
   * Bulk on purpose: she is being asked to fix a state she did not create, so
   * it has to be one tap — and the toast says what happened, because the lines
   * disappearing from the cart is otherwise unexplained.
   */
  const handleRemoveSoldOut = () => {
    const gone = cartItems.filter((item) => storefrontSoldOut(item.product, item.specs))
    if (!gone.length) return
    for (const item of gone) remove(item.key)
    showToast(
      `${gone.length} sold-out ${gone.length === 1 ? 'item' : 'items'} removed`,
      'default',
    )
  }

  /**
   * Remove every Coming Soon line — explicit, one tap, never silent.
   * The alternative (dropping them from the code quietly) would leave the cart
   * disagreeing with the code the creator just generated.
   */
  const handleRemoveTeaser = () => {
    const teasers = cartItems.filter((item) => isTeaser(item.product))
    if (!teasers.length) return
    for (const item of teasers) remove(item.key)
    showToast(
      `${teasers.length} Coming Soon ${teasers.length === 1 ? 'item' : 'items'} removed`,
      'default',
    )
  }

  /**
   * Wipe the selection.
   * The code modal is part of the state that has to go: a code generated from
   * a selection that no longer exists is worse than no code at all. The local
   * history (`mako_records_v1`) is deliberately kept — that is the log of codes
   * already sent out, not a draft.
   */
  const handleClearAll = () => {
    clearAll()
    setCodeModal({ open: false, code: '', styles: 0, units: 0 })
    showToast('Selection cleared', 'default')
  }

  return (
    <div className="min-h-screen bg-cream">
      <Header influencerName={influencerName} />

      <CategoryNav
        categories={categoryList}
        active={activeCategory}
        counts={categoryCounts}
        total={catalogue.length}
        onChange={setActiveCategory}
        query={query}
        onQueryChange={setQuery}
        dealsCount={dealPool.length}
        bucket={dealBucket}
        bucketCounts={dealBucketCounts}
        onBucketChange={setDealBucket}
      />

      {/* Bottom padding keeps the sticky bar off the last row */}
      <main className="pb-32 pt-5 sm:pb-36 sm:pt-7">
        <ProductGrid
          products={visibleProducts}
          loading={loading}
          query={deferredQuery}
          error={catalogueStatus === 'error' ? getCatalogueError() : ''}
          onRetry={() => loadProducts().catch(() => {})}
          onClearSearch={() => setQuery('')}
          linesFor={linesFor}
          amazonUrlFor={amazonUrlFor}
          onToggle={handleToggle}
          onIncrement={increment}
          onDecrement={decrement}
          onOpenDetail={setDetailProduct}
          showPrice={isDeals}
          /* 专区自己叫什么：`badgeStackFor` 用它判断"这枚角标是不是在重复
             页面标题"。只在专区里传，常规货架上 Black Friday 不是重复。 */
          campaign={isDeals ? dealsTabLabel : ''}
        />

        {/* Paging lives here, not inside the grid, so the footer below it is
            always the last thing on the page — the staff link stays reachable
            no matter how many batches have been loaded. */}
        {!loading && filtered.length > 0 && (more || deferredQuery || filtered.length > PAGE_SIZE) && (
          <div className="mx-auto mt-8 max-w-6xl px-5 text-center sm:px-8">
            {more ? (
              <>
                <button
                  type="button"
                  onClick={() => setLimit((current) => nextLimit(current, filtered.length))}
                  className="rounded-full bg-white px-6 py-2.5 text-[13px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25 active:scale-[0.97]"
                >
                  Load more
                </button>
                <p className="mt-2 text-[11px] tabular-nums text-charcoal-light" aria-live="polite">
                  Showing {visibleProducts.length} of {filtered.length}
                  {deferredQuery ? ' matches' : ' styles'}
                </p>
              </>
            ) : (
              <p className="text-[11px] tabular-nums text-charcoal-light/70" aria-live="polite">
                {deferredQuery
                  ? `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'} for “${deferredQuery.trim()}”`
                  : `That's all ${filtered.length} styles`}
              </p>
            )}
          </div>
        )}

        {!loading && (
          <footer className="mx-auto mt-14 max-w-6xl px-5 text-center sm:px-8">
            {/* 品牌使命在上面、配货声明在下面：前者是"我们为什么做这个"，后者是
               流程条款。同字号、更淡一档灰度 —— 它是全页最轻的一句，但位置在
               免责之上，因为一句使命不该排在条款后面。 */}
            <p className="text-[11px] leading-relaxed text-charcoal-light/50">
              {brandConfig.mission}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-charcoal-light/60">
              For internal order coordination only · final stock confirmed by your contact
            </p>
            {/* Staff way in — quiet by design, see StaffAccess.jsx */}
            <div className="mt-5">
              <StaffAccess />
            </div>
          </footer>
        )}
      </main>

      <BottomBar
        styles={visible.styles}
        variants={visible.variants}
        units={visible.units}
        onOpenCart={() => setCartOpen(true)}
        onGenerate={handleGenerate}
      />

      <CartDrawer
        open={cartOpen}
        items={cartItems}
        styles={visible.styles}
        variants={visible.variants}
        units={visible.units}
        onIncrement={increment}
        onDecrement={decrement}
        onRemove={remove}
        onClearAll={handleClearAll}
        onRemoveSoldOut={handleRemoveSoldOut}
        onRemoveTeaser={handleRemoveTeaser}
        onEdit={handleEditFromCart}
        onGenerate={handleGenerate}
        onClose={() => setCartOpen(false)}
      />

      <ProductDetail
        product={detailProduct}
        open={!!detailProduct}
        lines={detailLines}
        onAdd={handleAddFromDetail}
        onIncrement={increment}
        onDecrement={decrement}
        onRemove={remove}
        onClose={() => setDetailProduct(null)}
      />

      <CodeModal
        open={codeModal.open}
        code={codeModal.code}
        totalStyles={codeModal.styles}
        totalUnits={codeModal.units}
        influencerName={influencerName}
        onClose={() => setCodeModal({ open: false, code: '', styles: 0, units: 0 })}
        showToast={showToast}
      />

      <OnboardingGuide
        open={guideOpen}
        onOpen={() => setGuideOpen(true)}
        onClose={closeGuide}
      />

      <Toast toasts={toasts} />
    </div>
  )
}
