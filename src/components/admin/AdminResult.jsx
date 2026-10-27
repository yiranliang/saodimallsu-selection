import { useState } from 'react'
import { Download, Copy, Check, ArrowLeft, Barcode, AlertCircle } from '../icons.jsx'
import ProductImage from '../ProductImage.jsx'
import { t } from '../../i18n/admin.js'
import {
  exportToCSV,
  copyToClipboard,
  collectAsins,
  asinsToText,
  selectionListText,
} from '../../utils/clipboard.js'

/**
 * Lookup result
 * ──────────────
 * Shows who selected what, when, and in which quantity — with the 货号 and the
 * ASINs resolved from the catalogue, so ops never has to cross-reference.
 *
 * Exports: CSV for spreadsheets, plain text for chat, bare ASIN list for
 * pasting straight into Amazon / the ERP.
 */
export default function AdminResult({ result, code, onReset, showToast }) {
  const [copied, setCopied] = useState(false)
  const [copiedAsins, setCopiedAsins] = useState(false)

  /* Every ASIN in this selection, in code order, deduped, blanks dropped.
   * Computed once per render so the button label and the copy agree. */
  const asins = collectAsins(result)

  const when = result.createdAtMs
    ? new Date(result.createdAtMs).toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown'

  const missingCount = result.missing?.length || 0

  /** CSV rows — one line per variant line, with the exact ASIN for that combo */
  const handleExportCSV = () => {
    const rows = result.items.map((item, i) => ({
      No: i + 1,
      货号: item.sku || '',
      ASIN: item.asin || '',
      Product: item.name,
      Category: item.category || '',
      Options: item.specText,
      Qty: item.qty,
      'Product ID': item.id,
      Status: item.missing
        ? '已下架商品'
        : item.hidden
          ? 'Hidden — not on the storefront'
          : item.asin
            ? ''
            : 'No matching ASIN',
    }))
    const safeRef = (result.ref || 'guest').replace(/[^a-zA-Z0-9]/g, '')
    const date = result.createdAt ? result.createdAt.slice(0, 10) : 'export'
    exportToCSV(`selection_${safeRef}_${date}.csv`, rows)
    showToast?.('CSV downloaded', 'success')
  }

  /** One summary line, shared by the header pill and the plain-text export */
  const summary = (() => {
    const styles = result.distinctProducts ?? result.totalStyles
    const parts = [`${styles} ${styles === 1 ? 'style' : 'styles'}`]
    /* A v5 code can carry the same product twice (Black/M and White/L), so
     * "styles" and "lines" differ exactly when the creator took two variants.
     * Both numbers matter: one says what to pull, the other how many pieces. */
    if (result.totalStyles > styles) {
      parts.push(`${result.totalStyles} variants`)
    }
    parts.push(`${result.totalUnits} ${result.totalUnits === 1 ? 'item' : 'items'}`)
    return parts.join(' · ')
  })()

  /**
   * Plain-text list, written for the creator rather than for us.
   *
   * The 货号 used to lead every line, which meant the list could not be sent as
   * is — it had to be cleaned by hand each time. Lines now carry only what she
   * can act on: name, options, quantity, and the Amazon page for that exact
   * variant. Header stays because it identifies the selection on both ends.
   */
  const handleCopyText = async () => {
    const list = selectionListText(result)
    const lines = [
      `Creator: ${result.ref}`,
      `Generated: ${when}`,
      summary,
      `Code: ${code}`,
      '─────────────',
      list,
    ]
    const ok = await copyToClipboard(lines.join('\n'))
    if (ok) {
      setCopied(true)
      /* Rows with no ASIN print "(no ASIN on file)" instead of a link. Say it out
       * loud, otherwise a list that is silently one link short gets sent. */
      const noLink = result.items.filter((item) => !item.asin).length
      showToast?.(
        noLink ? `List copied · ${noLink} without a link` : 'List copied',
        noLink ? 'default' : 'success',
      )
      setTimeout(() => setCopied(false), 2000)
    } else {
      showToast?.('复制失败 —— 请手动选中文本复制', 'error')
    }
  }

  /**
   * Bare ASIN list — one per line, nothing else.
   * Built for pasting into Amazon Seller Central / the ERP's bulk box, so it
   * must contain zero decoration: no quotes, no commas, no names, no numbers.
   */
  const handleCopyAsins = async () => {
    if (!asins.length) return
    const ok = await copyToClipboard(asinsToText(result))
    if (ok) {
      setCopiedAsins(true)
      showToast?.(
        `${asins.length} ASIN${asins.length === 1 ? '' : 's'} copied to clipboard`,
        'success',
      )
      setTimeout(() => setCopiedAsins(false), 2000)
    } else {
      showToast?.('Copy failed — please select manually', 'error')
    }
  }

  return (
    <div className="w-full animate-fade-in">
      {/* Summary */}
      <div className="rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
              {t('Creator')}
            </div>
            <div className="mt-1 truncate text-lg font-semibold capitalize text-charcoal">
              {result.ref && result.ref !== 'guest' ? result.ref : '未署名（游客）'}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent">
            {summary}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-charcoal/[0.07] pt-4">
          <div>
            <div className="text-[10px] tracking-wider text-charcoal-light">{t('Generated')}</div>
            <div className="mt-0.5 text-[12px] font-medium text-charcoal">{when}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wider text-charcoal-light">{t('Code')}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-charcoal/70" title={code}>
              {code}
            </div>
          </div>
        </div>
      </div>

      {/* Warnings — legacy code, deleted products, or a v7 code whose option
          lists were edited after it was issued */}
      {(result.legacy || missingCount > 0 || result.optionsChanged) && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200/60">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            {(result.warnings || []).map((warning) => (
              <p key={warning} className="text-[11.5px] leading-relaxed text-amber-900/85">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Lines */}
      <div className="mt-4 space-y-2">
        {result.items.map((item, i) => {
          // The catalogue starts with name === 货号, so printing both reads as a
          // duplicate. Show the 货号 once and drop it from the sub-line.
          const title = item.sku && item.name === item.sku ? item.sku : item.name
          const showSku = item.sku && item.sku !== item.name

          return (
          <div key={`${item.id}-${i}`} className="flex items-center gap-3 rounded-2xl bg-white p-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-charcoal/[0.07] bg-white">
              {/* `image` already points at the picked colour; the component
                  drops to the placeholder if that URL is dead.
                  `contain` so the operator sees the whole garment the creator
                  is talking about, not a crop of it. */}
              <ProductImage
                src={item.image}
                alt={item.name}
                className="h-full w-full object-contain"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-1 text-[13px] font-medium text-charcoal">
                  {title}
                </h3>
                {item.missing && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-medium text-amber-800">
                    已下架
                  </span>
                )}
                {item.hidden && !item.missing && (
                  <span className="shrink-0 rounded-full bg-charcoal/[0.07] px-2 py-0.5 text-[9.5px] font-medium text-charcoal/60">
                    已隐藏
                  </span>
                )}
                {/* v7 stores option positions: if the colour/size list moved,
                    this line's variant is a guess we refuse to make. */}
                {item.variantUncertain && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-medium text-amber-800">
                    请核对颜色尺码
                  </span>
                )}
              </div>

              <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-charcoal-light">
                {showSku && (
                  <>
                    <span className="truncate font-mono text-charcoal/70">{item.sku}</span>
                    <span className="shrink-0 text-charcoal/20">·</span>
                  </>
                )}
                <span className="shrink-0 font-mono text-charcoal-light/60">{item.id}</span>
              </div>

              <div className="mt-1 flex items-center gap-2 text-[11px] text-charcoal-light">
                <span className="truncate">{item.specText}</span>
                <span className="text-charcoal/20">·</span>
                <span className="shrink-0 rounded bg-cream-dark px-1.5 py-0.5 font-medium tabular-nums text-charcoal/70">
                  × {item.qty}
                </span>
              </div>

              {item.found && (
                <p
                  className={`mt-1 font-mono text-[10px] ${
                    item.asin ? 'text-charcoal-light/80' : 'text-amber-700/80'
                  }`}
                >
                  {item.asin ? `ASIN ${item.asin}` : '没有匹配的 ASIN'}
                </p>
              )}
            </div>
          </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleExportCSV}
          className="flex items-center justify-center gap-2 rounded-full bg-charcoal py-3 text-[13px] font-medium text-cream transition active:scale-[0.97]"
        >
          <Download className="h-4 w-4" />
          {t('Export CSV')}
        </button>
        <button
          type="button"
          onClick={handleCopyText}
          title="Copy a list you can send the creator as is — name, options, qty, Amazon link"
          className={`flex items-center justify-center gap-2 rounded-full py-3 text-[13px] font-medium transition active:scale-[0.97] ${
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-charcoal ring-1 ring-charcoal/10 hover:ring-charcoal/25'
          }`}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? '已复制' : '复制清单'}
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleCopyAsins}
          disabled={!asins.length}
          title={
            asins.length
              ? 'Copy every matched ASIN, one per line'
              : 'No variant in this selection has a matching ASIN'
          }
          className={`flex items-center justify-center gap-2 rounded-full py-2.5 text-[12px] font-medium transition active:scale-[0.97] ${
            !asins.length
              ? 'cursor-not-allowed bg-white text-charcoal/40 ring-1 ring-charcoal/[0.07]'
              : copiedAsins
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-charcoal ring-1 ring-charcoal/10 hover:ring-charcoal/25'
          }`}
        >
          {copiedAsins ? <Check className="h-3.5 w-3.5" /> : <Barcode className="h-3.5 w-3.5" />}
          {!asins.length ? '没有可复制的 ASIN' : copiedAsins ? '已复制' : '复制全部 ASIN'}
        </button>
        <a
          href="#/admin/developer"
          className="flex items-center justify-center gap-2 rounded-full bg-white py-2.5 text-[12px] font-medium text-charcoal ring-1 ring-charcoal/10 transition hover:ring-charcoal/25 active:scale-[0.97]"
        >
          {t('Open in Developer')}
        </a>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-3 flex w-full items-center justify-center gap-1.5 py-2.5 text-[12px] text-charcoal-light transition hover:text-charcoal"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('Look up another code')}
      </button>
    </div>
  )
}
