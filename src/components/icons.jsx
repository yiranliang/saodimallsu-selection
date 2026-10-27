/**
 * Inline SVG icon set
 * ────────────────────
 * No icon library — keeps the bundle small. Every icon takes `className`
 * so size and colour are controlled by Tailwind.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
}

export const Heart = ({ className = 'w-5 h-5', filled = false }) => (
  <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
)

export const Check = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const Plus = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const Minus = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const Close = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const Copy = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export const ArrowLeft = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

export const ArrowRight = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

export const Search = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

export const Download = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export const Upload = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

export const Pencil = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
)

export const Trash = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export const Reset = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M3 2v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </svg>
)

export const Code = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
)

/* Barcode — stands in for "a list of ASINs" on the copy button */
export const Barcode = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="3" y1="5" x2="3" y2="19" />
    <line x1="6.5" y1="5" x2="6.5" y2="19" />
    <line x1="9.5" y1="5" x2="9.5" y2="19" />
    <line x1="13" y1="5" x2="13" y2="19" />
    <line x1="15.5" y1="5" x2="15.5" y2="19" />
    <line x1="18.5" y1="5" x2="18.5" y2="19" />
    <line x1="21" y1="5" x2="21" y2="19" />
  </svg>
)

export const Info = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

export const AlertCircle = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

export const Sparkle = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </svg>
)

export const Bag = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)

export const Image = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

/* "This click leaves the app." Used on the Amazon link in the editor, where it
 * doubles as the "new tab" signal — nothing else on that screen navigates. */
export const ExternalLink = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

export const ChevronUp = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
)

export const ChevronDown = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

/* "Send to the very top / bottom" — an arrow stopped by a bar. Deliberately
 * different from the chevrons: one click moves a row one slot, the other moves
 * it all the way, and the two must not be mistakable at 14px. */
export const ArrowToTop = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="5" y1="4" x2="19" y2="4" />
    <path d="M12 20V9" />
    <polyline points="7 14 12 9 17 14" />
  </svg>
)

export const ArrowToBottom = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <line x1="5" y1="20" x2="19" y2="20" />
    <path d="M12 4v11" />
    <polyline points="7 10 12 15 17 10" />
  </svg>
)

export const Lock = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    <circle cx="12" cy="15.7" r="1.1" />
  </svg>
)

export const LogOut = ({ className = 'w-5 h-5' }) => (
  <svg {...base} className={className}>
    <path d="M14.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8" />
    <polyline points="17 8.5 20.5 12 17 15.5" />
    <line x1="20.5" y1="12" x2="10" y2="12" />
  </svg>
)
