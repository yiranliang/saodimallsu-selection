/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        /* "Two panes" for the product sheet: a normal desktop, OR a phone held
         * sideways. A 844×390 landscape phone has plenty of width for a photo
         * column and an info column, and stacking them there wastes half the
         * screen and forces the specs into a 150px-tall scroll strip.
         *
         * The exact same query lives in src/components/ProductDetail.jsx (it
         * decides whether the photo may shrink); keep the two in sync. */
        split: {
          raw: '(min-width: 1024px), (min-width: 768px) and (orientation: landscape)',
        },
      },
      colors: {
        // 低饱和中性色系
        cream: '#FAF8F5',      // 米白背景
        'cream-dark': '#F2EEE8',
        charcoal: '#2B2B2B',    // 深色文字
        'charcoal-light': '#6B6B6B',
        // 强调色 — 暖棕橘（买手店质感）
        accent: '#C8855A',
        'accent-dark': '#B0724A',
        'accent-light': '#D9A57E',
      },
      fontFamily: {
        /* System stack, no webfont. index.html explains why: Inter was a
         * render-blocking cross-origin stylesheet, and the storefront is opened
         * on phones more often than on a laptop. `ui-sans-serif`/`system-ui`
         * resolve to SF + PingFang SC on iOS, Segoe UI + a CJK fallback on
         * Windows, Roboto on Android — all already on the device. */
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      animation: {
        'pop': 'pop 0.3s ease-out',
        'heartbeat': 'heartbeat 0.4s ease-in-out',
        'slide-up': 'slideUp 0.35s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
        'fade-in': 'fadeIn 0.25s ease-out',
        'scale-in': 'scaleIn 0.25s ease-out',
        'shake': 'shake 0.45s ease-in-out',
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.12)' },
          '100%': { transform: 'scale(1)' },
        },
        // Wrong passcode — a short horizontal nudge, not a flashy error bounce
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(1.2)' },
          '60%': { transform: 'scale(0.95)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
