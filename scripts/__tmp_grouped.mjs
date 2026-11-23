import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/components/admin/ProductEditor.jsx'
let text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

/* 1. 派生：按分组顺序排好的分类（含未分组） */
if (!text.includes('groupedCategoryOptions')) {
  const anchor = '  const holidayOn = Boolean(draft.isHoliday)'
  if (!text.includes(anchor)) throw new Error('holidayOn anchor not found')

  const block = [
    '  /* 下拉里的分类按「分组顺序 → 组内名字」排；没配分组的放在最后。',
    '   * 之前直接按字母序，运营找某个分类要在长列表里翻。 */',
    '  const groupedCategoryOptions = (() => {',
    '    const order = Array.isArray(categoryGroups) ? [] : Object.keys(categoryGroups || {})',
    '    const groupOrder = modelGroupList || []',
    '    const buckets = new Map()',
    '    const loose = []',
    '    for (const name of categoryOptions) {',
    "      const group = String(categoryGroups?.[name] || '').trim()",
    "      if (!group) { loose.push(name); continue }",
    '      if (!buckets.has(group)) buckets.set(group, [])',
    '      buckets.get(group).push(name)',
    '    }',
    '',
    '    const titles = [...buckets.keys()].sort((a, b) => {',
    '      const ia = groupOrder.indexOf(a)',
    '      const ib = groupOrder.indexOf(b)',
    '      if (ia === -1 && ib === -1) return a.localeCompare(b)',
    '      if (ia === -1) return 1',
    '      if (ib === -1) return -1',
    '      return ia - ib',
    '    })',
    '',
    '    return [',
    '      ...titles.map((title) => ({',
    '        title,',
    '        items: buckets.get(title).slice().sort((a, b) => a.localeCompare(b)),',
    '      })),',
    '      ...(loose.length',
    "        ? [{ title: '', items: loose.slice().sort((a, b) => a.localeCompare(b)) }]",
    '        : []),',
    '    ]',
    '  })()',
    '',
  ].join('\n')

  text = text.replace(anchor, block + anchor)
}

writeFileSync(path, text, 'utf8')
console.log('grouped options derived')
