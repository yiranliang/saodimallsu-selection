import { useEffect, useRef, useState } from 'react'
import SearchBox from './SearchBox.jsx'
import { Close, Search } from './icons.jsx'
import { CAMPAIGN_TAB, DEALS_TAB, DEAL_BUCKETS, REGULAR_DEALS_LABEL } from '../utils/deal.js'
import { FEATURED_VIEW, HOLIDAY_TAB_DEFAULT_LABEL, TAG_VIEW } from '../utils/navViews.js'

/**
 * Site navigation
 * ───────────────
 * 顶部唯一的筛选入口：`Sale · Shop · INSPO · New · Bestseller · Holiday`。
 * 它渲染在 `Header` 的顶栏里（和 Logo 同一行），所以滚动时整条顶栏一起吸顶。
 *
 * 单选，不是多选
 * ──────────────
 * 每一层都只有一个选中值：
 *
 *   Sale  ── Limited Deals   ── All deals / Active now / Upcoming
 *         └ Black Friday     ── All deals / 10-20% / 20-30% / 30-40% / 40%+
 *   Shop  ── All products / Tops / Bottoms …
 *
 * 点一个新的就替换旧的，菜单随即收起。多选会让"我现在到底在看什么"变得模糊，
 * 而运营的描述一直是"我要看这一档"。
 */

/* 三个标签入口。节日那枚的名字来自 settings（`holiday_label`），换季时运营
 * 在后台改一次就够 —— 所以这里不能写死 "Holiday Picks"。 */
function tagItemsOf(holidayLabel) {
  return [
    { value: TAG_VIEW.NEW, label: 'New' },
    { value: TAG_VIEW.BESTSELLER, label: 'Bestseller' },
    { value: TAG_VIEW.HOLIDAY, label: holidayLabel || HOLIDAY_TAB_DEFAULT_LABEL },
  ]
}

const BUCKET_OPTIONS = [{ id: 'all', label: 'All deals' }, ...DEAL_BUCKETS]
const STATE_OPTIONS = [
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
  saleZone = null,
  dealState = null,
  dealBucket = null,
  onPickDealState,
  onPickDealBucket,
  holidayLabel = HOLIDAY_TAB_DEFAULT_LABEL,
  homeTick = 0,
}) {
  const [openMenu, setOpenMenu] = useState(null) // 'sale' | 'shop' | null
  const [openSub, setOpenSub] = useState(null) // 'deals' | 'campaign' | null
  const [drawer, setDrawer] = useState(false)
  const [mobileSearch, setMobileSearch] = useState(false)
  const menuRootRef = useRef(null)

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

  /* 点菜单外面才收起（悬停在菜单里怎么移都不关，见下面的 onMouseLeave）。 */
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

  /* 视图一变就收起菜单：点 logo、点分类、点 INSPO…… 都算"点好了"。 */
  useEffect(() => {
    setDrawer(false)
    setOpenMenu(null)
    setOpenSub(null)
  }, [active, homeTick])

  const closeAll = () => {
    setOpenMenu(null)
    setOpenSub(null)
    setDrawer(false)
    setMobileSearch(false)
  }

  const select = (value) => {
    onChange?.(value)
    closeAll()
  }

  const selectDealState = (id) => {
    onPickDealState?.(id)
    onChange?.(DEALS_TAB)
    closeAll()
  }

  const selectDealBucket = (id) => {
    onPickDealBucket?.(id)
    onChange?.(CAMPAIGN_TAB)
    closeAll()
  }

  const hasCampaign = campaignCount > 0
  /* 数量为 0 的标签入口不显示 —— 点进去是空页的入口看起来像筛选坏了。 */
  const visibleTags = tagItemsOf(holidayLabel).filter(
    (item) => (tagCounts[item.value] || 0) > 0,
  )
  const campaignName = campaignLabel || 'Campaign'
  const shopItems = [
    { value: 'All', label: 'All products', count: total },
    ...categories.map((category) => ({
      value: category,
      label: category,
      count: categoryCounts[category] || 0,
    })),
  ]

  /* 点 SALE 本身 = 进第一个**有商品**的专区。 */
  const firstSaleWithItems = [
    { value: DEALS_TAB, count: dealsCount },
    { value: CAMPAIGN_TAB, count: campaignCount },
  ].find((item) => item.count > 0)

  const isActive = (value) => active === value
  const shopActive = categories.includes(active)
  const saleActive = active === DEALS_TAB || active === CAMPAIGN_TAB

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
    `flex w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-[13px] transition ${
      on ? 'bg-cream-dark font-medium text-charcoal' : 'text-charcoal/75 hover:bg-cream-dark/60'
    }`

  const countOf = (n) => (
    <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">{n}</span>
  )

  return (
    <>
      {/* ── 桌面：横排菜单 ── */}
      <div ref={menuRootRef} className="hidden min-w-0 flex-1 items-center gap-5 lg:flex xl:gap-7">
        <div className="relative" onMouseEnter={() => setOpenMenu('sale')}>
          <button
            type="button"
            onClick={() => (firstSaleWithItems ? select(firstSaleWithItems.value) : setOpenMenu('sale'))}
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
                      onClick={() => select(DEALS_TAB)}
                      onMouseEnter={() => setOpenSub('deals')}
                      onFocus={() => setOpenSub('deals')}
                      aria-haspopup="true"
                      aria-expanded={openSub === 'deals'}
                      className={rowClass(isActive(DEALS_TAB))}
                    >
                      <span className="min-w-0 truncate">{REGULAR_DEALS_LABEL}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {countOf(dealsCount)}
                        <span aria-hidden="true" className="text-[9px] text-charcoal-light/50">
                          ›
                        </span>
                      </span>
                    </button>

                    {openSub === 'deals' && (
                      <div className="absolute left-full top-0 z-40 ml-1 w-44">
                        <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                          {STATE_OPTIONS.map((option) => {
                            const on = (dealState || 'all') === option.id
                            const count =
                              option.id === 'all' ? dealsCount : dealStateCounts?.[option.id]
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => selectDealState(option.id)}
                                aria-pressed={on}
                                className={rowClass(on)}
                              >
                                <span className="min-w-0 truncate">{option.label}</span>
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
                      onClick={() => select(CAMPAIGN_TAB)}
                      onMouseEnter={() => setOpenSub('campaign')}
                      onFocus={() => setOpenSub('campaign')}
                      aria-haspopup="true"
                      aria-expanded={openSub === 'campaign'}
                      className={rowClass(active === CAMPAIGN_TAB)}
                    >
                      <span className="min-w-0 truncate">{campaignName}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {countOf(campaignCount)}
                        <span aria-hidden="true" className="text-[9px] text-charcoal-light/50">
                          ›
                        </span>
                      </span>
                    </button>

                    {openSub === 'campaign' && (
                      <div className="absolute left-full top-0 z-40 ml-1 w-44">
                        <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                          {BUCKET_OPTIONS.map((option) => {
                            const on = (dealBucket || 'all') === option.id
                            const count =
                              option.id === 'all' ? campaignCount : bucketCounts?.[option.id]
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => selectDealBucket(option.id)}
                                aria-pressed={on}
                                className={rowClass(on)}
                              >
                                <span className="min-w-0 truncate">{option.label}</span>
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
            onClick={() => select('All')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'shop'}
            className={menuClass(shopActive)}
          >
            Shop
          </button>

          {openMenu === 'shop' && (
            <div className="absolute left-0 top-full z-40 w-[min(82rem,96vw)] pt-1">
              <div className="rounded-xl bg-white p-3 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                <div className="grid grid-cols-3 gap-x-6 gap-y-2 p-2 xl:grid-cols-4 2xl:grid-cols-5">
                  {shopItems.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => select(item.value)}
                      aria-pressed={isActive(item.value)}
                      className={rowClass(isActive(item.value))}
                    >
                      <span className="min-w-0 break-words leading-snug">{item.label}</span>
                      {countOf(item.count)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

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

      {/* ── 手机：搜索 + 汉堡 ── */}
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

      {/* ── 手机搜索行 ── */}
      {mobileSearch && (
        <div className="absolute inset-x-0 top-full z-50 border-t border-charcoal/[0.07] bg-cream px-5 py-2.5 shadow-lg shadow-charcoal/5 lg:hidden">
          <SearchBox value={query} onChange={onQueryChange} />
        </div>
      )}

      {/* ── 手机抽屉：常驻挂载，向右滑出 ── */}
      <div
        aria-hidden={!drawer}
        className={`absolute inset-x-0 top-full z-50 max-h-[75vh] overflow-y-auto border-t border-charcoal/[0.08] bg-cream shadow-xl shadow-charcoal/10 transition-[transform,opacity] duration-200 ease-out lg:hidden ${
          drawer ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
        }`}
      >
        <div className="px-5 pb-6 pt-3">
          <DrawerGroup title="Sale">
            {dealsCount > 0 && (
              <DrawerItem
                label={REGULAR_DEALS_LABEL}
                count={dealsCount}
                active={isActive(DEALS_TAB)}
                onClick={() => select(DEALS_TAB)}
              />
            )}
            {dealsCount > 0 && (
              <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                {STATE_OPTIONS.map((option) => {
                  const on = (dealState || 'all') === option.id
                  const count = option.id === 'all' ? dealsCount : dealStateCounts?.[option.id]
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectDealState(option.id)}
                      aria-pressed={on}
                      className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-[12px] transition ${
                        on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                      }`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
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
                active={active === CAMPAIGN_TAB}
                onClick={() => select(CAMPAIGN_TAB)}
              />
            )}
            {hasCampaign && (
              <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                {BUCKET_OPTIONS.map((option) => {
                  const on = (dealBucket || 'all') === option.id
                  const count = option.id === 'all' ? campaignCount : bucketCounts?.[option.id]
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectDealBucket(option.id)}
                      aria-pressed={on}
                      className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-[12px] transition ${
                        on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                      }`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
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
            {shopItems.map((item) => (
              <DrawerItem
                key={item.value}
                label={item.label}
                count={item.count}
                active={isActive(item.value)}
                onClick={() => select(item.value)}
              />
            ))}
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
      <span className="text-[10.5px] tabular-nums text-charcoal-light/60">{count}</span>
    </button>
  )
}
