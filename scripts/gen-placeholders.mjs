/**
 * 生成占位商品图（SVG）
 * 运行： node scripts/gen-placeholders.mjs
 *
 * 为什么用本地 SVG：
 *  1. 不依赖外部图床，离线/弱网也能正常显示
 *  2. 不会出现"图片与商品不符"的尴尬
 *  3. 体积小（每个 1KB 左右），首屏快
 *  4. 风格统一，和米白/中性色的整体调性一致
 *
 * 真实上线时把 products.js 里的 image 换成自己的图片 URL 即可。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/placeholders')

/** 柔和底色，循环使用 */
const TINTS = [
  { bg1: '#EFEAE1', bg2: '#E4DCD0', ink: '#9A9083' }, // 沙
  { bg1: '#E7ECE7', bg2: '#D8E0D9', ink: '#8B968C' }, // 苔
  { bg1: '#EDE8E3', bg2: '#E0D7CF', ink: '#9B8E82' }, // 陶
  { bg1: '#E9E9EE', bg2: '#DBDBE3', ink: '#8E8E9A' }, // 雾
  { bg1: '#F0E9E6', bg2: '#E4D8D3', ink: '#9E8C85' }, // 藕
  { bg1: '#ECE9E0', bg2: '#DFDACD', ink: '#958F7E' }, // 燕麦
]

/**
 * 各类目线稿图标
 * 坐标系：200 × 250，主体大致居中
 */
const ICONS = {
  pants: `
    <path d="M74 56 H126 L133 196 H111 L100 118 L89 196 H67 Z" />
    <path d="M74 56 H126" />`,

  dress: `
    <path d="M82 60 L96 56 L100 74 L104 56 L118 60 L126 96 L152 196 H48 L74 96 Z" />
    <path d="M74 96 H126" />`,

  jacket: `
    <path d="M80 58 H120 L146 76 L140 124 L128 120 V196 H72 V120 L60 124 L54 76 Z" />
    <path d="M100 58 V196" />`,

  sweater: `
    <path d="M78 62 H122 L148 80 L142 126 L130 122 V196 H70 V122 L58 126 L52 80 Z" />
    <path d="M88 62 a12 10 0 0 0 24 0" />`,

  jeans: `
    <path d="M74 56 H126 L133 196 H111 L100 120 L89 196 H67 Z" />
    <path d="M74 56 H126" />
    <path d="M74 74 H92" />
    <path d="M126 74 H108" />`,

  loafer: `
    <path d="M50 160 q0 -22 24 -26 l26 -6 q14 -3 22 6 q11 10 26 15 q13 4 14 15 H50 z" />
    <path d="M48 168 H166" />
    <path d="M82 138 q16 12 34 11" />`,

  sneaker: `
    <path d="M50 156 q0 -20 24 -24 l20 -5 q12 -3 20 5 q12 10 28 15 q16 5 16 14 H50 z" />
    <path d="M48 164 H164" />
    <path d="M48 172 H164" />
    <path d="M96 138 l9 -9" />
    <path d="M108 144 l9 -9" />
    <path d="M120 150 l9 -9" />`,

  scarf: `
    <path d="M62 52 q30 20 0 44 q-28 22 4 44 q28 20 -2 42" />
    <path d="M92 52 q30 20 0 44 q-28 22 4 44 q28 20 -2 42" />
    <path d="M120 52 q30 20 0 44 q-28 22 4 44 q28 20 -2 42" />`,

  bag: `
    <path d="M54 92 H146 L154 200 H46 Z" />
    <path d="M76 92 V76 a24 24 0 0 1 48 0 V92" />`,

  hoodie: `
    <path d="M80 62 H120 L148 80 L142 126 L130 122 V196 H70 V122 L58 126 L52 80 Z" />
    <path d="M80 62 q20 26 40 0" />
    <path d="M94 96 V130" />
    <path d="M106 96 V130" />`,

  shirt: `
    <path d="M80 58 H120 L146 76 L140 124 L128 120 V196 H72 V120 L60 124 L54 76 Z" />
    <path d="M88 58 L100 78 L112 58" />
    <circle cx="100" cy="112" r="2.5" />
    <circle cx="100" cy="140" r="2.5" />
    <circle cx="100" cy="168" r="2.5" />`,

  skirt: `
    <path d="M76 72 H124 L156 196 H44 Z" />
    <path d="M76 72 H124" />
    <path d="M86 72 L80 196" />
    <path d="M114 72 L120 196" />`,

  down: `
    <path d="M80 58 H120 L146 76 L140 124 L128 120 V196 H72 V120 L60 124 L54 76 Z" />
    <path d="M72 96 H128" />
    <path d="M72 122 H128" />
    <path d="M72 148 H128" />
    <path d="M72 174 H128" />`,

  watch: `
    <circle cx="100" cy="124" r="32" />
    <path d="M92 92 V60 H108 V92" />
    <path d="M92 156 V188 H108 V156" />
    <path d="M100 124 V108" />
    <path d="M100 124 H114" />`,

  turtleneck: `
    <path d="M78 70 H122 L148 86 L142 128 L130 124 V196 H70 V124 L58 128 L52 86 Z" />
    <path d="M86 70 V52 H114 V70" />`,

  beret: `
    <path d="M46 132 q4 -56 54 -56 q50 0 54 56" />
    <path d="M46 132 q54 18 108 0" />
    <path d="M100 76 V60" />
    <circle cx="100" cy="56" r="5" />`,
}

/** 每个商品对应的图标 key */
const MAPPING = {
  p001: { icon: 'pants', label: 'TROUSERS' },
  p002: { icon: 'dress', label: 'DRESS' },
  p003: { icon: 'jacket', label: 'JACKET' },
  p004: { icon: 'sweater', label: 'KNITWEAR' },
  p005: { icon: 'jeans', label: 'DENIM' },
  p006: { icon: 'loafer', label: 'LOAFERS' },
  p007: { icon: 'scarf', label: 'SCARF' },
  p008: { icon: 'bag', label: 'TOTE BAG' },
  p009: { icon: 'hoodie', label: 'HOODIE' },
  p010: { icon: 'shirt', label: 'SHIRT' },
  p011: { icon: 'skirt', label: 'SKIRT' },
  p012: { icon: 'down', label: 'DOWN JACKET' },
  p013: { icon: 'watch', label: 'WATCH' },
  p014: { icon: 'turtleneck', label: 'KNIT TOP' },
  p015: { icon: 'sneaker', label: 'SNEAKERS' },
  p016: { icon: 'beret', label: 'BERET' },
}

mkdirSync(OUT_DIR, { recursive: true })

let i = 0
for (const [id, { icon, label }] of Object.entries(MAPPING)) {
  const tint = TINTS[i % TINTS.length]
  i++

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="600" height="750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${tint.bg1}"/>
      <stop offset="1" stop-color="${tint.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="250" fill="url(#g)"/>
  <circle cx="100" cy="118" r="66" fill="#ffffff" opacity="0.22"/>
  <g fill="none" stroke="${tint.ink}" stroke-width="2.4"
     stroke-linecap="round" stroke-linejoin="round" opacity="0.72">
    ${ICONS[icon].trim()}
  </g>
  <text x="100" y="228" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-size="7"
        letter-spacing="2.6" fill="${tint.ink}" opacity="0.6">${label}</text>
</svg>
`
  writeFileSync(resolve(OUT_DIR, `${id}.svg`), svg, 'utf8')
  console.log('生成', `${id}.svg`, `(${label})`)
}

console.log(`\n完成，共 ${Object.keys(MAPPING).length} 个占位图 → public/placeholders/`)
