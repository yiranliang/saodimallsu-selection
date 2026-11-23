import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/components/admin/CategoryLayoutEditor.jsx'
let text = readFileSync(path, 'utf8')

if (text.includes('[layout-debug]')) {
  console.log('already instrumented')
} else {
  text = text.replace(
    '  const groups = model.groups || []',
    `  const groups = model.groups || []
  console.log(
    '[layout-debug]',
    JSON.stringify({
      groups: groups.length,
      groupList: (model.groupList || []).length,
      cats: (model.categories || []).length,
      mapped: Object.keys(model.groupsOf || {}).length,
    }),
  )`,
  )
  writeFileSync(path, text, 'utf8')
  console.log('instrumented')
}
