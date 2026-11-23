import { execFileSync } from 'node:child_process'

const message = [
  'fix: 编辑器读取商品详情时丢失额外分类（保存会清空成员表）',
  '',
  '- productStore 新增 membershipsById + withMemberships()，loadProduct / create / update / 实时事件全走它',
  '- 之前只有目录缓存那条路径补了 categories，编辑器走 loadProduct，看到的额外分类是空的，',
  '  一保存就把 product_categories 的行全删了（"整个分类消失"）',
  '- 新增 scripts/e2e-extra-category.mjs：真实登录 → 打开商品 → 保存 → 核对数据库与前台',
].join('\n')

const run = (args) => execFileSync('git', args, { encoding: 'utf8' })

console.log(run(['add', '-A']))
try {
  console.log(run(['commit', '-m', message]))
} catch (error) {
  console.log('commit output:', error.stdout || error.message)
}
console.log(run(['push', 'origin', 'main']))
console.log(run(['log', 'origin/main', '--oneline', '-1']))
