import { execFileSync } from 'node:child_process'

const message = [
  'feat: 设置改为「分类 & 分组布局」（合并草稿/分组/分类，直接编辑）',
  '',
  '- 新组件 CategoryLayoutEditor：分组可折叠，组内可排序/改名/删除/新增分类',
  '- 分组本身可排序、改名、删除、新增（新增 renameCategoryGroup 写库函数）',
  '- 去掉草稿态：每次操作立即写库，前台随之更新',
  '- 设置弹窗收敛成两块：专区名称 + 分类 & 分组布局',
].join('\n')

const run = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

try {
  run(['add', '-A'])
  const out = run(['commit', '-m', message])
  console.log(out.trim().split('\n').slice(0, 2).join('\n'))
} catch (error) {
  console.log('commit:', (error.stdout || error.message).toString().slice(0, 200))
}

console.log(run(['push', 'origin', 'main']))
console.log(run(['log', 'origin/main', '--oneline', '-1']))
