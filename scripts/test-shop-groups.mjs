import { groupOfCategory, groupShopCategories, SHOP_FALLBACK_GROUP } from '../src/utils/shopGroups.js'

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

const categories = [
  'Tops',
  'Long Cardigans',
  'Cropped Cardigans',
  'Patterned',
  'Sets & Dresses',
  'Bottoms',
  'Cover-ups',
  'Jackets & Coats',
  'Sweatshirts',
  'Scarf Hat',
  'Shoes',
]

const counts = Object.fromEntries(categories.map((name, index) => [name, (index + 1) * 10]))

console.log('\n[1] 归属判断')
check('Tops → Tops', groupOfCategory('Tops'), 'Tops')
check('Long Cardigans → Tops', groupOfCategory('Long Cardigans'), 'Tops')
check('Jackets & Coats → Tops', groupOfCategory('Jackets & Coats'), 'Tops')
check('Bottoms → Bottoms', groupOfCategory('Bottoms'), 'Bottoms')
check('Sets & Dresses → Sets & Dresses', groupOfCategory('Sets & Dresses'), 'Sets & Dresses')
check('Scarf Hat → Accessories', groupOfCategory('Scarf Hat'), 'Accessories')
check('Cover-ups → Accessories', groupOfCategory('Cover-ups'), 'Accessories')
check('Shoes → Shoes', groupOfCategory('Shoes'), 'Shoes')
check('Patterned → 兜底组', groupOfCategory('Patterned'), SHOP_FALLBACK_GROUP)
check('空名字 → 兜底组', groupOfCategory(''), SHOP_FALLBACK_GROUP)

console.log('\n[2] 分组结果')
const groups = groupShopCategories(categories, counts)

check('分组数量（5 个大类 + 兜底）', groups.length, 6)
check('第一组是 Tops', groups[0].title, 'Tops')
check(
  'Tops 下含 5 个分类',
  groups[0].items.map((item) => item.value),
  ['Tops', 'Long Cardigans', 'Cropped Cardigans', 'Jackets & Coats', 'Sweatshirts'],
)
check('兜底组在最后', groups[groups.length - 1].title, SHOP_FALLBACK_GROUP)
check('兜底组含 Patterned', groups[groups.length - 1].items.map((item) => item.value), ['Patterned'])
check('Bottoms 组只有一个', groups[1].items.map((item) => item.value), ['Bottoms'])
check('没有分类丢失', groups.reduce((sum, group) => sum + group.items.length, 0), categories.length)
check(
  '组总数 = 成员之和',
  groups[0].total,
  groups[0].items.reduce((sum, item) => sum + item.count, 0),
)
check('数量透传', groups[0].items[0].count, 10)
check('缺失数量按 0', groupShopCategories(['Tops'])[0].items[0].count, 0)
check('空输入不炸', groupShopCategories(undefined), [])
check('忽略空名字', groupShopCategories(['', 'Tops']).length, 1)

console.log('\n[3] 数据库分组（group_name）优先于关键词')
const configured = groupShopCategories(['Patterned', 'Knit Sets'], { Patterned: 5, 'Knit Sets': 3 }, {
  Patterned: 'Tops',
})
check('显式分组生效', configured[0].title, 'Tops')
check('显式分组把它拉进 Tops', configured[0].items.map((i) => i.value), ['Patterned'])
check('没配的仍走关键词', configured[1].title, 'Sets & Dresses')
check('空字符串视为未配', groupShopCategories(['Patterned'], {}, { Patterned: '' })[0].title, SHOP_FALLBACK_GROUP)

console.log('\n[4] 分组顺序以数据库为准')
const ordered = groupShopCategories(
  ['Tops', 'Long Cardigans', 'Bottoms', 'Floral'],
  {},
  { Tops: 'Tops', 'Long Cardigans': 'Cardigans', Bottoms: 'Bottoms', Floral: 'Trending' },
  ['Cardigans', 'Trending', 'Tops', 'Bottoms'],
)
check('按 order 排列', ordered.map((g) => g.title), ['Cardigans', 'Trending', 'Tops', 'Bottoms'])

const noOrder = groupShopCategories(['Tops', 'Floral'], {}, { Tops: 'Tops', Floral: 'Trending' })
check('没有 order 时自建分组排在最后', noOrder.map((g) => g.title), ['Tops', 'Trending'])

const withMore = groupShopCategories(['Tops', 'Patterned'], {}, { Tops: 'Tops' }, ['Tops'])
check('兜底组永远最后', withMore.map((g) => g.title), ['Tops', SHOP_FALLBACK_GROUP])

console.log(`\n────────────────────────────────────────────`)
console.log(`${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
