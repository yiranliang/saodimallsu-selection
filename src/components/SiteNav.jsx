import { useEffect, useRef, useState } from 'react'
import SearchBox from './SearchBox.jsx'
import { Close, Search } from './icons.jsx'
import { CAMPAIGN_TAB, DEALS_TAB, DEAL_BUCKETS, REGULAR_DEALS_LABEL } from '../utils/deal.js'
import { FEATURED_VIEW, HOLIDAY_TAB_DEFAULT_LABEL, MULTI_CATS, TAG_VIEW } from '../utils/navViews.js'

/**
 * Site navigation
 * ───────────────
 * 顶部唯一的筛选入口：`Sale · Shop · New · Bestseller · Holiday Picks`。
 *
 * **它不是一个独立的吸顶条**：它渲染在 `Header` 的顶栏里（和 Logo 同一行），
 * 所以滚动时整条顶栏一起吸顶 —— 菜单和搜索永远在手边。
 *
 * 两级菜单：
 *   Sale  ── Limited Deals
 *         └ Black Friday ── All deals / 10–20% / 20–30% / 30–40% / 40%+
 *   Shop  ── All products / Tops / Bottoms …
 * 折扣档位是**大促的子级**，不再单独占一行横条 —— 它只在那场活动里才有意义。
 *
 * 所有筛选都是纯前端：`Sale` 复用秒杀区、`Shop` 复用 `category`、
 * `New / Bestseller / Holiday` 走 `utils/navViews.js` 建的标签索引。
 */

/** 三个标签入口。节日那枚的名字来自 settings（`holiday_label`），
 *  换季时运营在后台改一次就够，不用发版 —— 见 `utils/settingsStore.js`。 */
function tagItemsOf(holidayLabel) {
  return [
    { value: TAG_VIEW.NEW, label: 'New' },
    { value: TAG_VIEW.BESTSELLER, label: 'Bestseller' },
    { value: TAG_VIEW.HOLIDAY, label: holidayLabel || HOLIDAY_TAB_DEFAULT_LABEL },
  ]
}

const BUCKET_OPTIONS = [{ id: 'all', label: 'All deals' }, ...DEAL_BUCKETS]

/** ⚡ 常规秒杀的二级目录。时间到了自动从 Upcoming 进 Active（见 dealPhase）。 */
const DEAL_STATES = [
  { id: 'all', label: 'All deals' },
  { id: 'active', label: 'Active now' },
  { id: 'upcoming', label: 'Upcoming' },
]

export default function SiteNav({
  categories = [],
  categoryCounts = {},
  active,
  onChange,
  total = 0,
  query = '',
  onQueryChange,
  dealsCount = 0,
  campaignCount = 0,
  campaignLabel = '',
  tagCounts = {},
  bucketCounts = null,
  dealStateCounts = null,
  /* SALE 的三个多选维度（空数组 = 不限）：专区、档位、状态。 */
  saleZones = [],
  dealStates = [],
  dealBuckets = [],
  onToggleZone,
  onToggleDealState,
  onToggleDealBucket,
  /* 手机：单个专区 / 单个分类（不做多选），选完抽屉直接收起。 */
  onPickZone,
  onPickCategory,
  /* 当前生效的"窄化筛选"（某个分类 / 某个标签视图）。空串 = 没筛选，不占位。 */
  /* 已选中的分类（多选）。空数组 = All products。 */
  selectedCats = [],
  onToggleCategory,
  /* 节日专区在导航上的名字（settings.holidayLabel）。 */
  holidayLabel = HOLIDAY_TAB_DEFAULT_LABEL,
}) {
  const TAG_ITEMS = tagItemsOf(holidayLabel)
  const [openMenu, setOpenMenu] = useState(null) // 'sale' | 'shop' | null
  const [openSub, setOpenSub] = useState(null) // 'deals' | 'campaign' | null
  const menuRootRef = useRef(null)
  const [drawer, setDrawer] = useState(false)
  const [mobileSearch, setMobileSearch] = useState(false)

  useEffect(() => {
    if (!drawer && !openMenu) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setDrawer(false)
      setOpenMenu(null)
      setOpenSub(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawer, openMenu])

  const closeAll = () => {
    setOpenMenu(null)
    setOpenSub(null)
    setDrawer(false)
    setMobileSearch(false)
  }

  /* 菜单只在**点击外部**时收起：悬停进菜单、移到二级面板、点选项都不会关；
   * 这样 Shop 里可以连续勾多个分类。Esc 仍然关（见上面那个 effect）。 */
  useEffect(() => {
    if (!openMenu) return undefined
    const onPointerDown = (event) => {
      if (menuRootRef.current?.contains(event.target)) return
      setOpenMenu(null)
      setOpenSub(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openMenu])

  const select = (value) => {
    onChange?.(value)
    closeAll()
  }

  /* 选折扣档位 = 进大促视图 + 切档。两个动作一起做，运营不用先点 Black Friday
   * 再点档位。 */
  /* 三个多选维度都**不关菜单**：一次悬停就能连勾几个。 */
  const zoneOn = (zone) => saleZones.length === 0 || saleZones.includes(zone)
  const toggleZone = (zone) => onToggleZone?.(zone)
  const toggleState = (id) => onToggleDealState?.(id)
  const toggleBucket = (id) => onToggleDealBucket?.(id)

  const hasCampaign = campaignCount > 0
  /* 没有商品的标签入口直接不显示：留一个点进去是 0 件的菜单项，
   * 只会让人以为筛选坏了（和当年秒杀 chip 的处理一样）。 */
  const visibleTags = TAG_ITEMS.filter((item) => (tagCounts[item.value] || 0) > 0)
  const campaignName = campaignLabel || 'Campaign'
  const shopItems = [
    { value: 'All', label: 'All products', count: total },
    ...categories.map((category) => ({
      value: category,
      label: category,
      count: categoryCounts[category] || 0,
    })),
  ]

  /* Sale 有多个子项（Limited Deals / 大促）。点 Sale 本身 = 进第一个**有商品**
   * 的；LD 空着的时候就不会落到一个 0 件的空页上。全空才只是展开菜单。 */
  const firstSaleWithItems = [
    { value: DEALS_TAB, count: dealsCount },
    { value: CAMPAIGN_TAB, count: campaignCount },
  ].find((item) => item.count > 0)

  const isActive = (value) => active === value
  /* SHOP 什么时候带下划线：多选、单选分类（`active` 是分类名）、或者正处于
   * "多选视图"哨兵值上 —— 三种都算"我在 Shop 里"。 */
  const shopActive =
    selectedCats.length > 0 ||
    active === MULTI_CATS ||
    categories.includes(active)
  const saleActive = active === DEALS_TAB || active === CAMPAIGN_TAB

  /* 悬停/选中时文字下面多一条 2px 横线（不是只有颜色变化）。
   * 用 underline + offset 而不是 border-bottom：不会改变按钮高度，也就不会
   * 在鼠标划过时让整排菜单上下跳 2px。 */
  const menuClass = (on, accent = false) =>
    `inline-flex items-center gap-1 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors ${
      accent
        ? on
          ? 'text-red-700 underline decoration-2 underline-offset-[10px]'
          : 'text-red-600 hover:text-red-700 hover:underline hover:decoration-2 hover:underline-offset-[10px]'
        : on
          ? 'text-charcoal underline decoration-2 underline-offset-[10px]'
          : 'text-charcoal-light hover:text-charcoal hover:underline hover:decoration-2 hover:underline-offset-[10px]'
    }`

  const rowClass = (on) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] transition ${
      on ? 'bg-cream-dark font-medium text-charcoal' : 'text-charcoal/75 hover:bg-cream-dark/60'
    }`

  const countOf = (n) => (
    <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">{n}</span>
  )


  const Check = ({ on }) => (
    <span
      aria-hidden="true"
      className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] text-[8px] ring-1 ${
        on ? 'bg-charcoal text-cream ring-charcoal' : 'ring-charcoal/25'
      }`}
    >
      {on ? '✓' : ''}
    </span>
  )
  return (
    <>
      {/* ── 桌面：横排菜单 ── */}
      <div ref={menuRootRef} className="hidden min-w-0 flex-1 items-center gap-5 lg:flex xl:gap-7">
        <div
          className="relative"
          onMouseEnter={() => setOpenMenu('sale')}
        >
          <button
            type="button"
            onClick={() => {
              if (firstSaleWithItems) select(firstSaleWithItems.value)
              else setOpenMenu('sale')
            }}
            onMouseEnter={() => setOpenMenu('sale')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'sale'}
            className={menuClass(saleActive, true)}
          >
            Sale
          </button>
          {openMenu === 'sale' && (
            <div className="absolute left-0 top-full z-40 w-64 pt-1">
              <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                {dealsCount > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => toggleZone('deals')}
                      onMouseEnter={() => setOpenSub('deals')}
                      onFocus={() => setOpenSub('deals')}
                      aria-pressed={zoneOn('deals')}
                      className={rowClass(zoneOn('deals'))}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Check on={zoneOn('deals')} />
                        <span className="truncate">{REGULAR_DEALS_LABEL}</span>
                      </span>
                      {countOf(dealsCount)}
                    </button>

                    {openSub === 'deals' && (
                      <div className="absolute left-full top-0 z-40 ml-1 w-44">
                        <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                          {DEAL_STATES.map((option) => {
                            const on = dealStates.includes(option.id)
                            const count =
                              option.id === 'all' ? dealsCount : dealStateCounts?.[option.id]
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                          toggleState(option.id)
                          closeAll()
                        }}
                                aria-pressed={on}
                                className={rowClass(on)}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <Check on={on} />
                                  <span className="truncate">{option.label}</span>
                                </span>
                                {Number.isFinite(count) ? (
                                  countOf(count)
                                ) : (
                                  <span className="text-[9px] text-charcoal-light/30">–</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {hasCampaign && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => toggleZone('campaign')}
                      onMouseEnter={() => setOpenSub('campaign')}
                      onFocus={() => setOpenSub('campaign')}
                      aria-pressed={zoneOn('campaign')}
                      className={rowClass(zoneOn('campaign'))}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Check on={zoneOn('campaign')} />
                        <span className="truncate">{campaignName}</span>
                      </span>
                      {countOf(campaignCount)}
                    </button>

                    {openSub === 'campaign' && (
                      <div className="absolute left-full top-0 z-40 ml-1 w-44">
                        <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                          {BUCKET_OPTIONS.map((option) => {
                            const on =
                              option.id === 'all'
                                ? dealBuckets.length === 0
                                : dealBuckets.includes(option.id)
                            const count =
                              option.id === 'all' ? campaignCount : bucketCounts?.[option.id]
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                          toggleBucket(option.id)
                          closeAll()
                        }}
                                aria-pressed={on}
                                className={rowClass(on)}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <Check on={on} />
                                  <span className="truncate">{option.label}</span>
                                </span>
                                {Number.isFinite(count) ? (
                                  countOf(count)
                                ) : (
                                  <span className="text-[9px] text-charcoal-light/30">–</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className="relative"
          onMouseEnter={() => setOpenMenu('shop')}
          /* 悬停在 SHOP 或菜单里 → 一直开着；移到别处 → 自动消失。
           * 面板是这里的子节点，所以"从按钮移到面板"不会触发 mouseleave。 */
          onMouseLeave={() => {
            setOpenMenu(null)
            setOpenSub(null)
          }}
        >
          <button
            type="button"
            onClick={() => {
              /* 点 Shop = 回到 All products（清掉多选），并**直接收起菜单** ——
               * 用户已经点完了，没有理由让面板继续挂着。
               * 想看分类就悬停（桌面），触摸设备走汉堡抽屉。 */
              select('All')
            }}
            onMouseEnter={() => setOpenMenu('shop')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'shop'}
            className={menuClass(shopActive)}
          >
            Shop
          </button>
          {openMenu === 'shop' && (
            <div className="absolute left-0 top-full z-40 w-[min(74rem,96vw)] pt-1">
              <div className="rounded-xl bg-white p-3 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                <div className="grid grid-cols-4 gap-x-2 gap-y-1 p-1 xl:grid-cols-5 2xl:grid-cols-6">
                  {shopItems.map((item) => {
                    const on = item.value === 'All'
                      ? selectedCats.length === 0
                      : selectedCats.includes(item.value)
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          /* All products = "就看全部"，点完菜单收起；
                           * 具体分类 = 可能还要再勾几个，菜单**保持打开**，
                           * 一次悬停就能连续多选。 */
                          if (item.value === 'All') {
                            select('All')
                          } else {
                            onToggleCategory?.(item.value)
                          }
                        }}
                        aria-pressed={on}
                        className={rowClass(on)}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] text-[8px] ring-1 ${
                              on ? 'bg-charcoal text-cream ring-charcoal' : 'ring-charcoal/25'
                            }`}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span className="min-w-0 break-words leading-snug">{item.label}</span>
                        </span>
                        {countOf(item.count)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 推荐位自己一个入口：内容随机生成，后台不需要编辑。 */}
        <button
          type="button"
          onClick={() => select(FEATURED_VIEW)}
          aria-pressed={active === FEATURED_VIEW}
          className={menuClass(active === FEATURED_VIEW)}
        >
          INSPO
        </button>

        {visibleTags.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => select(item.value)}
            aria-pressed={isActive(item.value)}
            className={menuClass(isActive(item.value))}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ── 桌面：搜索框在右侧 ── */}
      <div className="hidden w-[220px] shrink-0 lg:block xl:w-[260px]">
        <SearchBox value={query} onChange={onQueryChange} />
      </div>

      {/* ── 手机：只要搜索 + 汉堡（当前视图不再用文字占位） ── */}
      <div className="ml-auto flex items-center gap-1 lg:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileSearch((open) => !open)
            setDrawer(false)
          }}
          aria-label={mobileSearch ? 'Close search' : 'Search'}
          aria-expanded={mobileSearch}
          className="flex h-9 w-9 items-center justify-center rounded-full text-charcoal transition hover:bg-cream-dark"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDrawer((open) => !open)
            setMobileSearch(false)
          }}
          aria-label={drawer ? 'Close menu' : 'Open menu'}
          aria-expanded={drawer}
          className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-charcoal transition hover:bg-cream-dark"
        >
          {drawer ? (
            <Close className="h-4 w-4" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {/* ── 手机抽屉 ── */}
      {/* 抽屉常驻挂载、用 max-height 做开合过渡 —— 条件渲染会让它"啪"地
          消失，来不及看清自己点了哪一项。 */}
      <div
        aria-hidden={!drawer}
        className={`absolute inset-x-0 top-full z-50 overflow-y-auto border-t border-charcoal/[0.08] bg-cream shadow-xl shadow-charcoal/10 transition-[max-height,opacity] duration-200 ease-out lg:hidden ${
          drawer ? 'max-h-[75vh] opacity-100' : 'pointer-events-none max-h-0 opacity-0'
        }`}
      >
          <div className="px-5 pb-6 pt-3">
            <DrawerGroup title="Sale">
              {dealsCount > 0 && (
                <DrawerItem
                  label={REGULAR_DEALS_LABEL}
                  count={dealsCount}
                  active={saleZones.includes('deals') || saleZones.length === 0}
                  onClick={() => {
                    onPickZone?.('deals')
                    closeAll()
                  }}
                />
              )}
              {dealsCount > 0 && (
                <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                  {DEAL_STATES.map((option) => {
                    const on = dealStates.includes(option.id)
                    const count = option.id === 'all' ? dealsCount : dealStateCounts?.[option.id]
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          toggleState(option.id)
                          closeAll()
                        }}
                        aria-pressed={on}
                        className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-[12px] transition ${
                          on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Check on={on} />
                          <span className="truncate">{option.label}</span>
                        </span>
                        <span className="text-[10px] tabular-nums text-charcoal-light/50">
                          {Number.isFinite(count) ? count : '–'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {hasCampaign && (
                <DrawerItem
                  label={campaignName}
                  count={campaignCount}
                  active={zoneOn('campaign')}
                  onClick={() => toggleZone('campaign')}
                />
              )}
              {hasCampaign && (
                <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                  {BUCKET_OPTIONS.map((option) => {
                    const on =
                      option.id === 'all'
                        ? dealBuckets.length === 0
                        : dealBuckets.includes(option.id)
                    const count = option.id === 'all' ? campaignCount : bucketCounts?.[option.id]
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          toggleBucket(option.id)
                          closeAll()
                        }}
                        aria-pressed={on}
                        className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-[12px] transition ${
                          on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Check on={on} />
                          <span className="truncate">{option.label}</span>
                        </span>
                        <span className="text-[10px] tabular-nums text-charcoal-light/50">
                          {Number.isFinite(count) ? count : '–'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </DrawerGroup>

            <DrawerGroup title="Shop">
              {shopItems.map((item) => {
                const on =
                  item.value === 'All'
                    ? selectedCats.length === 0 && active === 'All'
                    : selectedCats.includes(item.value) || active === item.value
                return (
                  <DrawerItem
                    key={item.value}
                    label={item.label}
                    count={item.count}
                    active={on}
                    onClick={() => onPickCategory?.(item.value)}
                  />
                )
              })}
            </DrawerGroup>

            <DrawerGroup title="Curated">
              <DrawerItem
                label="INSPO"
                count={total}
                active={active === FEATURED_VIEW}
                onClick={() => select(FEATURED_VIEW)}
              />

              {visibleTags.map((item) => (
                <DrawerItem
                  key={item.value}
                  label={item.label}
                  count={tagCounts[item.value] || 0}
                  active={isActive(item.value)}
                  onClick={() => select(item.value)}
                />
              ))}
            </DrawerGroup>

            {(selectedCats.length > 0 || active !== 'All') && (
              <button
                type="button"
                onClick={() => select('All')}
                className="mt-4 w-full rounded-full bg-cream-dark py-3 text-[12.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
              >
                {selectedCats.length > 1
                  ? `Clear filters · ${selectedCats.length} selected`
                  : 'Clear filters'}
              </button>
            )}
          </div>
      </div>
    </>
  )
}

function DrawerGroup({ title, children }) {
  return (
    <div className="mt-3 first:mt-1">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-charcoal-light/70">
        {title}
      </div>
      <div className="mt-1 flex flex-col">{children}</div>
    </div>
  )
}

function DrawerItem({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-between gap-2 border-b border-charcoal/[0.05] py-2.5 text-left text-[13px] transition last:border-b-0 ${
        active ? 'font-medium text-charcoal' : 'text-charcoal/75'
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-[10.5px] tabular-nums text-charcoal-light/60">{count}</span>
        {/* 复选框：手机上唯一能看出"我选了哪些"的地方。 */}
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 items-center justify-center rounded-[3px] text-[9px] ring-1 ${
            active ? 'bg-charcoal text-cream ring-charcoal' : 'ring-charcoal/25'
          }`}
        >
          {active ? '✓' : ''}
        </span>
      </span>
    </button>
  )
}
