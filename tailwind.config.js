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
      /* 调色板全部走 CSS 变量（RGB 通道 + <alpha-value>）：
       *   - 主题切换只改 index.css 里的十来个变量，组件一个类名都不用动；
       *   - `/70` 这种透明度修饰符照样生效（这是不能用裸 `var(--x)` 的原因：
       *     那样会丢掉 alpha 通道，全站的 `text-charcoal/60` 会一起坏掉）。
       * 默认值（极简米白）写在 index.css 的 `:root`，`[data-theme=…]` 里覆盖。 */
      colors: {
        cream: 'rgb(var(--c-cream) / <alpha-value>)',
        'cream-dark': 'rgb(var(--c-cream-dark) / <alpha-value>)',
        charcoal: 'rgb(var(--c-charcoal) / <alpha-value>)',
        'charcoal-light': 'rgb(var(--c-charcoal-light) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-dark': 'rgb(var(--c-accent-dark) / <alpha-value>)',
        'accent-light': 'rgb(var(--c-accent-light) / <alpha-value>)',
        white: 'rgb(var(--c-white) / <alpha-value>)',
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
