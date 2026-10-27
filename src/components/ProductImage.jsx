import { useEffect, useMemo, useState } from 'react'
import { PLACEHOLDER_IMAGE } from '../utils/variantImage.js'

/**
 * Image with a fallback chain
 * ───────────────────────────
 * `src` is whatever should ideally show (usually the variant photo). If it
 * fails to load, we walk `fallback` → placeholder, so a typo'd or expired URL
 * degrades to the default product shot instead of a broken-image icon.
 *
 * Without this, a creator switching to a colour whose URL is dead would see a
 * blank tile and assume the piece is unavailable.
 */
export default function ProductImage({
  src,
  fallback,
  alt = '',
  className = '',
  loading = 'lazy',
  srcSet,
  sizes,
  decoding = 'async',
  onError,
  ...rest
}) {
  const chain = useMemo(
    () => [src, fallback, PLACEHOLDER_IMAGE].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
    [src, fallback],
  )

  const [step, setStep] = useState(0)

  // A new src means a fresh attempt, not a continuation of the old chain
  useEffect(() => {
    setStep(0)
  }, [src, fallback])

  const current = chain[Math.min(step, chain.length - 1)] || PLACEHOLDER_IMAGE

  /* The srcset belongs to the FIRST url only. Leaving it attached while `src`
   * has already fallen back to the placeholder lets the browser keep honouring
   * the broken candidate set (srcset outranks src), so a dead photo would stay
   * dead instead of degrading. */
  const responsive = step === 0 ? srcSet : undefined

  return (
    <img
      src={current}
      srcSet={responsive}
      sizes={responsive ? sizes : undefined}
      alt={alt}
      loading={loading}
      decoding={decoding}
      className={className}
      {...rest}
      // Advanced last so a caller's onError can't replace the fallback walk
      onError={(event) => {
        setStep((prev) => Math.min(prev + 1, chain.length - 1))
        onError?.(event)
      }}
    />
  )
}
