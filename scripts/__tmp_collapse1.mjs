import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/components/admin/SettingsDialog.jsx'
const lines = readFileSync(path, 'utf8').split(/\r?\n/)

/* 单开手风琴：同一时刻只展开一块 */
if (!lines.some((l) => l.includes('openSection'))) {
  const at = lines.findIndex((l) => l.includes('const [panelOpen, setPanelOpen] = useState(true)'))
  if (at < 0) throw new Error('panelOpen not found')
  lines[at] = "  const [openSection, setOpenSection] = useState('names')"
}

let text = lines.join('\n')

/* 1. 重命名区：包一层折叠头 */
const A_START = '          {fields.map((field, index) => ('
const A_END_MARK = '          {/* 菜单布局草稿：改完再保存，避免每次拖动都写库 */}'

if (!text.includes('专区名称')) {
  throw new Error('unexpected: 专区名称 marker missing')
}

if (!text.includes("{openSection === 'names' && (")) {
  /* 头部 + 条件包裹 */
  text = text.replace(
    A_START,
    `          <button
            type="button"
            onClick={() => setOpenSection((current) => (current === 'names' ? null : 'names'))}
            aria-expanded={openSection === 'names'}
            className="flex w-full items-start justify-between gap-3 border-t border-charcoal/[0.06] pt-4 text-left first:border-t-0 first:pt-0"
          >
            <span>
              <span className="block text-[11px] font-medium tracking-wider text-charcoal-light">
                专区名称
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-charcoal-light/80">
                前台 Sale 菜单和节日入口显示的名字。
              </span>
            </span>
            <ChevronDown
              className={\`h-3.5 w-3.5 shrink-0 text-charcoal-light transition-transform \${
                openSection === 'names' ? 'rotate-180' : ''
              }\`}
            />
          </button>

          {openSection === 'names' && (
            <div className="mt-3 space-y-6">
              {fields.map((field, index) => (
                <div key={field.key}>
                  <div className="text-[11px] font-medium tracking-wider text-charcoal-light">
                    {field.title}
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-charcoal-light/80">
                    {field.hint}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={field.draft}
                      onChange={(event) => field.setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') field.save()
                        if (event.key === 'Escape') field.setDraft(field.saved)
                      }}
                      maxLength={field.maxLength}
                      placeholder={field.placeholder}
                      aria-label={field.title}
                      className="min-w-0 flex-1 rounded-lg bg-cream px-3 py-2 text-[13px] text-charcoal placeholder:text-charcoal-light/50 focus:outline-none focus:ring-1 focus:ring-charcoal/25"
                    />
                    <button
                      type="button"
                      onClick={field.save}
                      disabled={field.busy || field.normalise(field.draft) === field.saved}
                      className="shrink-0 rounded-full bg-charcoal px-3.5 py-2 text-[11.5px] font-medium text-cream transition hover:bg-charcoal/85 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {field.busy ? '保存中…' : '改名'}
                    </button>
                    <button
                      type="button"
                      onClick={field.reset}
                      disabled={field.busy || field.resetDisabled}
                      className="shrink-0 rounded-full bg-cream-dark px-3 py-2 text-[11.5px] font-medium text-charcoal transition hover:bg-cream-dark/70 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

${A_END_MARK}`,
  )

  /* 原来那段 fields.map 和它的收尾要删掉：从第一个旧 {fields.map 到 菜单布局注释之间 */
  const oldStart = text.indexOf('          {fields.map((field, index) => (', text.indexOf('{openSection === \'names\' && (') + 10)
  if (oldStart > 0) {
    const oldEnd = text.indexOf(A_END_MARK, oldStart)
    if (oldEnd > oldStart) {
      /* 仅当中间确实还是旧结构（含 field.title 的旧写法）才删 */
      const chunk = text.slice(oldStart, oldEnd)
      if (chunk.includes('field.title') && chunk.includes('{field.title}')) {
        text = text.slice(0, oldStart) + text.slice(oldEnd)
      }
    }
  }
}

writeFileSync(path, text, 'utf8')
console.log('names section wrapped')
