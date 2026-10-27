import { useState, useMemo, useEffect, useRef } from 'react'
import Modal from '../Modal.jsx'
import ProductImage from '../ProductImage.jsx'
import { Close, Plus, Trash, Check, ChevronDown, ChevronUp, Image as ImageIcon, AlertCircle, ExternalLink, ArrowToTop } from '../icons.jsx'
import { UNCATEGORISED, getBadgeColumnStatus, getTeaserColumnStatus, getDealColumnStatus, getAccColumnStatus, getSubBadgeStatus, getPriorityColumnStatus } from '../../store/productStore.js'
import { useCategories } from '../../hooks/useCategories.js'
import { useAsins } from '../../hooks/useAsins.js'
import { getAsinsStatus, isValidAsin } from '../../utils/asinStore.js'
import { firstListing } from '../../utils/amazon.js'
import { isColourType } from '../../utils/variantImage.js'
import { isSizeType, sizeOrder } from '../../utils/sizes.js'
import { variantKey } from '../../utils/sku.js'
import {
  planVariantRenames,
  rekeyKeys,
  rekeyVariants,
  splitVariantKey,
} from '../../utils/variantRename.js'
import {
  BADGE_COLOR_PRESETS,
  BADGE_TEMPLATES,
  badgeStyle,
  badgeTemplateMatch,
  normaliseBadgeColor,
} from '../../utils/badge.js'
import { parsePriorityInput } from '../../utils/batchOps.js'
import { t } from '../../i18n/admin.js'
import {
  VARIANT_IMAGE_MIME,
  isVariantDrag,
  planMainImageDrop,
  readVariantDrop,
  writeVariantDrag,
} from '../../utils/variantDrop.js'
import {
  autoDiscountLabelFor,
  dealStatus,
  formatPriceText,
  legacyDealTimes,
} from '../../utils/deal.js'
import {
  combinationsOf,
  colourAxisOf,
  sizeAxisOf,
  soldOutSummary,
  soldOutKeysOf,
  summaryLabel,
  normalizeSoldOut,
  pruneSoldOut,
  withKeySoldOut,
  toggleAxisSoldOut,
} from '../../utils/soldOut.js'

/** Sentinel for the "＋ New category…" row — never a real category name */
const NEW_CATEGORY = '__new__'

/**
 * Product editor
 * ───────────────
 * Modal form for creating / editing a single product:
 *   - 货号 (the spreadsheet code; the internal id is shown but never edited)
 *   - main image, by URL
 *   - free-form spec groups (Colour / Size / anything)
 *   - a per-option image URL on the colour group, so the storefront can swap
 *     the photo when a creator picks a colour
 *
 * IMAGE URLS ONLY — there is deliberately no file upload. Uploads were stored
 * as base64 in localStorage, which has a ~5MB budget shared with the whole
 * catalogue; a handful of photos filled it and broke saving. A URL costs ~60
 * bytes and is cached by the browser, so that is the only input offered.
 */
export default function ProductEditor({ open, product, isNew, onSave, onClose, showToast }) {
  const [draft, setDraft] = useState(() => toDraft(product))
  const [imageError, setImageError] = useState('')
  const knownCategories = useCategories()

  /* ASIN edits, keyed by `"Colour|Size"`. Deliberately a sparse overlay on top
   * of the store rather than a copy of it: the map can land after the modal
   * opens (admin login finishes its first fetch at boot), and a copy would
   * freeze whatever was there at open time — showing every combination as
   * "missing" a second later.
   *
   * An empty string is meaningful: it means "drop this combination's ASIN",
   * applied as a delete at merge time. */
  const [asinEdits, setAsinEdits] = useState({})
  const [asinBlurred, setAsinBlurred] = useState({})
  const asinMap = useAsins()

  /* "New category…" mode. `beforeNew` lets Cancel put the previous value back
   * instead of leaving the product uncategorised. */
  const [newCategory, setNewCategory] = useState(false)
  const [beforeNew, setBeforeNew] = useState(UNCATEGORISED)

  /* The size chips are displayed in canonical order, but re-sorting a list
   * while the cursor is in it would move the field sideways on every keystroke
   * ("I typed 2 and the box jumped three places left"). So the display order is
   * snapshotted when the group gains focus and released when focus leaves it:
   * the list settles once, and never moves under the caret.
   * Reset on every re-seed. */
  const [frozenOrder, setFrozenOrder] = useState(null)

  /* Drag a colour photo onto the main image. Two pieces of state, both pure
   * presentation: which card is in the air (so it can fade), and whether the
   * main image box is currently a valid target (so it can light up). Neither
   * holds data — the URL travels on the DataTransfer, never through React. */
  const [draggingOption, setDraggingOption] = useState(null)
  const [mainImageDropActive, setMainImageDropActive] = useState(false)

  // Re-seed the form whenever a different product is opened
  const [seedId, setSeedId] = useState(product?.id)
  /* …and whenever the SAME product is opened again. The draft is only seeded on
   * mount, and the editor is not unmounted between products, so closing with
   * Cancel and re-opening used to show the abandoned edits — which the next save
   * then wrote. That is how a colour typed into a cancelled form ended up in the
   * live catalogue. */
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) setWasOpen(open)

  if (open && product && (seedId !== product.id || !wasOpen)) {
    setSeedId(product.id)
    setDraft(toDraft(product))
    setImageError('')
    setNewCategory(false)
    setAsinEdits({})
    setAsinBlurred({})
    setFrozenOrder(null)
  }

  /* Drag a colour photo onto the main image — or click the arrow on the card,
   * which is the same action without a mouse. One function for both, so they
   * can never disagree about what happens.
   *
   * The decision (empty / already-the-same / apply) is `planMainImageDrop`;
   * this is only the wiring, so the three outcomes stay testable in Node. */
  const useVariantAsMain = (url, colour) => {
    const plan = planMainImageDrop(draft.image, { url, colour })
    const label = colour || '这个颜色'
    if (plan.kind === 'empty') {
      showToast?.(`${label}还没有照片`, 'error')
      return
    }
    if (plan.kind === 'noop') {
      showToast?.(`${label}已经是主图了`)
      return
    }
    setImageError('')
    patch('image', plan.url)
    showToast?.(`主图已换成的${label}那张`, 'success')
  }

  // Options for the category picker: the managed list from the `categories`
  // table, plus whatever this product currently holds (a hand-typed category
  // the trigger has not created yet must never disappear from the field).
  const categoryOptions = useMemo(() => {
    const set = new Set(knownCategories)
    set.add(UNCATEGORISED)
    if (draft.category) set.add(draft.category)
    return [...set]
  }, [knownCategories, draft.category])

  /* ── ASIN overlay ──
   * The base is what the database holds for the SAVED 货号 — `draft.sku` may be
   * a rename that has not happened yet, and a rename moves the row rather than
   * re-keying the values. Everything not on screen survives untouched, which is
   * what makes this an edit and not a replace of the 货号's whole map. */
  const savedSku = String(product?.sku || '').trim()
  const asinStatus = getAsinsStatus()
  const asinsReady = asinStatus === 'ready'
  const baseAsins = useMemo(() => asinMap[savedSku] || {}, [asinMap, savedSku])

  /* ── colour / size renames ──
   * The variant maps are keyed by the option TEXT, so fixing 藏青色 → Navy means
   * the stored keys have to move too. The plan compares the SAVED specs with the
   * ones on screen, position by position, and refuses to call it a rename when a
   * delete+add could explain the same difference (utils/variantRename.js).
   *
   * Applied to the BASE (the stored map) before the edit overlay, because the
   * overlay is keyed by the keys the panel is showing — i.e. the renamed ones. */
  const draftSpecs = useMemo(() => specMapOf(draft.specs), [draft.specs])
  const renamePlan = useMemo(
    () => planVariantRenames(product?.specs, draftSpecs),
    [product?.specs, draftSpecs],
  )
  const baseRekeyed = useMemo(() => rekeyVariants(baseAsins, renamePlan), [baseAsins, renamePlan])

  const mergedAsins = useMemo(() => {
    const out = { ...baseRekeyed.variants }
    for (const [key, raw] of Object.entries(asinEdits)) {
      const value = String(raw).trim().toUpperCase()
      if (value) out[key] = value
      else delete out[key]
    }
    return out
  }, [baseRekeyed, asinEdits])

  /* One line per renamed option for the panel, with how many ASINs ride along:
   * `藏青色 → Navy (5)`. Counted from the moves so "renamed" and "how many were
   * actually re-keyed" can never disagree. */
  const renameNotes = useMemo(() => {
    const moves = baseRekeyed.renamed
    return [
      ...renamePlan.colour.map((pair) => ({ ...pair, axis: 'colour' })),
      ...renamePlan.size.map((pair) => ({ ...pair, axis: 'size' })),
    ].map((pair) => ({
      ...pair,
      count: moves.filter((move) => {
        const [colour, size] = splitVariantKey(move.from)
        return String(pair.axis === 'colour' ? colour : size).toLowerCase() === pair.from.toLowerCase()
      }).length,
    }))
  }, [baseRekeyed, renamePlan])

  /* Only combinations the panel actually shows an input for are validated. Keys
   * from earlier imports that no longer match an option have no field to fix —
   * blocking the save on one of those would trap the product in an unsavable
   * state with nothing on screen to correct. They are listed in the extras block
   * instead, where the only action is "clear". */
  const editableKeys = new Set(draftComboKeys(draft))
  const invalidAsins = Object.entries(mergedAsins).filter(
    ([key, asin]) => editableKeys.has(key.toLowerCase()) && !isValidAsin(asin),
  )

  if (!product) return null

  const patch = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }))

  /* ── specs ── */

  const addSpecType = () => {
    patch('specs', [...draft.specs, { type: '', options: [''], images: [''] }])
  }

  const removeSpecType = (index) => {
    patch('specs', draft.specs.filter((_, i) => i !== index))
  }

  const setSpecType = (index, value) => {
    patch(
      'specs',
      draft.specs.map((group, i) => (i === index ? { ...group, type: value } : group)),
    )
  }

  const setOption = (groupIndex, optionIndex, value) => {
    patch(
      'specs',
      draft.specs.map((group, i) =>
        i === groupIndex
          ? {
              ...group,
              options: group.options.map((o, j) => (j === optionIndex ? value : o)),
            }
          : group,
      ),
    )
  }

  /**
   * Image URLs live in a parallel array, aligned to `options` by index.
   * Keying them by the option name instead would orphan the photo the moment
   * someone fixes a typo in a colour name.
   */
  const setOptionImage = (groupIndex, optionIndex, value) => {
    patch(
      'specs',
      draft.specs.map((group, i) =>
        i === groupIndex
          ? {
              ...group,
              images: group.options.map((_, j) =>
                j === optionIndex ? value : group.images[j] || '',
              ),
            }
          : group,
      ),
    )
  }

  const addOption = (groupIndex) => {
    patch(
      'specs',
      draft.specs.map((group, i) =>
        i === groupIndex
          ? { ...group, options: [...group.options, ''], images: [...group.images, ''] }
          : group,
      ),
    )
  }

  const removeOption = (groupIndex, optionIndex) => {
    patch(
      'specs',
      draft.specs.map((group, i) =>
        i === groupIndex
          ? {
              ...group,
              options: group.options.filter((_, j) => j !== optionIndex),
              images: group.images.filter((_, j) => j !== optionIndex),
            }
          : group,
      ),
    )
  }

  /* ── save ── */

  const handleSave = () => {
    const sku = draft.sku.trim()

    if (!draft.name.trim() && !sku) {
      showToast?.('Add a 货号 or a name', 'error')
      return
    }

    /* A truncated ASIN is an order for the wrong listing, and nothing fails
     * until somebody is packing the box. Refuse to save rather than trust the
     * paste. Blank is not an error — that is "missing", which the section flags. */
    if (invalidAsins.length) {
      showToast?.(`${invalidAsins.length} 个 ASIN 不是 10 位`, 'error')
      return
    }

    // Drop empty spec groups / options so we never persist blanks, and build
    // the variant image map from the rows that actually have a URL.
    const specs = {}
    const variantImages = {}

    for (const group of draft.specs) {
      const type = group.type.trim()
      if (!type) continue

      const rows = group.options
        .map((option, i) => ({
          name: option.trim(),
          image: String(group.images[i] || '').trim(),
        }))
        .filter((row) => row.name)

      if (!rows.length) continue

      specs[type] = rows.map((row) => row.name)

      const withImage = {}
      for (const row of rows) if (row.image) withImage[row.name] = row.image
      if (Object.keys(withImage).length) variantImages[type] = withImage
    }

    /* Sold-out marks use the same `Colour|Size` keys, so a renamed colour would
     * lose its "no stock" ticks to the prune below (or, worse, come back on
     * sale). Re-key them with the same plan before pruning: the prune is still
     * what removes the marks of combinations that genuinely went away. */
    const carriedSoldOut = rekeyKeys(draft.soldOut, renamePlan).keys

    /* Turning the card off clears the five fields — that IS the "off" state,
     * because the table has no boolean for it. Reading them once here keeps
     * the payload honest: no half-cleared window can be written by a stray
     * patch (an "on" switch with only a start time would show a countdown with
     * no end, i.e. never active and impossible to explain). */
    const dealOn = Boolean(draft.dealArmed)
    const savedDeal = {
      /* 日期由日历给，时刻由这里定：开始日 00:00:00，结束日 23:59:59。
       * 这样"10 月 28 日到 10 月 30 日"是完整的三天，而不是到 30 号零点
       * 就结束（少一天，而且运营不会想到）。 */
      saleStart: dealOn ? startStamp(draft.saleStart.trim()) : '',
      saleEnd: dealOn ? endStamp(draft.saleEnd.trim()) : '',
      salePrice: dealOn ? draft.salePrice.trim() : '',
      originalPrice: dealOn ? draft.originalPrice.trim() : '',
      discountLabel: dealOn ? draft.discountLabel.trim() : '',
    }

    // `id` is internal and never changes; `sku` is the 货号 and is free-form
    onSave({
      id: product.id,
      sku,
      name: draft.name.trim() || sku,
      category: draft.category.trim() || UNCATEGORISED,
      tag: draft.tag.trim(),
      /* Only meaningful with a tag, but kept even when the text is blank: ops
       * often types the text and picks the colour in either order, and dropping
       * the colour on save would make the picker feel broken. */
      badgeColor: normaliseBadgeColor(draft.badgeColor),
      /* 副角标：文字空 = 没有副角标（颜色跟着清），理由同主角标。 */
      subTag: draft.subTag.trim(),
      subBadgeColor: normaliseBadgeColor(draft.subBadgeColor),
      /* 置顶权重：空输入 = 0 = 不置顶。只在秒杀专区内部生效，
       * 不碰 sort_order —— 拖拽序仍然由 reorder 写入独占。 */
      dealPriority: parsePriorityInput(draft.dealPriority) ?? 0,
      image: draft.image.trim() || './placeholders/placeholder.svg',
      specs,
      variantImages,
      /* Pruned against the specs being saved: renaming a colour or removing a
       * size would otherwise leave marks pointing at combinations that no
       * longer exist, which inflates the "N / M sold out" count forever. */
      soldOutVariants: pruneSoldOut(carriedSoldOut, { specs }),
      hidden: Boolean(draft.hidden),
      /* Coming Soon is a transaction lock, not a badge — it travels with the
       * product row so the storefront and code generator can trust one field. */
      isTeaser: Boolean(draft.isTeaser),
      /* Flash sale — the five strings exactly as typed. No Date, no timezone,
       * no `parseFloat`: 09-deal.sql stores text and deal.js parses it on the
       * reader's clock. `dealArmed` is form-only, so turning the card off
       * writes five empty strings, which mapping turns into five NULLs. */
      saleStart: savedDeal.saleStart,
      saleEnd: savedDeal.saleEnd,
      salePrice: savedDeal.salePrice,
      originalPrice: savedDeal.originalPrice,
      discountLabel: savedDeal.discountLabel,
      /* ACC 佣金 —— 开关是独立的布尔列，所以这里不需要像秒杀那样"关 = 清空"。
       * `acc_id` 即使开关是关的也照常写回：它是拿不到第二次的运营资产，
       * 一次误点开关不该让人回亚马逊后台重抄一遍（见 utils/acc.js）。 */
      hasAcc: Boolean(draft.hasAcc),
      accId: draft.accId.trim(),
      /* Whole variant map for this 货号, edits applied, keys moved with any
       * renamed option. Omitted entirely when the ASIN table has not been read
       * — writing a map built on an empty base would silently wipe the 货号's
       * real ASINs. `undefined` tells the caller "no ASIN work to do", which is
       * the only safe default. */
      asins: sku && asinsReady ? mergedAsins : undefined,
      /* Only so the caller can say what happened in the toast; nothing stores
       * this. Empty when no option was renamed. */
      asinRenames: sku && asinsReady && renameNotes.length ? renameNotes : undefined,
    })
  }

  const isDataUrl = draft.image.startsWith('data:')
  /* `null` = no colour set, which means "keep the default charcoal pill" —
   * `badgeStyle` returns null rather than a default so the classes stay. */
  const previewBadge = badgeStyle(draft.badgeColor)
  /* Read during render, not in state: the flag flips once per session (when the
   * first catalogue read discovers the column), and the editor is only ever
   * opened after that read. */
  const badgeColumnMissing = getBadgeColumnStatus() === 'missing'
  const teaserColumnMissing = getTeaserColumnStatus() === 'missing'
  const dealColumnMissing = getDealColumnStatus() === 'missing'
  const accColumnMissing = getAccColumnStatus() === 'missing'
  const subBadgeColumnMissing = getSubBadgeStatus() === 'missing'
  const priorityColumnMissing = getPriorityColumnStatus() === 'missing'
  const variantCount = draft.specs.reduce(
    (sum, group) => sum + group.images.filter((url) => String(url || '').trim()).length,
    0,
  )

  /* The stock grid works off the draft, not the saved product, so ticking a
   * cell before the first save behaves the same as editing an existing one.
   * `draftSpecs` itself is memoised above (the rename plan needs it). */
  const draftProduct = { specs: draftSpecs, soldOutVariants: draft.soldOut }

  /* ── ASIN rows ──
   * One row per combination the DRAFT offers, matched case-insensitively
   * against the stored map (the importer normalises spellings, but a hand-typed
   * colour can still drift), with any renamed option already folded in — a
   * colour renamed to Navy shows the ASIN that used to sit under 藏青色. Where
   * the two spellings differ only in case, the STORED key stays the edit target:
   * writing the canonical spelling instead would leave two keys for one
   * combination.
   *
   * Keys the current options no longer mention are listed separately rather than
   * hidden: they are still in the database, saving keeps them, and an invisible
   * row is one nobody can ever clean up. That is also where the ASINs of a
   * deleted colour wait while its replacement is being filled in. */
  const asinCombos = combinationsOf(draftProduct)
  const asinByLower = new Map(
    Object.entries(mergedAsins).map(([key, asin]) => [key.toLowerCase(), { key, asin }]),
  )
  const asinRows = asinCombos.map((combo) => {
    const hit = asinByLower.get(combo.key.toLowerCase())
    return {
      key: hit?.key || combo.key,
      label: [combo.colour, combo.size].filter(Boolean).join(' / '),
      asin: mergedAsins[hit?.key || combo.key] || '',
      /* Not in the stored map at all → this row came from the options on screen
       * (a colour typed a second ago, a size just added). Marked in the UI
       * because that is exactly the row ops used to miss: the old panel only
       * looked like it knew about imported combinations. */
      fresh: !hit,
    }
  })
  const asinComboKeys = new Set(asinRows.map((row) => row.key.toLowerCase()))
  const asinExtras = Object.entries(mergedAsins)
    .filter(([key]) => !asinComboKeys.has(key.toLowerCase()))
    .map(([key, asin]) => ({
      key,
      label: key.split('|').filter(Boolean).join(' / ') || key,
      asin,
    }))
  const asinMissing = asinRows.filter((row) => !row.asin).length

  /* ── "View on Amazon" ──
   * Sourcing a photo means looking at the listing, so the link sits directly
   * under the field where that photo gets pasted. Built from the rows above, in
   * their order — the first colour/size the panel shows — and from
   * `mergedAsins`, which means a just-typed ASIN works before any save.
   *
   * `null` when nothing usable is stored. Hidden, not disabled: a dead link is
   * a worse affordance than no link, and "no ASIN yet" is already said loudly
   * by the ASIN panel.
   *
   * See utils/amazon.js for why "first" is the render order and not the object
   * key order (`asins.variants` is jsonb — its keys come back sorted by length,
   * which is nobody's idea of first). */
  const amazonListing = firstListing([...asinRows, ...asinExtras])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? '新增商品' : '编辑商品'}
      /* Phone: a bottom sheet at `max-w-xl`. Desktop: wide enough for three
         columns (photo | options | ASIN), which is the difference between
         "fill this in" and "scroll through a phone page on a 27-inch monitor".
         It used to be `max-w-5xl`, and at that width the ASIN block ended up
         506px below the fold — measured, not guessed. */
      maxWidth="max-w-xl lg:max-w-6xl"
    >
      <div className="flex max-h-[92vh] flex-col">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-charcoal shadow-sm backdrop-blur transition hover:bg-white"
        >
          <Close className="h-4 w-4" />
        </button>

        {/* The scrollbar is deliberately visible. An earlier version hid it
            (`.no-scrollbar`), and the form is taller than the dialog: the ASIN
            block sat 500px below the fold with nothing on screen suggesting
            there was more, which is exactly how it "went missing". */}
        <div className="overflow-y-auto px-5 pb-6 pt-6 sm:px-7">
          <h2 className="text-lg font-semibold tracking-tight text-charcoal">
            {isNew ? '新增商品' : '编辑商品'}
          </h2>
          <p className="mt-1 text-[12px] text-charcoal-light">改动会立即保存到这个浏览器。</p>

          {/* ── Three columns from `lg` up ──
              Left: the photo, big enough to actually judge. Middle: what you
              type — 货号, name, badge, options. Right: the ASIN block and
              stock, on its own column so it is on screen the moment the dialog
              opens (adding a colour on the left shows up on the right).
              Below `lg` this collapses back to one column, which is what a
              phone needs and what the storefront looks like anyway. */}
          <div className="lg:grid lg:grid-cols-[minmax(0,250px)_minmax(0,1fr)] lg:items-start lg:gap-6 xl:gap-8">
          {/* ── Image ── */}
          <div className="mt-6 lg:mt-0 lg:sticky lg:top-0">
            <div className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Main image')}</div>

            <div className="mt-2 flex gap-3 lg:flex-col">
              {/* Admin thumbnails deliberately keep `contain` while the
                  storefront switched to `cover`: here the question is "is this
                  the right photo?", and a cropped shot answers it worse than a
                  whole one. Nothing has to line up in a grid.

                  It is also the drop target for a colour photo dragged from
                  below — the whole point of the gesture is that the photo you
                  are judging IS the one you drop. */}
              <div
                data-main-image-drop
                onDragOver={(event) => {
                  /* `types` is readable here, the payload is not — so this is
                   * where the box decides whether it is a target at all. A file
                   * dragged in from the desktop never lights it up. */
                  if (!isVariantDrag(event.dataTransfer?.types)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  setMainImageDropActive(true)
                }}
                onDragLeave={(event) => {
                  /* Moving between the image and the badge pill is not
                   * leaving — the same guard the option groups use. */
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setMainImageDropActive(false)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setMainImageDropActive(false)
                  const payload = readVariantDrop(event.dataTransfer)
                  /* Not our drag: do nothing, and do not pretend otherwise.
                   * There is deliberately no `text/plain` on the payload, so a
                   * drop anywhere else in the dialog is inert. */
                  if (!payload) return
                  useVariantAsMain(payload.url, payload.colour)
                }}
                className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-white ring-1 transition lg:h-auto lg:w-full lg:aspect-square ${
                  mainImageDropActive
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-cream'
                    : 'ring-charcoal/5'
                }`}
              >
                {draft.image ? (
                  <ProductImage
                    src={draft.image}
                    alt="预览"
                    loading="eager"
                    className="h-full w-full object-contain"
                    onError={() => setImageError('That image URL could not be loaded')}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-charcoal-light/40">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}

                {/* Only painted while a colour photo is over the box. A hint
                    that is always there is wallpaper; a hint that appears under
                    the cursor is an instruction. */}
                {mainImageDropActive && (
                  <div
                    data-drop-hint
                    className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent/15 p-1"
                  >
                    <span className="rounded-full bg-charcoal/85 px-2 py-0.5 text-center text-[9px] font-medium leading-tight text-cream">{t('Drop to use as main image')}</span>
                  </div>
                )}

                {/* Same pill, same place, same colours as the storefront card —
                    the point of the picker is to judge the badge against the
                    photo it sits on, not against a colour swatch. */}
                {draft.tag.trim() && (
                  <span
                    data-badge-preview
                    style={previewBadge || undefined}
                    className={`absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
                      previewBadge ? '' : 'bg-charcoal/80 text-cream backdrop-blur-sm'
                    }`}
                  >
                    {draft.tag.trim()}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <input
                  type="text"
                  value={isDataUrl ? '' : draft.image}
                  onChange={(e) => {
                    setImageError('')
                    patch('image', e.target.value)
                  }}
                  placeholder="https://… or ./placeholders/p001.svg"
                  className="input-field text-[12px]"
                />

                <p className="text-[10px] leading-relaxed text-charcoal-light">粘贴图片链接，或者把下面某个颜色的图拖到这块预览上。上传功能是**故意关掉的** —— base64 会把浏览器存储塞满，之后保存就会失败。</p>

                {/* The shortcut this whole block exists for: open the listing the
                    photo is coming from, in a new tab, without going through the
                    storefront to copy a link first. `noopener` because it is a
                    third-party page; `noreferrer` because amazon.com has no
                    business knowing where the click came from — the admin URL
                    says "backend" out loud.

                    The variant tag is the point of interest: it says WHICH
                    colour/size this listing is, so a photo cannot silently
                    land on the wrong swatch. */}
                {amazonListing && (
                  <a
                    href={amazonListing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${amazonListing.asin}${amazonListing.label ? ` · ${amazonListing.label}` : ''} — opens amazon.com in a new tab`}
                    aria-label={`View ${amazonListing.asin}${amazonListing.label ? ` (${amazonListing.label})` : ''} on Amazon — opens in a new tab`}
                    className="group inline-flex max-w-full items-center gap-1.5 rounded-full bg-charcoal/[0.045] py-1 pl-2 pr-2.5 text-[11px] font-medium text-charcoal transition hover:bg-charcoal/[0.09]"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0 text-charcoal-light transition group-hover:text-charcoal" />
                    <span className="whitespace-nowrap">在 Amazon 查看</span>
                    {amazonListing.label && (
                      <span className="min-w-0 truncate text-[10px] font-normal text-charcoal-light">
                        {amazonListing.label}
                      </span>
                    )}
                  </a>
                )}

                {isDataUrl && (
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] leading-relaxed text-amber-700">{t('Legacy uploaded image still in storage — replace it with a URL.')}</p>
                    <button
                      type="button"
                      onClick={() => patch('image', '')}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-cream-dark px-2.5 py-1 text-[10px] font-medium text-charcoal/70 transition hover:text-charcoal"
                    >
                      <Trash className="h-2.5 w-2.5" />{t('Clear')}</button>
                  </div>
                )}

                {imageError && <p className="text-[11px] text-red-500">{imageError}</p>}
              </div>
            </div>
          </div>

          {/* Everything that is not the photo, split in two on desktop:
              the form on the left, the ASIN block + stock on the right. An
              extra wrapper keeps the outer grid at two children — with three,
              the specs would land back under the photo. */}
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          {/* ── Form column: basics, visibility, options ── */}
          <div>
          {/* ── Basics ── */}
          <div className="mt-6 space-y-4 lg:mt-0">
            <Field label="货号 / Item code" hint="as it appears in your spreadsheet">
              <input
                type="text"
                value={draft.sku}
                onChange={(e) => patch('sku', e.target.value)}
                placeholder="AMZ-1003"
                className="input-field font-mono text-[13px]"
              />
              <p className="mt-1.5 text-[10px] leading-relaxed text-charcoal-light">
                {product.id ? (
                  <>
                    {t('Internal id')}
                    <span className="font-mono">{product.id}</span>
                    {' —— '}选品码存的就是它，所以永远不会变。改这里的货号会同步更新 ASIN
                    查询和之后所有导出。
                  </>
                ) : (
                  <>
                    内部 id 由数据库在保存时分配（<span className="font-mono">p140</span>、
                    <span className="font-mono">p141</span>…），之后永远不会变。
                  </>
                )}
              </p>
            </Field>

            <Field label="Name" hint="blank → uses the 货号">
              <input
                type="text"
                value={draft.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="Wool-Blend Wide-Leg Trousers"
                className="input-field text-[13px]"
              />
            </Field>

            {/* Category and Badge each get the full column. They used to sit
                side by side in two half-width cells, which was fine while a
                badge was one text box — but the quick-fill row needs ~370px
                to hold five pills on ONE line, and half a column wraps them
                into two ragged rows. Stacked, the badge area reads as one
                block: text, templates, swatches. */}
            <div className="space-y-4">
              <Field label="Category" hint="from the categories table">
                {newCategory ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={draft.category}
                      onChange={(e) => patch('category', e.target.value)}
                      placeholder={t('New category name')}
                      aria-label="New category name"
                      autoFocus
                      className="input-field text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setNewCategory(false)
                        patch('category', beforeNew)
                      }}
                      aria-label="Cancel new category"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
                    >
                      <Close className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <select
                    value={draft.category || UNCATEGORISED}
                    onChange={(e) => {
                      if (e.target.value === NEW_CATEGORY) {
                        setBeforeNew(draft.category || UNCATEGORISED)
                        setNewCategory(true)
                        patch('category', '')
                        return
                      }
                      patch('category', e.target.value)
                    }}
                    aria-label="Category"
                    className="input-field text-[13px]"
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>{t('＋ New category…')}</option>
                  </select>
                )}
              </Field>
              <div className="block">
                <span className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-light">{t('Badge')}<span className="font-normal tracking-normal text-charcoal-light/60">可选</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={draft.tag}
                    onChange={(e) => patch('tag', e.target.value)}
                    placeholder="New"
                    aria-label="Badge text"
                    className="input-field min-w-0 flex-1 text-[13px]"
                  />

                  {/* Native picker: zero dependencies, and it already knows the
                      OS palette. The visible square is the current colour, the
                      input itself is transparent on top of it. */}
                  <span
                    className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-charcoal/10"
                    style={{ backgroundColor: normaliseBadgeColor(draft.badgeColor) || '#2B2B2B' }}
                    title="Pick any colour"
                  >
                    <input
                      type="color"
                      value={normaliseBadgeColor(draft.badgeColor) || '#2B2B2B'}
                      onChange={(e) => patch('badgeColor', e.target.value.toUpperCase())}
                      aria-label="Badge colour"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </span>
                </div>

                {/* Templates — the five words this catalogue actually sorts by
                    ("is it new / does it sell / is it trending / must I have it /
                    can I get it again"). One click fills the text AND the
                    colour, because the word is a decision and the colour is
                    part of that decision: picking "Trending" and then hunting
                    for a violet hex is two jobs where there was one.

                    Editing the text afterwards keeps the colour on purpose —
                    "Trending" → "Trending Now" must not turn the badge grey.
                    The faint ring marks "the colour you have came from this
                    template" after the text drifts away from it, so the
                    operator can still see which one it was.

                    Each pill is drawn with `badgeStyle(value)` — the very
                    inline style the storefront badge uses — so the button is
                    a preview, not an approximation of one. */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-charcoal-light/60">{t('Quick fill')}</span>
                  {BADGE_TEMPLATES.map((tpl) => {
                    const hex = normaliseBadgeColor(draft.badgeColor)
                    const exact =
                      badgeTemplateMatch(draft.tag, draft.badgeColor)?.value === tpl.value
                    const colourOnly = !exact && hex === tpl.value
                    return (
                      <button
                        key={tpl.value}
                        type="button"
                        onClick={() => {
                          patch('tag', tpl.text)
                          patch('badgeColor', tpl.value)
                        }}
                        aria-label={`Badge template ${tpl.text} (${tpl.label})`}
                        aria-pressed={exact}
                        title={`${tpl.text} — ${tpl.label}. Fills the text and the colour; edit the text afterwards and the colour stays.`}
                        style={badgeStyle(tpl.value) || undefined}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                          exact
                            ? 'ring-2 ring-charcoal/70 ring-offset-1'
                            : colourOnly
                              ? 'ring-1 ring-charcoal/25 ring-offset-1'
                              : 'ring-1 ring-charcoal/10 hover:ring-charcoal/40'
                        }`}
                      >
                        {tpl.text}
                      </button>
                    )
                  })}
                </div>

                {/* Presets first — most badges are one of four meanings
                    (new / restock / sale / warning), and typing a hex code for
                    those is slower than one click. */}
                <div className="mt-1.5 flex items-center gap-1">
                  {BADGE_COLOR_PRESETS.map((preset) => {
                    const active = normaliseBadgeColor(draft.badgeColor) === preset.value
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => patch('badgeColor', preset.value)}
                        aria-label={`Badge colour ${preset.label}`}
                        aria-pressed={active}
                        title={preset.label}
                        style={{ backgroundColor: preset.value }}
                        className={`h-5 w-5 rounded-full transition ${
                          active
                            ? 'ring-2 ring-charcoal/70 ring-offset-1'
                            : 'ring-1 ring-charcoal/15 hover:ring-charcoal/40'
                        }`}
                      />
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => patch('badgeColor', '')}
                    aria-label="No badge colour"
                    title="Back to the default charcoal badge"
                    className={`ml-1 rounded-full px-2 py-0.5 text-[10px] transition ${
                      draft.badgeColor
                        ? 'text-charcoal-light hover:bg-cream-dark hover:text-charcoal'
                        : 'text-charcoal-light/40'
                    }`}
                  >{t('Default')}</button>
                </div>

                {/* The colour is a real column, and a database that has not run
                    `07-badge-color.sql` silently drops it on save. Saying nothing
                    is what produced "I set a colour and the storefront ignored
                    it" — so the editor says it, next to the swatches, and the
                    save toast says it again. */}
                {badgeColumnMissing && (
                  <p
                    data-badge-column-missing
                    className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200"
                  >
                    颜色暂时<strong>存不进去</strong>：数据库里没有{' '}
                    <code className="font-mono">badge_color</code> 列。先到 Supabase SQL Editor
                    跑一次 <code className="font-mono">supabase/07-badge-color.sql</code>，
                    再刷新这个页面。角标文字仍然照常保存。
                  </p>
                )}
              </div>

              {/* 副角标 —— 右上角那枚。
                  主角标回答"它现在是什么状态"（Coming Soon / ⚡ Deal / ACC），
                  副角标回答"运营想让你先看它"，两件事互不覆盖，所以是两块输入
                  而不是一个下拉。黑五期间一件商品会同时拥有
                  「⚡ 25% OFF」（左上，由 sale_* 算出）和「Black Friday」（右上）。
                  颜色规则与主角标完全一致（亮度选文字色，见 utils/badge.js）。 */}
              <div className="block">
                <span className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-light">大促标<span className="font-normal tracking-normal text-charcoal-light/60">第一行 · 可选</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={draft.subTag}
                    onChange={(e) => patch('subTag', e.target.value)}
                    placeholder="Black Friday"
                    aria-label="Secondary badge text"
                    className="input-field min-w-0 flex-1 text-[13px]"
                  />
                  <span
                    className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-charcoal/10"
                    style={{
                      backgroundColor: normaliseBadgeColor(draft.subBadgeColor) || '#2B2B2B',
                    }}
                    title="Pick any colour"
                  >
                    <input
                      type="color"
                      value={normaliseBadgeColor(draft.subBadgeColor) || '#2B2B2B'}
                      onChange={(e) => patch('subBadgeColor', e.target.value.toUpperCase())}
                      aria-label="Secondary badge colour"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </span>
                  {draft.subTag && (
                    <span
                      style={badgeStyle(draft.subBadgeColor) || undefined}
                      className={`shrink-0 truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        badgeStyle(draft.subBadgeColor) ? '' : 'bg-charcoal/80 text-cream'
                      }`}
                    >
                      {draft.subTag}
                    </span>
                  )}
                </div>

                {/* 两个一键文案：黑五主推就这么写，不该每次现打。颜色沿用
                    当前值，这样"先挑了红色再改文案"不会被冲掉。 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {['Black Friday', 'Cyber Monday'].map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => patch('subTag', word)}
                      aria-label={`Secondary badge quick fill ${word}`}
                      aria-pressed={draft.subTag === word}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        draft.subTag === word
                          ? 'bg-charcoal text-cream'
                          : 'bg-cream-dark text-charcoal/70 hover:text-charcoal'
                      }`}
                    >
                      {word}
                    </button>
                  ))}
                  {draft.subTag && (
                    <button
                      type="button"
                      onClick={() => patch('subTag', '')}
                      className="ml-1 text-[10px] text-charcoal-light transition hover:text-charcoal"
                    >{t('Clear')}</button>
                  )}
                </div>

                {subBadgeColumnMissing && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                    这块暂时<strong>存不进去</strong>：数据库里没有{' '}
                    <code className="font-mono">sub_tag</code> 列。先跑一次{' '}
                    <code className="font-mono">supabase/11-sub-badge-deal-priority.sql</code>，
                    再刷新页面。
                  </p>
                )}
              </div>
            </div>

            {/* Visibility — off the storefront, still in the catalogue */}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-charcoal/5">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-charcoal">
                  {draft.hidden ? '前台已隐藏' : '前台可见'}
                </div>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-charcoal-light">
                  {draft.hidden
                    ? '红人看不到它；已经引用了它的选品码照样能解出来。'
                    : '关掉只是暂停展示，不会删掉这个款。'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!draft.hidden}
                aria-label="Visible on storefront"
                onClick={() => patch('hidden', !draft.hidden)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                  draft.hidden ? 'bg-charcoal/20' : 'bg-accent'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                    draft.hidden ? 'left-0.5' : 'left-[22px]'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* ── Specs ── */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Options')}</div>
                <p className="mt-1 text-[11px] text-charcoal-light/80">{t('Colour, size, anything. Creators pick one of each.')}</p>
              </div>
              <button
                type="button"
                onClick={addSpecType}
                className="flex items-center gap-1 rounded-full bg-cream-dark px-3 py-1.5 text-[11px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95"
              >
                <Plus className="h-3 w-3" />{t('Group')}</button>
            </div>

            <div className="mt-3 space-y-3">
              {draft.specs.length === 0 && (
                <p className="rounded-xl bg-cream-dark/60 px-3 py-3 text-[11px] text-charcoal-light">{t('No options — this product is one-size / single variant.')}</p>
              )}

              {draft.specs.map((group, gi) => {
                const colourGroup = isColourType(group.type)
                const sizeGroup = isSizeType(group.type)

                /* Display order only. `draft.specs` and the array written on
                 * save keep the order the admin typed — that array is what a
                 * legacy v1/v2 selection code resolves against, so rewriting it
                 * would re-point codes already in the wild. Sorting indexes
                 * (not values) is what keeps the inputs, and the image URL next
                 * to each one, attached to the right option.
                 *
                 * A frozen order can be one option short: the "Add" button
                 * appends while the group is focused. Anything the snapshot
                 * does not mention is appended, and anything it mentions that
                 * has since been deleted is dropped. */
                const typedOrder = group.options.map((_, index) => index)
                let order = typedOrder

                if (sizeGroup) {
                  if (frozenOrder && frozenOrder.gi === gi) {
                    const seen = new Set(frozenOrder.order)
                    order = [
                      ...frozenOrder.order.filter((index) => index < group.options.length),
                      ...typedOrder.filter((index) => !seen.has(index)),
                    ]
                  } else {
                    order = sizeOrder(group.options)
                  }
                }

                const reordered = order.some((value, index) => value !== index)

                return (
                  <div
                    key={gi}
                    className="rounded-xl bg-white p-3 ring-1 ring-charcoal/5"
                    onFocusCapture={() => {
                      /* Snapshot what is on screen right now, so entering the
                       * group does not reshuffle it either. */
                      if (sizeGroup && !(frozenOrder && frozenOrder.gi === gi)) {
                        setFrozenOrder({ gi, order: sizeOrder(group.options) })
                      }
                    }}
                    onBlurCapture={(event) => {
                      /* Moving between two fields in the same card is not
                       * "leaving the group" — only re-sort once focus is
                       * outside it, otherwise tabbing between chips reshuffles
                       * them one by one. */
                      if (!event.currentTarget.contains(event.relatedTarget)) setFrozenOrder(null)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={group.type}
                        onChange={(e) => setSpecType(gi, e.target.value)}
                        placeholder={t('Colour')}
                        aria-label={`Option group ${gi + 1} name`}
                        className="min-w-0 flex-1 rounded-lg bg-cream-dark px-2.5 py-1.5 text-[12px] font-medium text-charcoal placeholder:font-normal placeholder:text-charcoal-light/60 focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => removeSpecType(gi)}
                        aria-label="Remove option group"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-charcoal-light transition hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {colourGroup && (
                      <p className="mt-2 text-[10px] leading-relaxed text-charcoal-light">{t('Optional image URL per colour. Leave blank to use the main image.')}</p>
                    )}

                    {/* Colour options get a URL field + live thumbnail; every
                        other group stays a compact chip row. */}
                    {colourGroup ? (
                      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {order.map((oi) => {
                          const option = group.options[oi]
                          const url = String(group.images[oi] || '').trim()
                          return (
                            <div
                              key={oi}
                              /* Draggable as a whole card, not just the
                                 thumbnail: the gesture is "take this colour's
                                 photo", and the operator grabs whatever part
                                 of the card their cursor happens to be on.
                                 The inputs inside are NOT draggable
                                 ancestors' children that start a text
                                 selection instead — so typing in the name or
                                 the URL field still works normally. */
                              draggable
                              onDragStart={(event) => {
                                writeVariantDrag(event.dataTransfer, {
                                  url,
                                  colour: option,
                                })
                                event.dataTransfer.effectAllowed = 'copy'
                                setDraggingOption(oi)
                              }}
                              onDragEnd={() => setDraggingOption(null)}
                              data-drag-colour={option || ''}
                              className={`rounded-lg bg-cream-dark/60 p-1.5 transition ${
                                draggingOption === oi ? 'opacity-40' : ''
                              }`}
                            >
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-charcoal/5"
                                    title={
                                      url
                                        ? 'Drag onto the main image above to use this photo there'
                                        : 'No photo for this colour yet'
                                    }
                                  >
                                    {url ? (
                                      <ProductImage
                                        src={url}
                                        fallback={draft.image}
                                        alt={option || 'Variant'}
                                        loading="eager"
                                        className="h-full w-full object-contain"
                                      />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-charcoal-light/30">
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </div>
                                    )}
                                  </div>

                                  <input
                                    type="text"
                                    value={option}
                                    onChange={(e) => setOption(gi, oi, e.target.value)}
                                    placeholder="Oatmeal"
                                    aria-label={`${group.type || 'Option'} value ${oi + 1}`}
                                    className="min-w-0 flex-1 bg-transparent text-[11px] text-charcoal placeholder:text-charcoal-light/50 focus:outline-none"
                                  />

                                  {/* The same action as the drag, without the
                                      drag: keyboard reachable, and the only
                                      way in on a touch screen where HTML5
                                      drag-and-drop does not exist. */}
                                  <button
                                    type="button"
                                    onClick={() => useVariantAsMain(url, option)}
                                    aria-label={`Use ${option || 'this colour'} as the main image`}
                                    title="Use this photo as the main image"
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-white hover:text-accent"
                                  >
                                    <ArrowToTop className="h-3 w-3" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => removeOption(gi, oi)}
                                    aria-label="Remove option"
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-white hover:text-red-500"
                                  >
                                    <Close className="h-2.5 w-2.5" />
                                  </button>
                                </div>

                              <input
                                type="text"
                                value={group.images[oi] || ''}
                                onChange={(e) => setOptionImage(gi, oi, e.target.value)}
                                placeholder={t('Image URL (optional)')}
                                aria-label={`Image URL for ${option || 'this colour'}`}
                                className="mt-1.5 w-full rounded-md bg-white px-2 py-1 text-[10px] text-charcoal placeholder:text-charcoal-light/45 focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            </div>
                          )
                        })}

                        <button
                          type="button"
                          onClick={() => addOption(gi)}
                          className="flex items-center justify-center gap-0.5 rounded-lg border border-dashed border-charcoal/20 px-2.5 py-2 text-[11px] text-charcoal-light transition hover:border-charcoal/40 hover:text-charcoal"
                        >
                          <Plus className="h-2.5 w-2.5" />{t('Add colour')}</button>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {order.map((oi) => {
                          const option = group.options[oi]
                          return (
                            <div
                              key={oi}
                              className="group flex items-center gap-1 rounded-full bg-cream-dark pl-2.5 pr-1 py-1"
                            >
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => setOption(gi, oi, e.target.value)}
                                placeholder="M"
                                aria-label={`${group.type || 'Option'} value ${oi + 1}`}
                                className="w-[72px] bg-transparent text-[11px] text-charcoal placeholder:text-charcoal-light/50 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => removeOption(gi, oi)}
                                aria-label="Remove option"
                                className="flex h-4 w-4 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-white hover:text-red-500"
                              >
                                <Close className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )
                        })}

                        <button
                          type="button"
                          onClick={() => addOption(gi)}
                          className="flex items-center gap-0.5 rounded-full border border-dashed border-charcoal/20 px-2.5 py-1 text-[11px] text-charcoal-light transition hover:border-charcoal/40 hover:text-charcoal"
                        >
                          <Plus className="h-2.5 w-2.5" />{t('Add')}</button>
                      </div>
                    )}

                    {/* Says out loud what the reshuffle is, so a list that
                        tidies itself on blur does not read as a data change. */}
                    {sizeGroup && reordered && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-charcoal-light/70">{t('Shown smallest → largest. The order you typed is what gets saved.')}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {variantCount > 0 && (
              <p className="mt-2 text-[10px] text-charcoal-light">
                {variantCount} colour {variantCount === 1 ? 'photo' : 'photos'} set · these
                swap on the storefront when a creator picks that colour.
              </p>
            )}
          </div>
          </div>
          {/* ── ASIN column: the block that must not be missed ──
              Top of its own column, so it is on screen when the dialog opens
              instead of 506px below it. Stock sits underneath because both
              answer the same question: "can this combination be ordered?" */}
          <div className="lg:sticky lg:top-2">
          {/* ── ASINs ── */}
          <AsinSection
            key={`asin-${product.id}`}
            savedSku={savedSku}
            draftSku={draft.sku.trim()}
            ready={asinsReady}
            rows={asinRows}
            extras={asinExtras}
            missing={asinMissing}
            renames={renameNotes}
            blurred={asinBlurred}
            onEdit={(key, value) => setAsinEdits((prev) => ({ ...prev, [key]: value }))}
            onBlur={(key) => setAsinBlurred((prev) => ({ ...prev, [key]: true }))}
            onClear={(key) => setAsinEdits((prev) => ({ ...prev, [key]: '' }))}
          />

          {/* ── Coming Soon (Teaser) ──
              Above Stock on purpose: it is a transaction lock, not a stock cell,
              so it has to be visible without expanding anything. */}
          <TeaserSection
            isTeaser={Boolean(draft.isTeaser)}
            onChange={(next) => patch('isTeaser', next)}
            columnMissing={teaserColumnMissing}
          />

          {/* ── Limited Deal ──
              Directly under Coming Soon, and collapsible: a window is three
              numbers an operator sets a few times a week, while Stock is
              touched every day. Keeping it folded by default keeps the column
              short for the 99% of products that have no deal.
              It opens automatically when a product already has one, because a
              live sale you cannot see in the editor is a support ticket. */}
          <DealSection
            value={draft}
            onChange={patch}
            open={draft.dealArmed}
            teaser={Boolean(draft.isTeaser)}
            /* 库里存的那一刻，不是草稿里的日期 —— 草稿里已经把时刻裁掉了，
             * 只有原始值才能看出"这条要被我改写"。 */
            legacy={legacyDealTimes(product)}
            columnMissing={dealColumnMissing}
            priorityColumnMissing={priorityColumnMissing}
          />

          {/* ── ACC（Amazon Creator Connections）──
              A long-running status, not an event: it stays on for the whole
              campaign, so it sits below the two cards that own the calendar. */}
          <AccSection
            hasAcc={Boolean(draft.hasAcc)}
            accId={draft.accId}
            onChange={patch}
            columnMissing={accColumnMissing}
          />

          {/* ── Stock ── */}
          <StockSection
            key={product.id}
            product={draftProduct}
            soldOut={draft.soldOut}
            onChange={(next) => patch('soldOut', next)}
          />
          </div>
          </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-charcoal/[0.07] bg-cream px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:pb-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full bg-cream-dark py-3 text-[13px] font-medium text-charcoal/70 transition hover:text-charcoal"
            >{t('Cancel')}</button>
            <button
              type="button"
              onClick={handleSave}
              className="flex flex-[1.6] items-center justify-center gap-2 rounded-full bg-accent py-3 text-[13px] font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent-dark active:scale-[0.98]"
            >
              {isNew ? '创建商品' : '保存修改'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────── helpers ───────────────── */

/**
 * `{ Type: [options] }` from the draft's editable groups — what the save would
 * write, with empty groups and empty options dropped.
 *
 * Shared by the save path, the combination check and the variant-rename plan,
 * so "which combinations does this draft have" is only answered in one place.
 */
function specMapOf(groups) {
  const specs = {}
  for (const group of groups || []) {
    const type = String(group.type || '').trim()
    if (!type) continue
    const options = (group.options || []).map((option) => String(option).trim()).filter(Boolean)
    if (options.length) specs[type] = options
  }
  return specs
}

/**
 * Lowercased `colour|size` keys for a draft, before it is saved.
 * Mirrors what `combinationsOf` does to a saved product, so the ASIN panel can
 * be validated in `handleSave` without depending on the render-time block.
 */
function draftComboKeys(draft) {
  return combinationsOf({ specs: specMapOf(draft?.specs) }).map((combo) => combo.key.toLowerCase())
}

/** Product → editable draft (specs as an array to keep ordering stable) */
function toDraft(product) {
  const variantImages = product?.variantImages || {}

  return {
    sku: product?.sku || '',
    name: product?.name || '',
    category: product?.category || UNCATEGORISED,
    tag: product?.tag || '',
    badgeColor: product?.badgeColor || '',
    /* 副角标（右上角）。和 tag 完全独立 —— 黑五期间两枚要同时在。 */
    subTag: product?.subTag || '',
    subBadgeColor: product?.subBadgeColor || '',
    /* 专区置顶权重。存的是数字，输入框要字符串；空 = 不置顶。 */
    dealPriority: product?.dealPriority ? String(product.dealPriority) : '',
    image: product?.image || '',
    hidden: Boolean(product?.hidden),
    isTeaser: Boolean(product?.isTeaser),
    /* ACC —— 开关只存布尔，ID 不跟开关联动（关掉时保留，理由见 utils/acc.js）。 */
    hasAcc: Boolean(product?.hasAcc),
    accId: product?.accId || '',
    /* Flash sale. `dealArmed` is FORM state, not a column: the table has only
     * the five text fields, so "on" means "these five get written". Deriving
     * the switch from the data (rather than storing a flag) means reopening a
     * product that already has a window shows the card open, which is what the
     * operator expects to see. See supabase/09-deal.sql for why there is no
     * boolean column. */
    dealArmed: ['saleStart', 'saleEnd', 'salePrice', 'originalPrice', 'discountLabel'].some(
      (key) => String(product?.[key] ?? '').trim() !== '',
    ),
    /* 日期输入框只认 `YYYY-MM-DD`，所以库里带时刻的值在这里裁掉时刻。
     * 保存时会重新拼上 00:00:00 / 23:59:59（见 onSubmit 的 savedDeal）。 */
    saleStart: toDateInput(product?.saleStart),
    saleEnd: toDateInput(product?.saleEnd),
    salePrice: product?.salePrice || '',
    originalPrice: product?.originalPrice || '',
    discountLabel: product?.discountLabel || '',
    /* 已经手改过（和自动算出来的不一样）就别在第一次失焦时吃掉它。 */
    labelTouched:
      String(product?.discountLabel ?? '').trim() !== '' &&
      String(product?.discountLabel ?? '').trim() !==
        autoDiscountLabelFor(product?.originalPrice, product?.salePrice),
    soldOut: normalizeSoldOut(product?.soldOutVariants),
    specs: Object.entries(product?.specs || {}).map(([type, options]) => {
      const list = Array.isArray(options) ? [...options] : [options]
      const byOption = variantImages[type] || {}
      return {
        type,
        options: list,
        // Parallel to `options` — see setOptionImage for why it is positional
        images: list.map((option) => byOption[option] || ''),
      }
    }),
  }
}

/**
 * Sold-out grid
 * ─────────────
 * Colour rows × size columns, one cell per orderable combination.
 *
 * Ticking a cell writes one combination key (`"Green|M"`) into
 * `sold_out_variants`. Ticking a colour or size name writes every key on that
 * line — that is the "Green is out" action, implemented as N writes rather than
 * a second, colour-level storage format. One representation means one place
 * where "is this in stock" can be answered, and no precedence rules to get
 * wrong later.
 *
 * Collapsed by default: a 20 × 7 product is 140 cells, and most editing
 * sessions never touch stock.
 */
/**
 * Coming Soon (Teaser) — a transaction lock, not a badge.
 *
 * Marking a style here does three things on the storefront: the card shows the
 * Coming Soon badge (instead of its normal tag), every size button is disabled,
 * and the add button becomes a disabled "Coming Soon". It is deliberately a
 * product-level flag rather than a `tag`, because tags are free text ops edits
 * daily and a string cannot be trusted to gate a purchase.
 */
function TeaserSection({ isTeaser, onChange, columnMissing }) {
  return (
    <div className="mt-6 rounded-xl bg-white px-3 py-2.5 ring-1 ring-charcoal/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Coming Soon (Teaser)')}</span>
            {isTeaser && (
              <span className="rounded-full bg-charcoal px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cream">开启中</span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-charcoal-light">前台能看到，但尺码锁住、不能加入选品单。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isTeaser}
          aria-label="Coming Soon (Teaser)"
          onClick={() => onChange(!isTeaser)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            isTeaser ? 'bg-charcoal' : 'bg-charcoal/20'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              isTeaser ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {columnMissing && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          is_teaser 列不存在，这个开关存不进去。先在 Supabase 跑一次
          supabase/08-teaser.sql。
        </p>
      )}
    </div>
  )
}

/**
 * Limited Deal
 * ─────────────
 * Five text fields, no date picker and no timezone: the operator types
 * `2026-10-28T10:00` and that exact string goes to the database. A native
 * `datetime-local` input would look nicer but hands back a value the browser
 * has already normalised, which is the one thing 09-deal.sql exists to avoid.
 *
 * The switch is not a column. "On" means these five get written; "off" writes
 * five empty strings (→ NULL). That is why the header says "Off" next to a
 * product that has times but is switched off — what you see is what will save.
 */
const DEAL_STATUS = {
  off: { label: '已关闭', tone: 'text-charcoal-light' },
  incomplete: { label: '日期没填全', tone: 'text-amber-700' },
  invalid: { label: '结束早于开始', tone: 'text-amber-700' },
  scheduled: { label: '排期中', tone: 'text-sky-700' },
  live: { label: '进行中', tone: 'text-red-600' },
  ended: { label: '已结束', tone: 'text-charcoal-light' },
}

/** `2026-10-28T10:00` / `2026/10/28` → `2026-10-28`（`<input type="date">` 的格式） */
function toDateInput(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const normalised = text.replace(/\//g, '-')
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(normalised)
  if (!match) return ''
  const [, y, m, d] = match
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 日历上的"某天" → 数据库里的窗口端点。日期由人点，时刻由这里定。 */
const startStamp = (date) => (date ? `${date}T00:00:00` : '')
const endStamp = (date) => (date ? `${date}T23:59:59` : '')

function DealSection({ value, onChange, open: initiallyOpen, teaser, legacy, columnMissing, priorityColumnMissing }) {
  /* Collapse state is local and only seeded once: arming the switch must reveal
   * the fields, but folding the card must not clear them — the values still go
   * to the database on save. */
  const [open, setOpen] = useState(Boolean(initiallyOpen))

  const armed = Boolean(value.dealArmed)
  /* 预览用的是"保存后会变成什么"，不是输入框里的裸日期：结束日只有日期时，
   * 内存里的窗口是 23:59:59，而不是那一天的 00:00 —— 差一天会让状态显示错。 */
  const status = dealStatus({
    saleStart: startStamp(value.saleStart),
    saleEnd: endStamp(value.saleEnd),
  })
  const tone = DEAL_STATUS[status] || DEAL_STATUS.off
  const price = formatPriceText(value.salePrice)
  const was = formatPriceText(value.originalPrice)
  const auto = autoDiscountLabelFor(value.originalPrice, value.salePrice)

  const set = (key) => (event) => onChange(key, event.target.value)

  /* 自动算标签：只在运营没手动改过的时候写。改过就永远不覆盖 —— 后台覆盖
   * 标签是运营的"最后决定权"，被一次失焦冲掉比算不出来更糟。 */
  const recalc = () => {
    if (value.labelTouched) return
    if (value.discountLabel === auto) return
    onChange('discountLabel', auto)
  }

  const toggle = () => {
    const next = !armed
    onChange('dealArmed', next)
    if (next) setOpen(true)
  }

  /* 这条记录存着具体时刻时，保存会把它改写成整天的边界。提示只在真的会变
   * 的时候出现 —— 一条天天挂着的警告会被读成装饰。 */
  const legacyText = legacy
    ? [legacy.start && `starts ${legacy.start}`, legacy.end && `ends ${legacy.end}`]
        .filter(Boolean)
        .join(', ')
    : ''

  return (
    <div className="mt-6 rounded-xl bg-white ring-1 ring-charcoal/5">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Limited Deal')}</span>
          <span className={`text-[10px] font-medium ${tone.tone}`}>{tone.label}</span>
          {armed && auto && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">
              {auto}
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-charcoal-light transition ${open ? 'rotate-180' : ''}`}
          />
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={armed}
          aria-label="Limited Deal"
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            armed ? 'bg-red-600' : 'bg-charcoal/20'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              armed ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {!open && !armed && (
        <p className="px-3 pb-2.5 text-[10px] leading-relaxed text-charcoal-light">到了你设的时间窗就自动生效。关掉等于不存这两列 —— 下面的日期会被清空。</p>
      )}

      {open && (
        <div className="space-y-2.5 border-t border-charcoal/[0.06] px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-medium text-charcoal-light">{t('Starts')}</span>
              <input
                type="date"
                value={value.saleStart}
                onChange={set('saleStart')}
                aria-label="Sale start"
                className="input-field mt-1 text-[12px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-charcoal-light">{t('Ends')}</span>
              <input
                type="date"
                value={value.saleEnd}
                onChange={set('saleEnd')}
                aria-label="Sale end"
                className="input-field mt-1 text-[12px]"
              />
            </label>
          </div>

          <p className="text-[10px] leading-relaxed text-charcoal-light">
            只选日期 —— 天就是单位。开始存成{' '}
            <span className="font-medium text-charcoal/70">00:00:00</span>，结束存成{' '}
            <span className="font-medium text-charcoal/70">23:59:59</span>，
            不做时区换算：红人手机上的几点就是几点。之前手填的旧时间戳，
            下次保存时会被改写成这两个值。
          </p>

          {armed && legacyText && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              This product is stored with a specific time ({legacyText}). Saving
              rewrites it to 00:00:00 / 23:59:59 — the dates above already show the
              day it belongs to.
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] font-medium text-charcoal-light">原价</span>
              <input
                type="text"
                value={value.originalPrice}
                onChange={set('originalPrice')}
                onBlur={recalc}
                placeholder="39.99 / 30-50"
                aria-label="Original price"
                className="input-field mt-1 text-[12px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-charcoal-light">{t('Now')}</span>
              <input
                type="text"
                value={value.salePrice}
                onChange={set('salePrice')}
                onBlur={recalc}
                placeholder="19.99 / 15-25"
                aria-label="Sale price"
                className="input-field mt-1 text-[12px]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-medium text-charcoal-light">{t('Label')}</span>
              <input
                type="text"
                value={value.discountLabel}
                onChange={(event) => {
                  onChange('discountLabel', event.target.value)
                  /* 手改过就不再自动覆盖；留空表示"回到自动"。 */
                  onChange('labelTouched', event.target.value.trim() !== '')
                }}
                placeholder={auto || '50% OFF'}
                aria-label="Discount label"
                className="input-field mt-1 text-[12px]"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] leading-relaxed text-charcoal-light">
            <span>
              {auto ? (
                <>
                  Calculated from the prices:{' '}
                  <span className="font-medium text-charcoal/70">{auto}</span>
                  {value.labelTouched && ' · overridden below'}
                </>
              ) : (
                'Fill both prices and the label is calculated for you.'
              )}
            </span>
            {value.labelTouched && auto && (
              <button
                type="button"
                onClick={() => {
                  onChange('discountLabel', auto)
                  onChange('labelTouched', false)
                }}
                className="shrink-0 rounded-full bg-cream-dark px-2 py-1 text-[10px] font-medium text-charcoal/70 transition hover:text-charcoal"
              >{t('Use auto')}</button>
            )}
          </div>

          <p className="text-[10px] leading-relaxed text-charcoal-light">
            卡片上显示 <span className="font-medium text-charcoal/70">{auto || '折扣'}</span>。
            两个价格都可以写区间（`30-50`），数字按你填的原样展示 ——
            前台不会用自己的算法改写它。
          </p>

          {/* 专区置顶 —— 只在 ⚡ Limited Deal 里生效，不动常规货架。
              放在价格下面是刻意的：它属于"这场活动怎么排"，不属于商品本身。 */}
          <div className="flex items-start gap-2">
            <label className="block w-24 shrink-0">
              <span className="text-[10px] font-medium text-charcoal-light">{t('Pin')}</span>
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={value.dealPriority ?? ''}
                onChange={set('dealPriority')}
                placeholder="0"
                aria-label="Deal priority"
                className="input-field mt-1 text-[12px]"
              />
            </label>
            <p className="mt-4 min-w-0 flex-1 text-[10px] leading-relaxed text-charcoal-light">
              数值越大越靠前（只在秒杀专区内生效）。填 0 就按原来的"最快结束排最前"。
            </p>
          </div>

          {priorityColumnMissing && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              置顶暂时<strong>存不进去</strong>：数据库里没有{' '}
              <code className="font-mono">deal_priority</code> 列。先跑一次{' '}
              <code className="font-mono">supabase/11-sub-badge-deal-priority.sql</code>，
              再刷新页面。
            </p>
          )}

          {/* Live preview of what the storefront will actually do right now. */}
          <p className="rounded-lg bg-cream-dark/60 px-2 py-1.5 text-[10px] leading-relaxed text-charcoal/70">
            {!armed
              ? '已关闭 —— 前台什么都不显示。'
              : status === 'live'
                ? `进行中 —— 角标 + ${price || '无价格'}${was ? `（原价 ${was}）` : ''}，倒计时到结束。`
                : status === 'scheduled'
                  ? '排期中 —— 开始之前显示"Deal starts in"，到点自动变成进行中。'
                  : status === 'ended'
                    ? '已结束 —— 前台把它当普通商品。'
                    : status === 'invalid'
                      ? '结束日期必须晚于或等于开始日期。'
                      : '两个日期都要填 —— 只有一半的时间窗永远不会生效。'}
          </p>

          {teaser && armed && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">Coming Soon 优先：预告期间前台显示锁，不出秒杀价。日期会保留下来，取消 Coming Soon 之后秒杀就回来了。</p>
          )}

          {columnMissing && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              sale_* 列不存在，这些字段存不进去。先在 Supabase 跑一次
              supabase/09-deal.sql。
            </p>
          )}
        </div>
      )}
    </div>
  )
}


/**
 * ACC（Amazon Creator Connections）
 * ─────────────────────────────────
 * One switch and one text field. The switch is a real boolean column (`has_acc`)
 * rather than something derived from the ID being non-empty, because a campaign
 * can be approved before the ID is copied over — and "approved, ID pending"
 * must still show the badge (see utils/acc.js).
 *
 * The ID is deliberately NOT cleared when the switch goes off. It is an asset
 * the operator cannot regenerate; re-typing it from the Amazon console because
 * of a mis-click is the kind of small loss that makes a tool feel hostile.
 *
 * Folded by default for the same reason as the deal card: most products never
 * touch this, and the column already has five cards above the fold.
 */
function AccSection({ hasAcc, accId, onChange, columnMissing }) {
  const stored = String(accId ?? '').trim()
  /* Open on arrival when the product already carries ACC state — a campaign you
   * cannot see in the editor is one you will forget to turn off. */
  const [open, setOpen] = useState(Boolean(hasAcc || stored))

  const toggle = () => {
    const next = !hasAcc
    onChange('hasAcc', next)
    if (next) setOpen(true)
  }

  return (
    <div className="mt-6 rounded-xl bg-white ring-1 ring-charcoal/5">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Amazon Creator Connections')}</span>
          <span
            className={`text-[10px] font-medium ${hasAcc ? 'text-amber-700' : 'text-charcoal-light'}`}
          >
            {hasAcc ? 'On' : 'Off'}
          </span>
          {hasAcc && stored && (
            <span className="max-w-[88px] truncate rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
              {stored}
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-charcoal-light transition ${open ? 'rotate-180' : ''}`}
          />
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={hasAcc}
          aria-label="Amazon Creator Connections"
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            hasAcc ? 'bg-amber-700' : 'bg-charcoal/20'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              hasAcc ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {!open && !hasAcc && (
        <p className="px-3 pb-2.5 text-[10px] leading-relaxed text-charcoal-light">开启后详情页会出现一张 ACC 卡片（带复制按钮）。商品卡片上不显示 ACC 角标。</p>
      )}

      {open && (
        <div className="space-y-2.5 border-t border-charcoal/[0.06] px-3 py-3">
          <label className="block">
            <span className="text-[10px] font-medium text-charcoal-light">{t('Campaign ID')}</span>
            <input
              type="text"
              value={accId}
              onChange={(event) => onChange('accId', event.target.value)}
              placeholder="e.g. 7c1f3a2b-9d4e-4c6a-b0f2-1a2b3c4d5e6f"
              aria-label="ACC campaign ID"
              className="input-field mt-1 font-mono text-[12px]"
            />
          </label>

          <p className="text-[10px] leading-relaxed text-charcoal-light">
            详情页会显示这个 ID，旁边有一个
            <span className="font-medium text-charcoal/70">{t('Copy ID')}</span> 按钮。
            关掉开关会把卡片一起隐藏，但 ID 会留着 —— 别处没有存它的地方。
          </p>

          {hasAcc && !stored && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">开了开关但没填 Campaign ID：详情页仍会出现 ACC 卡片，并注明 ID 待补。等活动批下来再把 ID 填在这里。</p>
          )}

          {columnMissing && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
              has_acc / acc_id 列不存在，这个开关存不进去。先在 Supabase 跑一次
              supabase/10-acc.sql。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function StockSection({ product, soldOut, onChange }) {
  const [open, setOpen] = useState(false)

  const combos = combinationsOf(product)
  const colours = colourAxisOf(product).options
  const sizes = sizeAxisOf(product).options
  const keys = soldOutKeysOf(product)
  const summary = soldOutSummary(product)

  const toggleCombo = (key) => onChange(withKeySoldOut(soldOut, key, !keys.has(key.toLowerCase())))
  const toggleAxis = (axis, value) => onChange(toggleAxisSoldOut(soldOut, product, axis, value))

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 text-left ring-1 ring-charcoal/5 transition hover:ring-charcoal/15"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('Stock')}</span>
          <span
            className={`truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              summary.soldOut ? 'bg-red-50 text-red-500' : 'bg-cream-dark text-charcoal-light'
            }`}
          >
            {zhStockSummary(summaryLabel(product))}
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-charcoal-light" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-charcoal-light" />
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-xl bg-white p-3 ring-1 ring-charcoal/5">
          {!combos.length ? (
            <p className="text-[11px] text-charcoal-light">{t('Add a colour or a size above first — there is nothing to mark yet.')}</p>
          ) : (
            <>
              <p className="text-[10px] leading-relaxed text-charcoal-light">勾掉断货的组合。这些组合仍留在前台，只是变灰、不可选 —— 其余组合照常可买。点颜色名或尺码名可以整行切换。</p>

              {/* One axis only — a single row of chips, not a 1 × N table */}
              {!colours.length || !sizes.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(colours.length ? colours : sizes).map((value) => {
                    const axis = colours.length ? 'colour' : 'size'
                    const key = variantKey(
                      colours.length ? value : '',
                      colours.length ? '' : value,
                    )
                    const gone = keys.has(key.toLowerCase())
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleAxis(axis, value)}
                        aria-pressed={gone}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${
                          gone
                            ? 'bg-red-50 text-red-500 ring-1 ring-red-200'
                            : 'bg-cream-dark text-charcoal hover:bg-cream-dark/70'
                        }`}
                      >
                        {value}
                        {gone && <span className="ml-1 opacity-70">（断货）</span>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-2 overflow-x-auto pb-1">
                  <table className="w-full border-separate border-spacing-[3px]">
                    <thead>
                      <tr>
                        <th aria-label="Colour" />
                        {sizes.map((size) => (
                          <th key={size}>
                            <button
                              type="button"
                              onClick={() => toggleAxis('size', size)}
                              title={`Toggle every colour in ${size}`}
                              className="w-full rounded px-1 py-1 text-[10px] font-medium text-charcoal-light transition hover:bg-cream-dark hover:text-charcoal"
                            >
                              {size}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {colours.map((colour) => (
                        <tr key={colour}>
                          <th className="max-w-[92px] pr-1">
                            <button
                              type="button"
                              onClick={() => toggleAxis('colour', colour)}
                              title={`Toggle every size in ${colour}`}
                              className="w-full truncate rounded px-1 py-1 text-left text-[10px] font-medium text-charcoal transition hover:bg-cream-dark"
                            >
                              {colour}
                            </button>
                          </th>
                          {sizes.map((size) => {
                            const key = variantKey(colour, size)
                            const gone = keys.has(key.toLowerCase())
                            return (
                              <td key={size}>
                                <button
                                  type="button"
                                  onClick={() => toggleCombo(key)}
                                  aria-pressed={gone}
                                  aria-label={`${colour} ${size} sold out`}
                                  className={`flex h-6 w-full items-center justify-center rounded transition active:scale-90 ${
                                    gone
                                      ? 'bg-red-500 text-white hover:bg-red-600'
                                      : 'bg-cream-dark/70 hover:bg-cream-dark'
                                  }`}
                                >
                                  {gone && <Check className="h-2.5 w-2.5" />}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[10px] text-charcoal-light/70">
                  {combos.length} {combos.length === 1 ? 'combination' : 'combinations'}
                </span>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  disabled={!soldOut.length}
                  className="rounded-full bg-cream-dark px-2.5 py-1 text-[10px] font-medium text-charcoal transition hover:bg-cream-dark/70 disabled:cursor-not-allowed disabled:text-charcoal/30"
                >{t('All available')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ASIN panel
 * ──────────
 * One input per colour × size combination, so "which of these has no ASIN yet"
 * is answerable without opening the database. Missing is the interesting state:
 * a combination without an ASIN can still be picked by a creator, and ops then
 * has nothing to order — the failure shows up days later at the packing table.
 *
 * WHAT IS NOT HERE
 * ────────────────
 * No "fill all" and no "delete all". Both would be one click away from writing
 * the same ASIN into nine listings, and one of those listings is never the
 * right one. Each field is deliberate.
 *
 * The extras block exists because the merge is additive: keys from earlier
 * imports that no longer match a current option stay in the database. Hiding
 * them would leave rows nobody can ever see, let alone clear.
 */
function AsinSection({ savedSku, draftSku, ready, rows, extras, missing, renames = [], blurred, onEdit, onBlur, onClear }) {
  const filled = rows.length - missing
  const invalid = rows.filter((row) => row.asin && blurred[row.key] && !isValidAsin(row.asin))
  const renaming = Boolean(draftSku && savedSku && draftSku !== savedSku)
  const carriedAsins = renames.reduce((sum, rename) => sum + rename.count, 0)

  const state = !ready ? 'unavailable' : !draftSku ? 'nosku' : !rows.length ? 'nocombo' : 'ready'

  /* When a colour/size is added the list grows — and the new rows are appended
   * at the BOTTOM of a scroll-capped box, so the fields the user just asked for
   * sit out of sight behind a scroll they have no reason to expect. Bring the
   * first genuinely new row into view.
   *
   * "New" here means "was not in the list a moment ago", NOT the `new` badge:
   * that badge compares against the stored ASIN map, and on a product with 23
   * missing ASINs the first badged row is at the very top — scrolling to it
   * would do nothing at all. Only fires when the count grows, so typing a
   * colour name does not yank the list once per keystroke. */
  const listRef = useRef(null)
  const knownKeys = useRef(new Set(rows.map((row) => row.key)))
  const lastCount = useRef(rows.length)

  useEffect(() => {
    if (rows.length > lastCount.current) {
      const added = rows.find((row) => !knownKeys.current.has(row.key))
      if (added) {
        const target = listRef.current?.querySelector(`[data-key="${added.key}"]`)
        target?.scrollIntoView({ block: 'nearest' })
      }
    }
    lastCount.current = rows.length
    knownKeys.current = new Set(rows.map((row) => row.key))
  })

  return (
    /* Not collapsible, on purpose. This block used to be a `<button
     * aria-expanded>` that happened to default to open — so it was both
     * dismissible by a stray click and, because it lived under the long options
     * list, 500px below the fold. Now it is the top of its own column and
     * always on: a combination with no ASIN cannot be ordered, and that is not
     * a fact worth hiding behind a chevron. */
    <section
      aria-label="ASINs"
      className="mt-6 rounded-xl bg-white p-3 ring-1 ring-charcoal/5 lg:mt-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-medium tracking-wider text-charcoal-light">{t('ASINs')}</span>
          {state === 'ready' ? (
            <span
              className={`truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                missing ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {missing ? `缺 ${missing} 个` : `已填 ${filled} / ${rows.length}`}
            </span>
          ) : (
            <span className="truncate text-[10px] text-charcoal-light">
              {state === 'unavailable'
                ? 'could not be loaded'
                : state === 'nosku'
                  ? 'needs a 货号'
                  : 'no combinations'}
            </span>
          )}
        </span>
        {state === 'ready' && (
          <span className="shrink-0 text-[10px] tabular-nums text-charcoal-light/70">
            已填 {filled} / {rows.length}
          </span>
        )}
      </div>

      <div className="mt-2">
          {state !== 'ready' ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-charcoal-light">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {state === 'unavailable'
                ? 'The ASIN table could not be read. Saving will leave the stored ASINs untouched — reload the console and try again.'
                : state === 'nosku'
                  ? 'Add a 货号 first — ASINs are stored per item code, so there is nothing to attach them to yet.'
                  : 'Add a colour or a size above first. ASINs are mapped one per colour + size combination.'}
            </p>
          ) : (
            <>
              <p className="text-[10px] leading-relaxed text-charcoal-light">每个"颜色 + 尺码"对应一个 ASIN。左边新加的颜色或尺码会实时出现在这里。还没有 listing 的先留空 —— 会一直标成缺失。</p>

              {/* A rename is a key migration, not a cosmetic edit: the map is keyed
                  by the option text. Saying so up front is the difference between
                  "did my ASINs just disappear?" and trusting the save. */}
              {renames.length > 0 && (
                <p
                  data-rename-note="true"
                  className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800"
                >
                  已改名{' '}
                  <strong className="font-semibold">
                    {renames.map((rename) => `${rename.from} → ${rename.to}`).join(', ')}
                  </strong>
                  {' —— '}
                  {carriedAsins
                    ? `${carriedAsins} 个 ASIN 跟着新名字走，会以新名字保存。`
                    : '旧名字下没有存过 ASIN，所以新行是空的。'}
                </p>
              )}

              {/* The list is capped at `max-h-72` so a 55-combination product
                  does not push Stock off the screen. Chrome's scrollbar is an
                  overlay that only appears mid-scroll, so the fade below is the
                  thing that says "there are more rows" while sitting still. */}
              <div className="relative">
                <div ref={listRef} className="mt-2 max-h-72 space-y-1 overflow-y-auto pb-2 pr-0.5">
                  {rows.map((row) => {
                  const gone = !row.asin
                  const bad = row.asin && blurred[row.key] && !isValidAsin(row.asin)

                  return (
                    <div
                      key={row.key}
                      data-key={row.key}
                      data-new={row.fresh ? 'true' : undefined}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="flex w-[38%] shrink-0 items-center gap-1 text-[11px] text-charcoal"
                        title={row.label}
                      >
                        <span className="truncate">{row.label}</span>
                        {row.fresh && (
                          <span
                            title="Not in the ASIN table yet — this row comes from the options above"
                            className="shrink-0 rounded bg-amber-50 px-1 py-px text-[8.5px] font-semibold uppercase tracking-wide text-amber-700"
                          >新</span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          gone ? 'bg-red-500' : 'bg-emerald-500/70'
                        }`}
                      />
                      <input
                        type="text"
                        value={row.asin}
                        onChange={(event) => onEdit(row.key, event.target.value)}
                        onBlur={() => onBlur(row.key)}
                        placeholder={gone ? '缺 ASIN' : 'B0XXXXXXXX'}
                        aria-label={`ASIN for ${row.label}`}
                        aria-invalid={bad ? 'true' : undefined}
                        spellCheck="false"
                        className={`min-w-0 flex-1 rounded-lg px-2 py-1 font-mono text-[11px] uppercase tracking-tight placeholder:normal-case focus:outline-none focus:ring-1 ${
                          bad
                            ? 'bg-red-50 text-red-600 ring-1 ring-red-300 focus:ring-red-400'
                            : 'bg-cream-dark text-charcoal focus:ring-accent'
                        } ${gone ? 'placeholder:text-red-400' : 'placeholder:text-charcoal-light/45'}`}
                      />
                    </div>
                  )
                })}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-lg bg-gradient-to-t from-white to-transparent" />
              </div>

              {invalid.length > 0 && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-red-500">
                  {invalid.length} {invalid.length === 1 ? 'value looks' : 'values look'} wrong —
                  an Amazon ASIN is 10 letters or digits.
                </p>
              )}

              {extras.length > 0 && (
                <div className="mt-3 border-t border-charcoal/[0.06] pt-2">
                  <p className="text-[10px] leading-relaxed text-charcoal-light">这些已经不在上面的规格里了 —— 删掉颜色之后，它的旧 ASIN 会留在这里。保存时会保留，所以在你补好替代行之前不会丢；点清除才会真的删掉。</p>
                  <div className="mt-1.5 space-y-1">
                    {extras.map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <span
                          className="w-[38%] shrink-0 truncate text-[11px] text-charcoal-light"
                          title={row.label}
                        >
                          {row.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-charcoal/60">
                          {row.asin}
                        </span>
                        <button
                          type="button"
                          onClick={() => onClear(row.key)}
                          aria-label={`Clear ASIN for ${row.label}`}
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-charcoal-light/50 transition hover:bg-red-50 hover:text-red-500"
                        >
                          <Close className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                {renaming ? (
                  <span className="text-[10px] leading-snug text-amber-700">
                    Saving moves these ASINs to {draftSku}
                  </span>
                ) : (
                  <span className="text-[10px] text-charcoal-light/70">{t('Saved with the product — one save writes both tables.')}</span>
                )}
              </div>
            </>
          )}
        </div>
    </section>
  )
}

/**
 * `utils/soldOut.js` 的 `summaryLabel` 返回英文（它是前后台共用模块，不能塞中文，
 * 否则汉字会跟着 storefront 打包）。后台这一侧把它翻过来 —— 只有四种形状，
 * 认不出来的原样返回，不会把数字弄丢。
 */
function zhStockSummary(text) {
  const raw = String(text || '')
  if (raw === 'No variants') return '没有规格'
  const all = /^All (\d+) available$/.exec(raw)
  if (all) return `全部 ${all[1]} 个有货`
  const out = /^All (\d+) sold out$/.exec(raw)
  if (out) return `全部 ${out[1]} 个断货`
  const part = /^(\d+) \/ (\d+) sold out$/.exec(raw)
  if (part) return `${part[1]} / ${part[2]} 断货`
  return raw
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-medium tracking-wider text-charcoal-light">
        {t(label)}
        {hint && (
          <span className="font-normal tracking-normal text-charcoal-light/60">{t(hint)}</span>
        )}
      </span>
      {children}
    </label>
  )
}
