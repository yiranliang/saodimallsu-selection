import { useEffect, useRef, useState } from 'react'
import SearchBox from './SearchBox.jsx'
import { Close, Search } from './icons.jsx'
import { CAMPAIGN_TAB, DEALS_TAB, DEAL_BUCKETS, REGULAR_DEALS_LABEL } from '../utils/deal.js'
import { FEATURED_VIEW, HOLIDAY_TAB_DEFAULT_LABEL, TAG_VIEW } from '../utils/navViews.js'

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
  bucket = 'all',
  bucketCounts = null,
  onBucketChange,
  /* ⚡ 常规秒杀的两级视图：全部 / 进行中 / 排期中。 */
  dealState = 'all',
  onDealStateChange,
  dealStateCounts = null,
  /* 当前生效的"窄化筛选"（某个分类 / 某个标签视图）。空串 = 没筛选，不占位。 */
  filterLabel = '',
  onClearFilter,
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
  const selectDealState = (id) => {
    onDealStateChange?.(id)
    onChange?.(DEALS_TAB)
    closeAll()
  }

  const selectBucket = (id) => {
    onBucketChange?.(id)
    onChange?.(CAMPAIGN_TAB)
    closeAll()
  }

  const hasCampaign = campaignCount > 0
  const campaignName = campaignLabel || 'Campaign'
  const shopItems = [
    { value: 'All', label: 'All products', count: total },
    ...categories.map((category) => ({
      value: category,
      label: category,
      count: categoryCounts[category] || 0,
    })),
  ]

  const isActive = (value) => active === value
  const shopActive = categories.includes(active) || selectedCats.length > 0
  const saleActive = active === DEALS_TAB || active === CAMPAIGN_TAB

  const menuClass = (on) =>
    `inline-flex items-center gap-1 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors ${
      on ? 'text-charcoal' : 'text-charcoal-light hover:text-charcoal'
    }`

  const rowClass = (on) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] transition ${
      on ? 'bg-cream-dark font-medium text-charcoal' : 'text-charcoal/75 hover:bg-cream-dark/60'
    }`

  const countOf = (n) => (
    <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/60">{n}</span>
  )

  const bucketList = (
    <>
      {BUCKET_OPTIONS.map((option) => {
        const on = active === CAMPAIGN_TAB && bucket === option.id
        const count = bucketCounts?.[option.id]
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => selectBucket(option.id)}
            aria-pressed={on}
            className={rowClass(on)}
          >
            <span className="truncate">{option.label}</span>
            {Number.isFinite(count) ? (
              countOf(count)
            ) : (
              <span className="text-[9px] text-charcoal-light/30">–</span>
            )}
          </button>
        )
      })}
    </>
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
            onClick={() => setOpenMenu((open) => (open === 'sale' ? null : 'sale'))}
            aria-haspopup="true"
            aria-expanded={openMenu === 'sale'}
            className={menuClass(saleActive)}
          >
            Sale
          </button>
          {openMenu === 'sale' && (
            <div className="absolute left-0 top-full z-40 w-60 pt-1">
              <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
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
                    <span className="truncate">{REGULAR_DEALS_LABEL}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {countOf(dealsCount)}
                      <span aria-hidden="true" className="text-[9px] text-charcoal-light/50">
                        ›
                      </span>
                    </span>
                  </button>

                  {/* 第二级：进行中 / 排期中。时间由导入时的 sale_* 决定，
                      到了开始时间会自动从 Upcoming 挪到 Active。 */}
                  {openSub === 'deals' && (
                    <div className="absolute left-full top-0 z-40 ml-1 w-44">
                      <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                        {DEAL_STATES.map((option) => {
                          const on =
                            active === DEALS_TAB && (dealState || 'all') === option.id
                          const count = dealStateCounts?.[option.id]
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => selectDealState(option.id)}
                              aria-pressed={on}
                              className={rowClass(on)}
                            >
                              <span className="truncate">{option.label}</span>
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

                {hasCampaign && (
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setOpenSub('campaign')}
                      onFocus={() => setOpenSub('campaign')}
                      onClick={() => setOpenSub((open) => (open === 'campaign' ? null : 'campaign'))}
                      aria-haspopup="true"
                      aria-expanded={openSub === 'campaign'}
                      className={rowClass(active === CAMPAIGN_TAB)}
                    >
                      <span className="truncate">{campaignName}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {countOf(campaignCount)}
                        <span aria-hidden="true" className="text-[9px] text-charcoal-light/50">
                          ›
                        </span>
                      </span>
                    </button>

                    {/* 第二级：折扣档位（大促的下一级目录） */}
                    {openSub === 'campaign' && (
                      <div className="absolute left-full top-0 z-40 ml-1 w-44">
                        <div className="rounded-xl bg-white p-1.5 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                          {bucketList}
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
        >
          <button
            type="button"
            onClick={() => {
              /* 点 Shop 本身 = 回到 All products（清掉多选），同时把菜单留着，
               * 这样下一步还能直接挑分类；纯触摸设备没有 hover，这一步也是
               * 它们唯一能把菜单打开的手势。 */
              if (selectedCats.length > 0 || active !== 'All') select('All')
              setOpenMenu('shop')
            }}
            onMouseEnter={() => setOpenMenu('shop')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'shop'}
            className={menuClass(shopActive)}
          >
            Shop
          </button>
          {openMenu === 'shop' && (
            <div className="absolute left-0 top-full z-40 w-[min(44rem,86vw)] pt-1">
              <div className="rounded-xl bg-white p-3 shadow-xl shadow-charcoal/10 ring-1 ring-charcoal/10">
                <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4">
                  {shopItems.map((item) => {
                    const on = item.value === 'All'
                      ? selectedCats.length === 0
                      : selectedCats.includes(item.value)
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() =>
                          item.value === 'All' ? select('All') : onToggleCategory?.(item.value)
                        }
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
                          <span className="truncate">{item.label}</span>
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
          Featured
        </button>

        {TAG_ITEMS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => select(item.value)}
            aria-pressed={isActive(item.value)}
            className={menuClass(isActive(item.value))}
          >
            {item.label}
            <span className="text-[10px] tabular-nums text-charcoal-light/50">
              {tagCounts[item.value] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* ── 桌面：搜索框在右侧 ── */}
      <div className="hidden w-[220px] shrink-0 lg:block xl:w-[260px]">
        <SearchBox value={query} onChange={onQueryChange} />
      </div>

      {/* ── 手机：当前视图名 + 搜索 + 汉堡 ── */}
      <div className="flex min-w-0 flex-1 items-center gap-1 lg:hidden">
        <button
          type="button"
          onClick={() => {
            setDrawer(true)
            setMobileSearch(false)
          }}
          aria-expanded={drawer}
          className="-ml-1 flex min-w-0 flex-1 items-center gap-1 truncate rounded-full px-1 py-1 text-left text-[11.5px] font-semibold uppercase tracking-[0.12em] text-charcoal transition hover:bg-cream-dark"
        >
          <span className="min-w-0 truncate">
            {activeLabel(active, bucket, categories, campaignName, bucketCounts, holidayLabel, dealState, selectedCats)}
          </span>
          <span aria-hidden="true" className="shrink-0 text-[9px] text-charcoal-light/50">
            ▾
          </span>
        </button>
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

      {/* ── 生效中的筛选：只在有分类/标签筛选时出现，一行就够 ── */}
      {filterLabel && (
        <div className="border-t border-charcoal/[0.05] px-5 py-1.5 sm:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <span className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-charcoal-light/60">
              Filter
            </span>
            <span className="rounded-full bg-charcoal px-2.5 py-0.5 text-[11px] font-medium text-cream">
              {filterLabel}
            </span>
            <button
              type="button"
              onClick={onClearFilter}
              className="text-[11px] text-charcoal-light underline-offset-2 transition hover:text-charcoal hover:underline"
            >
              Clear ×
            </button>
          </div>
        </div>
      )}

      {/* ── 手机搜索行 ── */}
      {mobileSearch && (
        <div className="absolute inset-x-0 top-full z-50 border-t border-charcoal/[0.07] bg-cream px-5 py-2.5 shadow-lg shadow-charcoal/5 lg:hidden">
          <SearchBox value={query} onChange={onQueryChange} />
        </div>
      )}

      {/* ── 手机抽屉 ── */}
      {drawer && (
        <div className="absolute inset-x-0 top-full z-50 max-h-[75vh] overflow-y-auto border-t border-charcoal/[0.08] bg-cream shadow-xl shadow-charcoal/10 lg:hidden">
          <div className="px-5 pb-6 pt-3">
            <DrawerGroup title="Sale">
              <DrawerItem
                label={REGULAR_DEALS_LABEL}
                count={dealsCount}
                active={isActive(DEALS_TAB)}
                onClick={() => select(DEALS_TAB)}
              />
              <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                {DEAL_STATES.filter((option) => option.id !== 'all').map((option) => {
                  const on = active === DEALS_TAB && (dealState || 'all') === option.id
                  const count = dealStateCounts?.[option.id]
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectDealState(option.id)}
                      aria-pressed={on}
                      className={`flex w-full items-center justify-between py-1.5 text-left text-[12px] transition ${
                        on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                      }`}
                    >
                      {option.label}
                      <span className="text-[10px] tabular-nums text-charcoal-light/50">
                        {Number.isFinite(count) ? count : '–'}
                      </span>
                    </button>
                  )
                })}
              </div>
              {hasCampaign && (
                <>
                  <DrawerItem
                    label={campaignName}
                    count={campaignCount}
                    active={active === CAMPAIGN_TAB}
                    onClick={() => select(CAMPAIGN_TAB)}
                  />
                  {/* 二级目录：折扣档位，缩进一级 */}
                  <div className="mb-1 ml-3 border-l border-charcoal/10 pl-3">
                    {BUCKET_OPTIONS.map((option) => {
                      const on = active === CAMPAIGN_TAB && bucket === option.id
                      const count = bucketCounts?.[option.id]
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => selectBucket(option.id)}
                          aria-pressed={on}
                          className={`flex w-full items-center justify-between py-1.5 text-left text-[12px] transition ${
                            on ? 'font-medium text-charcoal' : 'text-charcoal/60'
                          }`}
                        >
                          {option.label}
                          <span className="text-[10px] tabular-nums text-charcoal-light/50">
                            {Number.isFinite(count) ? count : '–'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
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
                label="Featured"
                count={total}
                active={active === FEATURED_VIEW}
                onClick={() => select(FEATURED_VIEW)}
              />
              {/* 推荐位自己一个入口：内容随机生成，后台不需要编辑。 */}
        <button
          type="button"
          onClick={() => select(FEATURED_VIEW)}
          aria-pressed={active === FEATURED_VIEW}
          className={menuClass(active === FEATURED_VIEW)}
        >
          Featured
        </button>

        {TAG_ITEMS.map((item) => (
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
      )}
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
      className={`flex items-center justify-between border-b border-charcoal/[0.05] py-2.5 text-left text-[13px] transition last:border-b-0 ${
        active ? 'font-medium text-charcoal' : 'text-charcoal/75'
      }`}
    >
      {label}
      <span className="text-[10.5px] tabular-nums text-charcoal-light/60">{count}</span>
    </button>
  )
}

/** 手机上那行"我现在在哪一屏"（大促时带上档位）。 */
function activeLabel(active, bucket, categories, campaignName, bucketCounts, holidayLabel, dealState, selectedCats = []) {
  if (active === DEALS_TAB) {
    const state = DEAL_STATES.find((option) => option.id === (dealState || 'all'))
    return state && state.id !== 'all'
      ? `${REGULAR_DEALS_LABEL} · ${state.label}`
      : REGULAR_DEALS_LABEL
  }
  if (active === CAMPAIGN_TAB) {
    const band = BUCKET_OPTIONS.find((option) => option.id === bucket)
    return bucket === 'all' || !band ? campaignName : `${campaignName} · ${band.label}`
  }
  if (active === TAG_VIEW.NEW) return 'New'
  if (active === TAG_VIEW.BESTSELLER) return 'Bestseller'
  if (active === TAG_VIEW.HOLIDAY) return holidayLabel || HOLIDAY_TAB_DEFAULT_LABEL
  if (selectedCats.length > 1) return `${selectedCats.length} categories`
  if (selectedCats.length === 1) return selectedCats[0]
  if (active === FEATURED_VIEW) return 'Featured'
  if (active === 'All') return 'Shop'
  return categories.includes(active) ? active : 'Shop'
}
