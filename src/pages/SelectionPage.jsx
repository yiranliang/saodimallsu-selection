import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react'
import Header from '../components/Header.jsx'
import { brandConfig } from '../data/products.js'
import SiteNav from '../components/SiteNav.jsx'
import ProductGrid from '../components/ProductGrid.jsx'
import ProductDetail from '../components/ProductDetail.jsx'
import FeaturedSection from '../components/FeaturedSection.jsx'
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
import { UNCATEGORISED, loadProducts, getCatalogueError, isCatalogueLight } from '../store/productStore.js'
import { amazonUrlFor, listingKnownFor } from '../store/linkStore.js'
import { useCategories } from '../hooks/useCategories.js'
import { useSettings } from '../hooks/useSettings.js'
import { isComplete } from '../utils/lines.js'
import { isSoldOut } from '../utils/soldOut.js'
import { isTeaser } from '../utils/teaser.js'
import {
  BADGE_ZONE,
  CAMPAIGN_TAB,
  DEALS_TAB,
  bucketCountsOf,
  campaignOrder,
  campaignTabLabelOf,
  cardTickDelay,
  dealPhase,
  dealsOrder,
  filterDeals,
  isCampaignDeal,
  matchesSaleFilter,
  soonestDealMs,
} from '../utils/deal.js'
import { hasSeenGuide, markGuideSeen, shouldAutoOpen } from '../utils/guide.js'
import { mulberry32, nextSeed, pickFeatured } from '../utils/featured.js'
import { storefrontOrder, filterCatalogue, slicePage, nextLimit, hasMore } from '../utils/catalogue.js'
import { pageSizeFor } from '../utils/grid.js'
import { useGridColumns } from '../hooks/useGridColumns.js'
import { useDealSlots } from '../hooks/useDealSlots.js'
import { applyDealSlots } from '../utils/dealSlots.js'
import {
  FEATURED_SIZE_DEFAULT,
  FEATURED_SIZE_MAX,
  FEATURED_SIZE_MIN,
  FEATURED_SIZE_STEP,
  FEATURED_VIEW,
  TAG_VIEW,
  clampFeaturedSize,
  buildTagIndex,
  isTagView,
  tagViewCount,
  tagViewProducts,
} from '../utils/navViews.js'

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
  /* 大促专区的名字（后台可改成 `Black Friday`）。卡片要用它去重：进了这个
   * 专区，挂"同一场活动"的标签是零信息。
   *
   * 这个名字和常规 Tab 的固定名（`Limited Deals`）撞车时退回 `Campaign Deals`
   * —— 见 `campaignTabLabelOf`：设置里那个 key 是拆分前留下的，历史值可能
   * 就是旧的默认名。 */
  const { dealsTabLabel, holidayLabel: holidayTabLabel } = useSettings()
  const campaignTabLabel = campaignTabLabelOf(dealsTabLabel)
  /* 节日专区在导航上的名字来自 settings（`holiday_label`），换季时运营自己改。 */
  const holidayLabel = holidayTabLabel || 'Holiday Picks'
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
    maxItems,
    atCap,
    totalUnits,
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
  /* SALE 的三层选择全部单选（null = 不限）：
   *   saleZone   deals / campaign          两个专区
   *   dealState  active / upcoming         常规秒杀的时间状态
   *   dealBucket 10-20 / 20-30 / …         大促的折扣档位
   * 判定集中在 utils/deal.js 的 matchesSaleFilter（传单元素数组给它）。 */
  const [saleZone, setSaleZone] = useState(null)
  /* ⚡ 常规秒杀的二级视图：全部 / 进行中 / 排期中。时间由导入时的 sale_* 决定，
   * 到了开始时间，`dealPhase` 自动把它算进 Active。 */
  const [dealState, setDealState] = useState(null)
  const [dealBucket, setDealBucket] = useState(null)
  /* 这一屏的"现在"：一个 timer 服务整屏，只有常规秒杀才会跳（见下面的 effect）。 */
  const [dealNow, setDealNow] = useState(() => Date.now())
  /* Onboarding guide. `open` is the only state: whether it *should* open first
   * is decided once, below, from localStorage + whether the grid has data. */
  const [guideOpen, setGuideOpen] = useState(false)
  /* 点 logo 也算"视图变了"：已经在 All 时状态不变，但手机上的抽屉仍要收起，
   * 所以用一个自增信号通知导航层。 */
  const [homeTick, setHomeTick] = useState(0)
  const [query, setQuery] = useState('')
  /* How many cards are on screen. Reset to one batch whenever the filter
   * changes — otherwise going Tops → All would keep the deeper limit and the
   * page would jump from 3 cards to 139. */
  /* 列数跟着窗口走，一页件数 = 24 向上取整到列数的倍数（见 utils/grid.js）：
   * 2 列 24、3 列 24、4 列 24、5 列 25、6 列 24 —— 每页都是整行，不会留半行。 */
  const gridCols = useGridColumns()
  const pageSize = pageSizeFor(gridCols)
  const [limit, setLimit] = useState(pageSize)

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

  /* 前台要整行目录：详情弹层按颜色换图靠 `variant_images`，而它只在"全量"
   * 目录里才有。如果这一页是从后台切过来的（后台拉的是轻列表），这里补一次
   * 全量 —— 否则每个颜色都只会显示主图。 */
  useEffect(() => {
    if (!isCatalogueLight()) return
    loadProducts({ silent: true, light: false }).catch(() => {})
  }, [])

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

  /* 秒杀档期：一个货号可以有多条时间窗，这里只把"此刻生效的那一档"铺到
   * 商品的 sale* 字段上 —— 下游（筛选 / 折扣 / 倒计时 / 排序）完全不用改。 */
  const dealSlots = useDealSlots()
  const productsWithSlots = useMemo(
    () => applyDealSlots(products, dealSlots, dealNow),
    [products, dealSlots, dealNow],
  )

  const catalogue = useMemo(
    () =>
      SHOW_HIDDEN_PRODUCTS
        ? productsWithSlots.slice()
        : productsWithSlots.filter((p) => !p.hidden),
    [productsWithSlots],
  )

  /* ⚡ / 🔥 两个秒杀专区 —— 同一批 `sale_*` 数据的两个切片，不是两张表。
   *
   * 切片跟着商品走：导入/批量开秒杀时运营选的归属写进 `is_campaign`
   * （13-campaign.sql）。没跑迁移的库全读成 false，于是全部落进常规 Tab ——
   * 正好等于拆分之前的行为。
   *
   * `filterDeals` 只留下进行中 + 排期中（结束的已经是普通商品了）。计数驱动
   * chip：为 0 的那个 Tab 直接不出现，所以非大促期间不会有半个空专区挂着。 */
  const dealPool = useMemo(() => filterDeals(catalogue), [catalogue])
  const isDeals = activeCategory === DEALS_TAB
  const isCampaign = activeCategory === CAMPAIGN_TAB
  const inDealsView = isDeals || isCampaign

  const regularPool = useMemo(
    () => dealPool.filter((product) => !isCampaignDeal(product, campaignTabLabel)),
    [dealPool, campaignTabLabel],
  )
  const campaignPool = useMemo(
    () => dealPool.filter((product) => isCampaignDeal(product, campaignTabLabel)),
    [dealPool, campaignTabLabel],
  )

  /**
   * Align a restored selection with the catalogue.
   * This is what removes a colour the admin deleted while the tab was open —
   * without it the cart keeps offering a variant that no longer exists.
   */
  useEffect(() => {
    reconcile(products)
  }, [products, reconcile])

  /* ── 标签视图（New / Bestseller / Holiday Picks）──
   *
   * 一次遍历建索引，之后切视图只做 Set.has —— 搜索框每敲一个字都不会重新切词。
   * `catalogue` 每次刷新都是新数组（realtime / 后台编辑 / 首载），所以后台改完
   * 标签后索引自然失效重算，不需要手动 invalidate。 */
  const tagIndex = useMemo(() => buildTagIndex(catalogue), [catalogue])

  /* 导航上的数字按**整本目录**算（含隐藏商品）：运营刚打完标签、还没点"显示"
   * 的时候，入口也应该出现 —— 否则她会以为标签没存进去。筛选与网格仍然只看
   * 已发布的商品（`tagIndex` 用的是 `catalogue`）。 */
  const navTagIndex = useMemo(() => buildTagIndex(products), [products])
  const tagCounts = useMemo(
    () => ({
      [TAG_VIEW.NEW]: tagViewCount(navTagIndex, TAG_VIEW.NEW),
      [TAG_VIEW.BESTSELLER]: tagViewCount(navTagIndex, TAG_VIEW.BESTSELLER),
      [TAG_VIEW.HOLIDAY]: tagViewCount(navTagIndex, TAG_VIEW.HOLIDAY),
    }),
    [navTagIndex],
  )

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
    /* 只列出**真的有商品**的分类：某分类在后台存在、但商品全被删/全隐藏时，
     * 前台不该留一个点进去是空的入口（`categoryCounts` 已经按可见目录算过，
     * 这里再挡一道 0，防御将来有人改了上面那段）。 */
    return Object.keys(categoryCounts)
      .filter((name) => (categoryCounts[name] || 0) > 0)
      .sort((a, b) => rank(a) - rank(b))
  }, [categoryCounts, categoryOrder])

  /** 所有入口都是单选：换视图 = 换 activeCategory。 */
  const handleViewChange = (value) => {
    setActiveCategory(value)
    /* 进 SALE 时把专区收敛到点击的那一个，否则"两个专区都给"会让
     * Limited Deals 和大促混在同一屏里。 */
    if (value === DEALS_TAB) setSaleZone('deals')
    else if (value === CAMPAIGN_TAB) setSaleZone('campaign')
  }

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

  /* ── 首页推荐位（Featured for You）──
   * 24 件，纯前端采样（见 utils/featured.js）：**整库洗牌取前 24 件**，不按
   * 分类保底 —— 分类加权会让推荐位在几次 Shuffle 之后变得可预测。**只读目录**，
   * 不碰 `sort_order`，所以下方网格的顺序仍然完全由后台拖拽决定。
   *
   * 只在 All + 没搜索 + 不在秒杀专区时出现：搜索时她要的是结果，不是又一次
   * 随机；专区里已经按紧迫度 / 折扣排好了，再叠一层推荐会互相打架。
   *
   * 种子在挂载时取一次，之后只有「Shuffle」按钮会换：同一次访问里滚动、加购、
   * 改数量都不会让推荐位重洗 —— 那些操作每变一次就重排一次卡片，等于让她
   * 找不到刚看到的那件。换种子是纯本地状态更新，不触发任何请求。 */
  const [featuredSeed, setFeaturedSeed] = useState(() => Math.floor(Math.random() * 0x7fffffff))
  /* 滑块数量：记在 localStorage，下次打开还是她上次的偏好。 */
  const [featuredSize, setFeaturedSize] = useState(() => {
    try {
      return clampFeaturedSize(localStorage.getItem('sdm-featured-size'))
    } catch {
      return FEATURED_SIZE_DEFAULT
    }
  })
  const changeFeaturedSize = (value) => {
    const next = clampFeaturedSize(value)
    setFeaturedSize(next)
    try {
      localStorage.setItem('sdm-featured-size', String(next))
    } catch {
      /* 隐私模式：不记住，但本次仍然生效 */
    }
  }
  /* 顶栏不再显示"筛选胶囊"：选中状态由菜单里的勾选框表达，
   * 手机上由抽屉底部的"清空筛选"兜底。 */

  const isFeaturedView = activeCategory === FEATURED_VIEW
  /* 推荐位只在自己的 INSPO 视图里出现：All products 就是纯货架，不再插随机块。 */
  const showFeatured = isFeaturedView && !deferredQuery.trim() && !inDealsView
  const featured = useMemo(
    () => (showFeatured ? pickFeatured(catalogue, { size: featuredSize, random: mulberry32(featuredSeed) }) : []),
    [showFeatured, catalogue, featuredSeed, featuredSize],
  )
  const shuffleFeatured = useCallback(() => {
    setFeaturedSeed((prev) => nextSeed(prev))
  }, [])

  /* 常规秒杀按时间分成两档：进行中 / 排期中。同一份 `sale_start` / `sale_end`，
   * 只是读的时刻不同 —— 所以导入时不用选状态，时间到了自己会从 Upcoming 挪进
   * Active（`dealPhase` 就是前台卡片判断 Live/Scheduled 用的那个函数）。 */
  /* 专区单选：null = 两个都给（进入 SALE 时由点击的专区决定）。 */
  const saleZonePool = useMemo(
    () =>
      dealPool.filter((product) =>
        matchesSaleFilter(product, {
          zones: saleZone ? [saleZone] : [],
          campaign: campaignTabLabel,
          now: dealNow,
        }),
      ),
    [dealPool, saleZone, campaignTabLabel, dealNow],
  )

  /* 常规秒杀按时间分成两档：进行中 / 排期中。时间由导入时的 `sale_*` 决定，
   * 到了开始时间自己从 Upcoming 挪进 Active（`dealPhase` 就是卡片判断用的那个）。 */
  const regularLive = useMemo(
    () => regularPool.filter((product) => dealPhase(product, dealNow) === 'live'),
    [regularPool, dealNow],
  )
  const regularUpcoming = useMemo(
    () => regularPool.filter((product) => dealPhase(product, dealNow) === 'scheduled'),
    [regularPool, dealNow],
  )
  const dealStateCounts = useMemo(
    () => ({
      all: regularPool.length,
      active: regularLive.length,
      upcoming: regularUpcoming.length,
    }),
    [regularPool, regularLive, regularUpcoming],
  )

  /* Filter once, page after — the slice is always the last step, so "load more"
   * keeps counting inside the current category + search, never the whole
   * catalogue. See utils/catalogue.js. */
  /* The deals tabs search their own pool first, then (campaign only) narrow to a
   * band. Split into two steps so the band chips count the SAME set the grid is
   * showing: counting the whole pool would promise cards that a live search
   * filters away, and that reads as a broken chip. */
  const dealSearch = useMemo(
    () =>
      inDealsView
        ? filterCatalogue(saleZonePool, {
            category: 'All',
            query: deferredQuery,
            uncategorised: UNCATEGORISED,
          })
        : [],
    [saleZonePool, inDealsView, deferredQuery],
  )

  /* `all` is the number of deals in this view, not the sum of the bands — the
   * difference is exactly the deals under 10% (or with no price to compute one),
   * which by decision live only in All. Showing the numbers makes that legible
   * instead of looking like a bug. */
  const dealBucketCounts = useMemo(
    () =>
      inDealsView
        ? bucketCountsOf(dealSearch.filter((product) => isCampaignDeal(product, campaignTabLabel)))
        : null,
    [inDealsView, dealSearch, campaignTabLabel],
  )

  const filtered = useMemo(() => {
    if (inDealsView) {
      /* 状态（常规）和档位（大促）叠在专区之上；空数组 = 不限。 */
      return dealSearch.filter((product) =>
        matchesSaleFilter(product, {
          states: dealState && dealState !== 'all' ? [dealState] : [],
          buckets: dealBucket && dealBucket !== 'all' ? [dealBucket] : [],
          campaign: campaignTabLabel,
          now: dealNow,
        }),
      )
    }


    /* New / Bestseller / Holiday Picks：纯前端标签过滤，不发请求。 */
    if (isTagView(activeCategory)) {
      return filterCatalogue(tagViewProducts(catalogue, activeCategory, tagIndex), {
        category: 'All',
        query: deferredQuery,
        uncategorised: UNCATEGORISED,
      })
    }

    return filterCatalogue(catalogue, {
      category: activeCategory,
      query: deferredQuery,
      uncategorised: UNCATEGORISED,
    })
  }, [
    catalogue,
    tagIndex,
    dealSearch,
    inDealsView,
    dealState,
    dealBucket,
    campaignTabLabel,
    dealNow,
    activeCategory,
    deferredQuery,
  ])

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
  () =>
    isCampaign
      ? /* 🔥 大促：折扣从高到低，时间在这里没有意义。 */
        campaignOrder(filtered)
      : isDeals
        ? /* ⚡ 常规：紧迫度（进行中 → 排期中），和拆分之前一致。 */
          dealsOrder(filtered)
        : storefrontOrder(filtered),
  [filtered, isCampaign, isDeals],
)

const visibleProducts = useMemo(() => slicePage(ordered, limit), [ordered, limit])

  const more = hasMore(limit, filtered.length, pageSize)

  /* 常规秒杀卡片的倒计时：一个 timer 服务整屏，间隔由"最快结束/开始的那件"
   * 决定（一小时内每秒跳、之外半分钟一次）。只有这一屏才转 —— 别的面不传
   * `now`，卡片就不会因为时间流逝而重渲染。 */
  useEffect(() => {
    if (!isDeals) return undefined
    let timer = 0
    const tick = () => {
      const at = Date.now()
      setDealNow(at)
      timer = setTimeout(tick, cardTickDelay(soonestDealMs(regularPool, at)))
    }
    timer = setTimeout(tick, cardTickDelay(soonestDealMs(regularPool, Date.now())))
    return () => clearTimeout(timer)
  }, [isDeals, regularPool])

  /* A new filter means a new result set: start from one batch again, and take
   * her back to the top if she had scrolled deep into the previous one. */
  useEffect(() => {
    setLimit(pageSize)
    if (typeof window !== 'undefined' && window.scrollY > 300) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [activeCategory, query, dealState, dealBucket, saleZone, pageSize])

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

    /* 件数上限（`MAX_CART_ITEMS`）：整单加不进去就明说，不静默吞掉这次点击。 */
    if (atCap) {
      showToast(`Maximum ${maxItems} items allowed per selection.`, 'error', 3500)
      return
    }

    add(product, {})
    showToast(`Added ${product.name}`, 'success')
  }, [add, atCap, getQty, maxItems, removeAll, showToast])

  /** Sheet: add the combination currently in the pickers */
  const handleAddFromDetail = (product, specs) => {
    /* 详情页是加购的主入口，所以拦截也在这里：到上限就只弹提示，不写状态。 */
    if (atCap) {
      showToast(`Maximum ${maxItems} items allowed per selection.`, 'error', 3500)
      return
    }
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
      {/* 顶栏：Logo + 菜单 + 搜索同一行，滚动时整条吸顶；Hero 在它下面滚走。 */}
      <Header
        influencerName={influencerName}
        onHome={() => {
          setActiveCategory('All')
          setHomeTick((tick) => tick + 1)
        }}
      >
        <SiteNav
          categories={categoryList}
          categoryCounts={categoryCounts}
          active={activeCategory}
          total={catalogue.length}
          onChange={handleViewChange}
          query={query}
          onQueryChange={setQuery}
          dealsCount={regularPool.length}
          campaignCount={campaignPool.length}
          campaignLabel={campaignTabLabel}
          tagCounts={tagCounts}
          bucketCounts={dealBucketCounts}
          dealStateCounts={dealStateCounts}
          saleZone={saleZone}
          dealState={dealState}
          dealBucket={dealBucket}
          onPickDealState={(id) => {
            setDealState(id === 'all' ? null : id)
            setSaleZone('deals')
          }}
          onPickDealBucket={(id) => {
            setDealBucket(id === 'all' ? null : id)
            setSaleZone('campaign')
          }}
          homeTick={homeTick}
          holidayLabel={holidayLabel}
        />
      </Header>

      {/* Bottom padding keeps the sticky bar off the last row */}
      <main className="pb-32 pt-5 sm:pb-36 sm:pt-7">
        {/* 推荐位：只在 All + 无搜索时出现在网格上方，下方目录顺序不受影响。 */}
        {showFeatured && (
          <FeaturedSection
            products={featured}
            seed={featuredSeed}
            size={featuredSize}
            onSizeChange={changeFeaturedSize}
            sizeMin={FEATURED_SIZE_MIN}
            sizeMax={FEATURED_SIZE_MAX}
            sizeStep={FEATURED_SIZE_STEP}
            onShuffle={shuffleFeatured}
            showDivider={!isFeaturedView}
            linesFor={linesFor}
            amazonUrlFor={amazonUrlFor}
            onToggle={handleToggle}
            onIncrement={increment}
            onDecrement={decrement}
            onOpenDetail={setDetailProduct}
            atCap={atCap}
          />
        )}

        {/* Featured 是独立视图：只显示推荐位，下面不再接常规目录。 */}
        {!isFeaturedView && (
        <ProductGrid
          pageSize={pageSize}
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
          /* 这张网格在哪个面上：决定价格行和倒计时。
             卡片上的标签**不再看这个**：按 Lululemon 的做法，图片左上角只挂
             运营手填的属性标（Bestseller / New），大促和秒杀身份一律不上图
             （见 `trustBadgeFor`）。`zone` 仍然传给卡片，用于价格行。 */
          zone={
            isCampaign
              ? BADGE_ZONE.CAMPAIGN
              : isDeals
                ? BADGE_ZONE.REGULAR
                : BADGE_ZONE.CATALOGUE
          }
          /* 只有常规秒杀那屏需要跟着时钟走。 */
          now={isDeals ? dealNow : undefined}
          /* 大促专区的名字：`trustBadgeFor` 用它比对**自定义**活动名，避免
             运营把 `Spring Refresh` 这类名字填进 tag 之后又被当成属性标显示。
             词表认得的 Black Friday / Cyber Monday 不用它也摘得掉。 */
          campaign={isCampaign ? campaignTabLabel : ''}
          atCap={atCap}
        />
        )}

        {/* Paging lives here, not inside the grid, so the footer below it is
            always the last thing on the page — the staff link stays reachable
            no matter how many batches have been loaded. */}
        {!isFeaturedView && !loading && filtered.length > 0 && (more || deferredQuery || filtered.length > pageSize) && (
          <div className="mt-8 w-full px-5 text-center sm:px-8">
            {more ? (
              <>
                <button
                  type="button"
                  onClick={() => setLimit((current) => nextLimit(current, filtered.length, pageSize))}
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
          <footer className="mt-14 w-full px-5 text-center sm:px-8">
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
        maxItems={maxItems}
        atCap={atCap}
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
        atCap={atCap}
        maxItems={maxItems}
        /* 从 🔥 大促专区点开的详情页，活动身份同样不挂（见 badgeStackFor
           ／ ProductDetail 的注释）。弹层打开时分类栏被遮住，所以当前 tab
           就是它被点开时的 tab。 */
        inCampaign={isCampaign}
        campaign={isCampaign ? campaignTabLabel : ''}
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
