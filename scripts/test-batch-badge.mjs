/**
 * 批量改角标 self-check
 *   node scripts/test-batch-badge.mjs
 *
 * Pure Node — no browser, no database. Four rules the dialog depends on:
 *
 *   [1] normaliseBadgeDraft — trim, collapse pasted whitespace, cap the length,
 *                             and clear the colour when the text is cleared
 *   [2] quick picks         — the three campaign words the brief asked for
 *   [3] maskedCountOf       — how many of the selection will NOT show the new
 *                             badge because Coming Soon owns its own line
 *   [3c] badgeWriteFor      — which column each mode writes. This is the bug
 *                             that made "覆盖" a no-op on every product with a
 *                             live deal: it wrote `tag`, while the first line is
 *                             derived from `sub_tag`.
 *   [4] the boundary        — clearing is an explicit action, not "empty apply"
 */

import {
  BATCH_BADGE_MAX,
  BATCH_BADGE_QUICK_PICKS,
  isBadgeDraftEmpty,
  BADGE_WRITE_MODES,
  badgeWriteFor,
  maskedCountOf,
  placementCountsOf,
  normaliseBadgeDraft,
} from '../src/utils/batchBadge.js'
import { BADGE_ZONE, badgeStackFor } from '../src/utils/deal.js'

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

console.log('\n[1] normaliseBadgeDraft')

check(
  'a campaign word and a preset colour',
  normaliseBadgeDraft({ text: 'Black Friday', color: '#C08A2E' }),
  { tag: 'Black Friday', badgeColor: '#C08A2E' },
)
check(
  'surrounding spaces are trimmed',
  normaliseBadgeDraft({ text: '  Cyber Monday  ', color: '' }),
  { tag: 'Cyber Monday', badgeColor: '' },
)
check(
  'a paste with tabs and double spaces is collapsed',
  normaliseBadgeDraft({ text: 'Black\t\t Friday', color: '' }),
  { tag: 'Black Friday', badgeColor: '' },
)
check(
  'a newline from a spreadsheet does not survive',
  normaliseBadgeDraft({ text: '50%\nOFF', color: '' }),
  { tag: '50% OFF', badgeColor: '' },
)
check(
  'a short hex is expanded, like everywhere else',
  normaliseBadgeDraft({ text: 'Sale', color: '#abc' }),
  { tag: 'Sale', badgeColor: '#AABBCC' },
)
check(
  'lowercase is normalised',
  normaliseBadgeDraft({ text: 'Sale', color: 'c8855a' }),
  { tag: 'Sale', badgeColor: '#C8855A' },
)
check(
  'a word is not a colour',
  normaliseBadgeDraft({ text: 'Sale', color: 'red' }),
  { tag: 'Sale', badgeColor: '' },
)
check(
  'no colour means the default pill',
  normaliseBadgeDraft({ text: 'Sale' }),
  { tag: 'Sale', badgeColor: '' },
)

/* The cap is not cosmetic: the storefront pill truncates, so a 60-character tag
 * would look cut in half on the card with no way to tell it was meant to be. */
const long = normaliseBadgeDraft({ text: 'x'.repeat(60) })
check('the tag is capped', long.tag.length, BATCH_BADGE_MAX)
check('and the cap is 32', BATCH_BADGE_MAX, 32)

/* Clearing the text clears the colour — a colour with no text renders nothing,
 * and leaving it behind would put rows in a state nobody can explain later. */
check(
  'empty text clears the colour too',
  normaliseBadgeDraft({ text: '   ', color: '#C08A2E' }),
  { tag: '', badgeColor: '' },
)
check('no draft at all', normaliseBadgeDraft(), { tag: '', badgeColor: '' })
check('null draft', normaliseBadgeDraft(null), { tag: '', badgeColor: '' })

console.log('\n[2] the quick picks')

check('three campaign words', BATCH_BADGE_QUICK_PICKS.length, 3)
check('Black Friday is there', BATCH_BADGE_QUICK_PICKS.includes('Black Friday'), true)
check('Cyber Monday is there', BATCH_BADGE_QUICK_PICKS.includes('Cyber Monday'), true)
check('and 50% OFF', BATCH_BADGE_QUICK_PICKS.includes('50% OFF'), true)
check(
  'every pick survives normalisation unchanged',
  BATCH_BADGE_QUICK_PICKS.map((text) => normaliseBadgeDraft({ text }).tag),
  BATCH_BADGE_QUICK_PICKS,
)

console.log('\n[3] maskedCountOf — what will be hidden behind a stronger badge')

const now = new Date(2026, 9, 28, 12, 0, 0).getTime()
const deal = (start, end) => ({ saleStart: start, saleEnd: end, tag: 'Old' })

check('a plain tag is fine', maskedCountOf([{ tag: 'New' }], now), 0)
check('a product with no badge is fine', maskedCountOf([{}], now), 0)
check('Coming Soon wins', maskedCountOf([{ isTeaser: true, tag: 'New' }], now), 1)
check(
  'a live deal wins',
  maskedCountOf([deal('2026-10-28T10:00', '2026-10-28T22:00')], now),
  1,
)
check(
  'a scheduled deal wins too (it already shows ⚡)',
  maskedCountOf([deal('2026-10-29T10:00', '2026-10-30T10:00')], now),
  1,
)
check(
  'an ended deal does not',
  maskedCountOf([deal('2026-10-01T10:00', '2026-10-02T10:00')], now),
  0,
)
/* ACC 不再出现在卡片上，所以一件"只有 ACC + 普通标"的商品，新标仍然会
 * 显示在第一行 —— 它不算被占位。 */
check('ACC does not reserve the card any more', maskedCountOf([{ hasAcc: true, tag: 'New' }], now), 0)
check(
  'counts through a mixed selection',
  maskedCountOf(
    [
      { tag: 'New' },
      { isTeaser: true },
      deal('2026-10-28T10:00', '2026-10-28T22:00'),
      { hasAcc: true },
      deal('2026-10-01T10:00', '2026-10-02T10:00'),
      {},
    ],
    now,
  ),
  2,
)
check('empty selection', maskedCountOf([], now), 0)
check('non-array in', maskedCountOf(null, now), 0)

console.log('\n[3b] placementCountsOf — where the new tag actually lands')

{
  const now2 = new Date(2026, 9, 28, 12, 0, 0).getTime()
  const deal = (start, end) => ({
    saleStart: start,
    saleEnd: end,
    salePrice: '50',
    originalPrice: '100',
  })
  const counts = placementCountsOf(
    [
      { tag: 'New' },
      {},
      deal('2026-10-28T10:00', '2026-10-28T22:00'),
      { subTag: 'Black Friday' },
      { isTeaser: true },
    ],
    now2,
  )
  check('plain products take the first line', counts.first, 2)
  check('a campaign pushes the tag down', counts.second, 2)
  check('only Coming Soon has no line for it', counts.hidden, 1)

  /* 覆盖模式写的是活动标槽位（第一行）：除了 Coming Soon，每一件都是第一行。 */
  const overwrite = placementCountsOf(
    [
      { tag: 'New' },
      {},
      deal('2026-10-28T10:00', '2026-10-28T22:00'),
      { subTag: 'Black Friday' },
      { isTeaser: true },
    ],
    now2,
    { mode: 'overwrite' },
  )
  check('overwrite reaches the first line everywhere', overwrite.first, 4)
  check('nothing is pushed to a second line', overwrite.second, 0)
  check('and only Coming Soon is invisible', overwrite.hidden, 1)
}

console.log('\n[3c] badgeWriteFor — which columns the two modes actually touch')

const draft = { tag: 'Black Friday', badgeColor: '#C08A2E' }

check('the second line writes the plain badge', badgeWriteFor('append', draft, undefined), {
  badge: { tag: 'Black Friday', badgeColor: '#C08A2E' },
  touchTag: true,
  sub: undefined,
})
check(
  'the second line can carry a campaign badge as well',
  badgeWriteFor('append', draft, { subTag: 'Black Friday', subBadgeColor: '#2B2B2B' }).sub,
  { subTag: 'Black Friday', subBadgeColor: '#2B2B2B' },
)
check(
  'an empty second line leaves the plain column alone',
  badgeWriteFor('append', { tag: '', badgeColor: '' }, { subTag: 'Black Friday' }),
  {
    badge: { tag: '', badgeColor: '' },
    touchTag: false,
    sub: { subTag: 'Black Friday' },
  },
)
/* 这一条是整件事的核心：覆盖写的是 `sub_tag`。写 `tag` 的话，正在秒杀的
 * 商品第一行永远是 Limited Deal —— 后台说"已覆盖"，前台纹丝不动。 */
check('the first line writes the campaign column', badgeWriteFor('overwrite', draft, undefined), {
  badge: { tag: '', badgeColor: '' },
  touchTag: false,
  sub: { subTag: 'Black Friday', subBadgeColor: '#C08A2E' },
})
/* 只写一列：覆盖不是"把商品的其他信息擦掉"，想清空有专门的按钮。 */
check(
  'and it leaves the plain label column alone',
  badgeWriteFor('overwrite', draft, undefined).touchTag,
  false,
)
check(
  'the optional campaign field is ignored in that mode',
  badgeWriteFor('overwrite', draft, { subTag: 'Cyber Monday' }).sub.subTag,
  'Black Friday',
)
check('both modes are offered', BADGE_WRITE_MODES.map((m) => m.id), ['append', 'overwrite'])
check(
  'the labels say which line, not which verb',
  BADGE_WRITE_MODES.map((m) => m.label.startsWith(m.id === 'append' ? '第二行' : '第一行')),
  [true, true],
)

console.log('\n[4] empty vs clear')

check('an empty draft is empty', isBadgeDraftEmpty({ text: '' }), true)
check('whitespace is empty', isBadgeDraftEmpty({ text: '   ' }), true)
check('a real word is not', isBadgeDraftEmpty({ text: 'Black Friday' }), false)
check('a colour alone is still empty', isBadgeDraftEmpty({ text: '', color: '#C08A2E' }), true)

console.log('\n[5] the real regression — a live deal must show the campaign, not Limited Deal')

/* 复现用户那条:41 件秒杀商品，后台用「第一行 · 活动标」(旧叫"覆盖原标签")
 * 统一设成 Black Friday，回到目录却只看到 Limited Deal。 */
{
  const now = Date.now()
  /* 一件正在秒杀的商品（有窗口、有价格、非预告）。 */
  const liveDeal = {
    saleStart: '2026-10-28T00:00:00',
    saleEnd: '2026-10-29T23:59:59',
    salePrice: '19.99',
    originalPrice: '39.99',
    isTeaser: false,
    tag: '',
    subTag: '',
  }
  /* 模拟后台的写入路径：badgeWriteFor('overwrite') → setProductsBadge 落到 sub_tag。 */
  const plan = badgeWriteFor('overwrite', normaliseBadgeDraft({ text: 'Black Friday', color: '#C08A2E' }), undefined)
  const written = {
    ...liveDeal,
    subTag: plan.sub?.subTag ?? liveDeal.subTag,
    subBadgeColor: plan.sub?.subBadgeColor ?? liveDeal.subBadgeColor,
    /* overwrite 不动普通标那一列 */
    tag: plan.touchTag ? plan.badge.tag : liveDeal.tag,
  }
  const stack = badgeStackFor(written, now, { zone: BADGE_ZONE.CATALOGUE }).map((b) => b.text)
  console.log('   catalogue after overwrite:', JSON.stringify(stack))
  check('the campaign wins the first line', stack[0], 'Black Friday')
  check('Limited Deal does NOT replace it', stack.includes('Limited Deal'), false)
  check('exactly one badge on the catalogue', stack.length, 1)

  /* 反面:用错槽位(旧 bug，写 tag)时,正在秒杀的款第一行就是 Limited Deal ——
   * 这条确保我们**没有**退回那个写法。 */
  const wrong = { ...liveDeal, tag: 'Black Friday', subTag: '' }
  const wrongStack = badgeStackFor(wrong, now, { zone: BADGE_ZONE.CATALOGUE }).map((b) => b.text)
  console.log('   catalogue if written to tag (old bug):', JSON.stringify(wrongStack))
  check('the old slot is the failure case', wrongStack[0], 'Limited Deal')

  /* 普通(非秒杀)商品用第一行模式同样生效。 */
  const plain = { tag: '', subTag: '' }
  const plainWritten = { ...plain, subTag: 'Black Friday' }
  check(
    'a non-deal product shows it too',
    badgeStackFor(plainWritten, now, { zone: BADGE_ZONE.CATALOGUE })[0]?.text,
    'Black Friday',
  )
}

console.log(
  `\n${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${passed} passed, ${failed} failed\n`,
)
process.exit(failed === 0 ? 0 : 1)
