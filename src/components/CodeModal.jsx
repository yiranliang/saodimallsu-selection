import { useState } from 'react'
import Modal from './Modal.jsx'
import { Copy, Check, Info } from './icons.jsx'
import { copyToClipboard } from '../utils/clipboard.js'

/**
 * Selection code sheet
 * ─────────────────────
 * Shows the generated code with a copy action and instructions.
 */
export default function CodeModal({
  open,
  code,
  totalStyles,
  totalUnits,
  influencerName,
  onClose,
  showToast,
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const ok = await copyToClipboard(code)
    if (ok) {
      setCopied(true)
      showToast?.('Code copied', 'success')
      setTimeout(() => setCopied(false), 2000)
    } else {
      showToast?.('Copy failed — please select and copy manually', 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Your selection code" maxWidth="max-w-md">
      <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 text-center sm:px-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/12 text-accent">
          <Check className="h-7 w-7" />
        </div>

        <h2 className="mt-5 text-lg font-semibold tracking-tight text-charcoal">
          Your code is ready
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-light">
          {totalStyles} {totalStyles === 1 ? 'style' : 'styles'} · {totalUnits}{' '}
          {totalUnits === 1 ? 'item' : 'items'}
          {influencerName ? ` · ${influencerName}` : ''}
        </p>

        <div className="mt-6 rounded-2xl border border-dashed border-charcoal/15 bg-white px-3 py-5">
          <div className="text-[10px] tracking-[0.18em] text-charcoal-light">
            YOUR SELECTION CODE
          </div>
          <div className="mt-2 break-all font-mono text-[12px] font-semibold leading-6 tracking-tight text-charcoal sm:text-[13px]">
            {code}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-medium transition-all duration-200 active:scale-[0.97] ${
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-accent text-white shadow-lg shadow-accent/20 hover:bg-accent-dark'
          }`}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy code
            </>
          )}
        </button>

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-cream-dark/70 px-3.5 py-3 text-left">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-light" />
          <p className="text-[12px] leading-relaxed text-charcoal/75">
            Send this code to your contact. Everything you picked — styles,
            quantities and options — is inside it. Your selection stays here, so
            you can add more and generate again: the newest code includes
            everything.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full py-2 text-[13px] text-charcoal-light transition hover:text-charcoal"
        >
          Keep browsing
        </button>
      </div>
    </Modal>
  )
}
