/**
 * Badge colour
 * ════════════
 * The `tag` column has always been free text with one fixed look (charcoal pill,
 * cream text). Ops asked to colour it — "New" can be terracotta, "Restock" green,
 * a warning red — without touching CSS.
 *
 * WHY A HEX STRING AND NOT A TOKEN
 * ───────────────────────────────
 * A closed set of tokens (`red`, `green`, …) means every new colour is a code
 * change plus a deploy. A hex value is one text column, works in an inline
 * `style`, and renders identically on the storefront and in the editor preview.
 * The value is validated on the way in (`normaliseBadgeColor`) so a typo cannot
 * reach the DOM — an invalid value degrades to "no colour" (the default pill)
 * rather than an invisible badge.
 *
 * WHY THE TEXT COLOUR IS COMPUTED
 * ──────────────────────────────
 * The default pill is dark-on-light-reversed: charcoal fill, cream text. Once
 * the fill is arbitrary, a fixed text colour breaks: cream on yellow is
 * unreadable, charcoal on charcoal is invisible. `badgeTextColor` picks the
 * readable one from the fill's relative luminance, so every preset — and every
 * colour picked in the OS colour picker — stays legible.
 *
 * PURE FUNCTIONS ONLY — imported by `scripts/test-badge.mjs` and by both the
 * storefront and the admin editor.
 */

import { TEASER_BADGE } from './teaser.js'

/** Shown in the editor as one-click swatches, in brand order. */
export const BADGE_COLOR_PRESETS = [
  { value: '#2B2B2B', label: 'Charcoal' },
  { value: '#C8855A', label: 'Terracotta' },
  { value: '#B3453A', label: 'Red' },
  { value: '#C08A2E', label: 'Amber' },
  { value: '#4A6B52', label: 'Green' },
  { value: '#3F5C7A', label: 'Blue' },
]

/**
 * One-click templates: a pill that fills the TEXT and the COLOUR together.
 * ═════════════════════════════════════════════════════════════
 * The five words an influencer actually sorts by — not by fabric, not by
 * price: "is it new, does it sell, is it trending, must I have it, can I get
 * it again". Each one is a decision, and each decision has a colour, so the
 * click that picks the word should pick the colour too. Typing the word and
 * then hunting for the hex is two jobs where there was one.
 *
 * The pill is drawn with `badgeStyle(value)` — the same inline style the
 * storefront badge uses — so what the operator clicks is literally what the
 * card will show. That is also why every colour here passes WCAG against its
 * computed text colour (asserted in test-badge.mjs): a template that renders
 * unreadable text would teach the wrong lesson five times a day.
 *
 * Shades are deliberately a notch deeper than their everyday names (burnt
 * orange, not Hermès orange; deep navy, not black): the brief asked for
 * "pops on a product photo, premium", and a fill this dark keeps white-ish
 * text at ≥4.5:1. The bright versions measure 2.9–3.4:1 — the badge would
 * either be unreadable or need dark text, and dark text on a small pill over
 * a photo is worse. `label` is only for the tooltip / screen reader; the pill
 * itself shows `text`, and the storefront badge shows exactly `text` too.
 */
export const BADGE_TEMPLATES = [
  { text: 'New', value: '#1F7A55', label: 'Emerald' },
  { text: 'Best-seller', value: '#B34E17', label: 'Burnt orange' },
  { text: 'Trending', value: '#7C3AED', label: 'Violet' },
  { text: 'Must-have', value: '#1E2E4F', label: 'Deep navy' },
  { text: 'Restock', value: '#2470AE', label: 'Sky' },
  /* Pairs with the is_teaser switch: one click fills the text AND the graphite
   * colour, so an operator who marks something Coming Soon gets the matching
   * badge without hunting for a hex value. */
  TEASER_BADGE,
]

/**
 * Which template the badge currently is, or `null`.
 *
 * `tag` is trimmed first because a trailing space from a paste is invisible
 * and would otherwise leave the pill un-highlighted for no visible reason.
 * Both halves must match: a colour alone is not a template (the operator may
 * have picked it from the swatches), and text alone is not one either.
 *
 * @param {unknown} tag
 * @param {unknown} color
 * @returns {{ text: string, value: string, label: string } | null}
 */
export function badgeTemplateMatch(tag, color) {
  const text = typeof tag === 'string' ? tag.trim() : ''
  const hex = normaliseBadgeColor(color)
  if (!text || !hex) return null
  return BADGE_TEMPLATES.find((tpl) => tpl.text === text && tpl.value === hex) || null
}

/** What the badge looks like when no colour is set — the pre-existing style.
 *  Kept as the reference for the two text colours below; the pill itself is
 *  still drawn by Tailwind classes so it keeps its blur and 80% opacity. */
export const DEFAULT_BADGE_STYLE = { backgroundColor: '#2B2B2B', color: '#FAF8F5' }

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Anything the database or an import may hold → `#RRGGBB`, or '' for "no
 * colour".
 *
 * Accepts `#abc` (expanded to `#AABBCC`), `#AABBCC`, and the same without the
 * leading `#`. Everything else — named colours, `rgb()`, a stray value from a
 * spreadsheet — becomes '', because the only safe fallback is the default pill.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseBadgeColor(value) {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!HEX.test(raw)) return ''
  const hex = raw.replace('#', '').toUpperCase()
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex
  return `#${full}`
}

/** `#RRGGBB` → [r, g, b], or null when the value is not a colour. */
function rgbOf(color) {
  const hex = normaliseBadgeColor(color)
  if (!hex) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * WCAG relative luminance (0 = black, 1 = white), gamma-corrected.
 * The simple average of R/G/B is enough to look wrong on saturated colours:
 * pure blue scores 0.33 by average and 0.07 by luminance, and one of those makes
 * the text colour decision flip the wrong way.
 */
export function badgeLuminance(color) {
  const rgb = rgbOf(color)
  if (!rgb) return null
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two relative luminances. */
export function badgeContrast(a, b) {
  const la = badgeLuminance(a)
  const lb = badgeLuminance(b)
  if (la === null || lb === null) return 0
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const TEXT_ON_DARK = '#FAF8F5'
const TEXT_ON_LIGHT = '#2B2B2B'

/**
 * Readable text colour for a fill: whichever of cream / charcoal contrasts more.
 *
 * A fixed threshold ("light fill → dark text") was the first attempt and it got
 * terracotta wrong: #C8855A sits just either side of the crossover, and cream on
 * it measures 2.8:1 — a 10px badge nobody can read. Comparing the two ratios
 * instead means the fill never has to be "classified", and every value the OS
 * colour picker can produce gets the better of the two.
 *
 * Worst case is a mid-grey where both options land around 3.7:1. That is the
 * floor for this pair of text colours, not something a different threshold
 * fixes — going further would mean deriving the text colour from the fill.
 */
export function badgeTextColor(color) {
  if (badgeLuminance(color) === null) return TEXT_ON_DARK
  return badgeContrast(color, TEXT_ON_DARK) >= badgeContrast(color, TEXT_ON_LIGHT)
    ? TEXT_ON_DARK
    : TEXT_ON_LIGHT
}

/**
 * Inline style for a badge, or `null` when there is no colour set.
 *
 * `null` matters: the callers keep their Tailwind classes for the default look,
 * which also carries the `backdrop-blur` and opacity that a hex value cannot
 * express. Returning a style object for the empty case would silently flatten
 * every existing badge to opaque charcoal.
 *
 * @param {unknown} color
 * @returns {{ backgroundColor: string, color: string } | null}
 */
export function badgeStyle(color) {
  const hex = normaliseBadgeColor(color)
  if (!hex) return null
  return { backgroundColor: hex, color: badgeTextColor(hex) }
}
