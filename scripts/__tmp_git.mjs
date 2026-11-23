import { execFileSync } from 'node:child_process'

const message = [
  'fix: 额外分类的写入被误放在 catch 里（保存成功反而不写）',
  '',
  '上一轮把它插到了 try/catch 的 catch 分支：只有保存抛错时才执行，',
  '所以"保存成功但额外分类丢了"。现在挪到 onSave 成功之后。',
  '- 顺带：loadProduct 已补 withMemberships（编辑器能看到已有额外分类）',
  '- e2e-extra-category.mjs 覆盖：打开→加 Striped→保存→查库→看前台',
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
