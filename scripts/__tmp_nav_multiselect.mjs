import { readFileSync, writeFileSync } from 'node:fs'

const patch = (file, pairs) => {
  let text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`not found in ${file}: ${from.slice(0, 70)}`)
    text = text.split(from).join(to)
  }
  writeFileSync(file, text.replace(/\n/g, '\r\n'), 'utf8')
  console.log('ok', file)
}

/* 1. 多选分类的哨兵值 */
patch('src/utils/navViews.js', [
  [
    "/** `is this a tag view, or a real category?` */",
    [
      '/** 「选了多个分类」的视图 id（单个分类仍然直接用分类名）。 */',
      "export const MULTI_CATS = '__multi_cats__'",
      '',
      '/** `is this a tag view, or a real category?` */',
    ].join('\n'),
  ],
])

/* 2. SiteNav：Shop 多选 + 悬停展开、点击外部才收起 */
patch('src/components/SiteNav.jsx', [
  [
    "import { useEffect, useState } from 'react'",
    "import { useEffect, useRef, useState } from 'react'",
  ],
  [
    '  filterLabel = \'\',\n  onClearFilter,',
    "  filterLabel = '',\n  onClearFilter,\n  /* 已选中的分类（多选）。空数组 = All products。 */\n  selectedCats = [],\n  onToggleCategory,",
  ],
  [
    '  const [openSub, setOpenSub] = useState(null) // \'deals\' | \'campaign\' | null',
    [
      "  const [openSub, setOpenSub] = useState(null) // 'deals' | 'campaign' | null",
      '  const menuRootRef = useRef(null)',
    ].join('\n'),
  ],
  [
    '  const select = (value) => {',
    [
      '  /* 只在点击菜单**外部**时收起：悬停进菜单、移到二级面板都不会关。 */',
      '  useEffect(() => {',
      '    if (!openMenu) return undefined',
      '    const onPointerDown = (event) => {',
      '      if (menuRootRef.current?.contains(event.target)) return',
      '      setOpenMenu(null)',
      '      setOpenSub(null)',
      '    }',
      "    document.addEventListener('pointerdown', onPointerDown)",
      '    return () => document.removeEventListener(\'pointerdown\', onPointerDown)\',
      '  }, [openMenu])',
      '',
      '  const select = (value) => {',
    ].join('\n'),
  ],
])
