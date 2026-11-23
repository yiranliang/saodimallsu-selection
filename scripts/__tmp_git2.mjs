import { execFileSync } from 'node:child_process'

const message = [
  'fix: 设置里的分类数量按主分类 + 额外归属统计',
  '',
  '只数 product.category 时，主分类已换走、仅靠"同时归入"挂着的分类会显示 0。',
].join('\n')

const run = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

try {
  run(['add', '-A'])
  const out = run(['commit', '-m', message])
  console.log(out.trim().split('\n').slice(0, 2).join('\n'))
} catch (error) {
  console.log('commit:', (error.stdout || error.message).toString().slice(0, 160))
}

console.log(run(['push', 'origin', 'main']))
console.log(run(['log', 'origin/main', '--oneline', '-1']))
