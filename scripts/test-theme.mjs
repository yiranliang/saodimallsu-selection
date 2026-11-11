/**
 * 主题（皮肤）self-check
 *   node scripts/test-theme.mjs
 *
 * 本项目的皮肤是**纯 CSS**：`<html data-theme="…">` 一换，调色板变量就换，
 * 组件一个类名都不用动。所以这里只锁两件事：
 *
 *   [1] normaliseTheme —— 认得的主题名就通过，其它一律回默认（绝不把
 *       莫名其妙的字符串写进 DOM / localStorage）
 *   [2] resolveTheme   —— 优先级：localStorage > 配置默认。**URL 参数不参与**
 *       （皮肤是站点设定，不该被一条链接改变别人看到的样子）
 *
 * 3) applyTheme 用一个假 document 验证"真的写到了 <html> 上"。
 */

import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  currentTheme,
  normaliseTheme,
  resolveTheme,
} from '../src/utils/theme.js'

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

console.log('\n[1] normaliseTheme')

check('only the minimal skin ships today', THEMES, ['minimal'])
check('minimal passes through', normaliseTheme('minimal'), 'minimal')
check('a retired skin name falls back', normaliseTheme('cross-stitch'), 'minimal')
check('surrounding spaces are trimmed', normaliseTheme('  MINIMAL  '), 'minimal')
check('case does not matter', normaliseTheme('Minimal'), 'minimal')
check('an unknown name falls back', normaliseTheme('neon'), DEFAULT_THEME)
check('null falls back', normaliseTheme(null), DEFAULT_THEME)
check('undefined falls back', normaliseTheme(undefined), DEFAULT_THEME)
check('default is minimal', DEFAULT_THEME, 'minimal')

console.log('\n[2] resolveTheme')

check('stored wins over the config default', resolveTheme({ stored: 'minimal', fallback: '' }), 'minimal')
check('config default is the fallback', resolveTheme({ fallback: 'minimal' }), 'minimal')
check('nothing at all → minimal', resolveTheme({}), 'minimal')
check('empty strings are safe', resolveTheme({ search: '', stored: '', fallback: '' }), 'minimal')
check(
  'a URL parameter is IGNORED (switching is config + console only)',
  resolveTheme({ search: '?theme=cross-stitch', fallback: 'minimal' }),
  'minimal',
)
check(
  'and it cannot override a stored choice either',
  resolveTheme({ search: '?theme=cross-stitch', stored: 'minimal' }),
  'minimal',
)

console.log('\n[3] applyTheme writes to <html>')

const fakeDoc = { documentElement: { dataset: {} } }
check('returns the normalised name', applyTheme('minimal', { persist: false, doc: fakeDoc }), 'minimal')
check('and writes the attribute', fakeDoc.documentElement.dataset.theme, 'minimal')
check('unknown names are normalised first', applyTheme('neon', { persist: false, doc: fakeDoc }), 'minimal')
check('currentTheme reads it back', currentTheme(fakeDoc), 'minimal')

applyTheme('minimal', { persist: false, doc: fakeDoc })
check('currentTheme round-trips', currentTheme(fakeDoc), 'minimal')

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
