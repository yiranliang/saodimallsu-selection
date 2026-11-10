/**
 * 批量设置标签 self-check
 *   node scripts/test-batch-badge.mjs
 *
 * Pure Node — no browser, no database.
 *
 * 这一版后台只有一个字段：`tag`。多个标签写成 `Bestseller, New`，前台按同一
 * 条规则切分并最多显示 3 枚（`trustBadgesFor`）。所以这里锁的是**字符串形状**：
 *
 *   [1] normaliseBadgeDraft —— 折叠空白、截断、清空文字时颜色一并不写
 *   [2] 多标签分隔符 —— 逗号 / 顿号 / 竖线，去重，最多 3 枚
 *   [3] 快捷文案 —— 必须是**属性**词（Bestseller / New / Highly Recommend），
 *       不能是活动名（Black Friday 之类在卡片上会被隐藏）
 *   [4] 边界 —— 空文字不写颜色；输出的键只有 tag + badgeColor
 */

import {
  BATCH_BADGE_MAX,
  BATCH_BADGE_MAX_TAGS,
  BATCH_BADGE_QUICK_PICKS,
  CAMPAIGN_QUICK_PICKS,
  isBadgeDraftEmpty,
  normaliseBadgeDraft,
  normaliseCampaignDraft,
  planBadgeApply,
  tagCountOf,
} from '../src/utils/batchBadge.js'
import { MAX_TAGS, normaliseTagList } from '../src/utils/badge.js'

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

/* ── 1. 规整 ── */
console.log('\n[1] normaliseBadgeDraft')

check(
  'pasted whitespace collapses',
  normaliseBadgeDraft({ text: '  Best   seller  ', color: '#c8855a' }),
  { tag: 'Best seller', badgeColor: '#C8855A' },
)
check('empty text clears the colour too', normaliseBadgeDraft({ text: '   ', color: '#C8855A' }), {
  tag: '',
  badgeColor: '',
})
check('only two keys are written', Object.keys(normaliseBadgeDraft({ text: 'New' })).sort(), [
  'badgeColor',
  'tag',
])
check('a very long string is capped', normaliseBadgeDraft({ text: 'x'.repeat(200) }).tag.length <= BATCH_BADGE_MAX, true)
check('it is idempotent', normaliseBadgeDraft(normaliseBadgeDraft({ text: 'New, Bestseller' })), {
  tag: 'New, Bestseller',
  badgeColor: '',
})

/* ── 2. 多标签 ── */
console.log('\n[2] Multiple tags in one field')

check('comma separated', normaliseTagList('Bestseller, New'), 'Bestseller, New')
check('ideographic comma', normaliseTagList('Bestseller、New'), 'Bestseller, New')
check('pipe', normaliseTagList('Bestseller|New'), 'Bestseller, New')
check('extra spaces are normalised', normaliseTagList('  Bestseller ,   New '), 'Bestseller, New')
check('empty pieces are dropped', normaliseTagList('Bestseller,, New'), 'Bestseller, New')
check('duplicates (case-insensitive) are dropped', normaliseTagList('New, new, NEW'), 'New')
check('at most three tags', normaliseTagList('A, B, C, D, E'), 'A, B, C')
check('MAX_TAGS is 3', MAX_TAGS, 3)
check('the dialog knows the same cap', BATCH_BADGE_MAX_TAGS, MAX_TAGS)
check('empty in, empty out', normaliseTagList(''), '')
check('null is safe', normaliseTagList(null), '')

check('draft keeps the order', normaliseBadgeDraft({ text: 'New, Bestseller' }).tag, 'New, Bestseller')
check('draft counts two tags', tagCountOf('Bestseller, New'), 2)
check('draft counts zero', tagCountOf(''), 0)
check('a single tag stays a single tag', normaliseBadgeDraft({ text: 'Bestseller' }).tag, 'Bestseller')

/* ── 3. 快捷文案 ── */
console.log('\n[3] Quick picks are attributes, not campaigns')

check('three quick picks', BATCH_BADGE_QUICK_PICKS.length, 3)
check(
  'none of them is a campaign name',
  BATCH_BADGE_QUICK_PICKS.filter((pick) => /black friday|cyber monday|%\s*off/i.test(pick)),
  [],
)
check('they survive a normalise round-trip', normaliseBadgeDraft({ text: BATCH_BADGE_QUICK_PICKS[0] }).tag, BATCH_BADGE_QUICK_PICKS[0])

/* ── 4. 边界 ── */
console.log('\n[4] Boundaries')

check('empty draft is empty', isBadgeDraftEmpty({ text: '', color: '#C8855A' }), true)
check('whitespace only is empty', isBadgeDraftEmpty({ text: '   ' }), true)
check('one tag is not empty', isBadgeDraftEmpty({ text: 'New' }), false)
check(
  'a colour without text is not a draft',
  normaliseBadgeDraft({ color: '#C8855A' }),
  { tag: '', badgeColor: '' },
)

/* ── 5. 大促标签与"防误触" ──
 *
 * `sub_tag` 只决定商品进哪个大促专区 Tab，不上卡片。它和运营标签是两条独立
 * 的写入路径 —— 这里锁住最关键的一条：**不勾选就一个字都不写**。 */
console.log('\n[5] Campaign tag stays independent')

check('trimmed and collapsed', normaliseCampaignDraft({ text: '  Black   Friday ' }), {
  subTag: 'Black Friday',
  subBadgeColor: '',
})
check(
  'the colour travels with it',
  normaliseCampaignDraft({ text: 'Cyber Monday', color: '#c62828' }),
  { subTag: 'Cyber Monday', subBadgeColor: '#C62828' },
)
check('empty text clears the colour', normaliseCampaignDraft({ text: '  ', color: '#C62828' }), {
  subTag: '',
  subBadgeColor: '',
})
check(
  'a campaign name is NOT split on commas',
  normaliseCampaignDraft({ text: 'Black Friday, Cyber Monday' }).subTag,
  'Black Friday, Cyber Monday',
)
check('campaign quick picks are the two holidays', CAMPAIGN_QUICK_PICKS, [
  'Black Friday',
  'Cyber Monday',
])

/* 只改运营标签：`sub` 必须是 undefined —— 存储层据此完全不碰 sub_tag。 */
const tagsOnly = planBadgeApply({ tags: 'Bestseller', writeCampaign: false })
check('tags only → badge is written', tagsOnly.badge, { tag: 'Bestseller', badgeColor: '' })
check('tags only → sub is undefined', tagsOnly.sub, undefined)

/* 清空运营标签时同样不碰大促标签。 */
const clearTags = planBadgeApply({ tags: '', writeCampaign: false })
check('clearing tags writes no badge', clearTags.badge, null)
check('clearing tags leaves the campaign alone', clearTags.sub, undefined)

/* 只改大促标签：`badge` 为 null，运营标签原样保留。 */
const campaignOnly = planBadgeApply({ campaign: 'Black Friday', writeCampaign: true })
check('campaign only → no badge write', campaignOnly.badge, null)
check('campaign only → sub is written', campaignOnly.sub, {
  subTag: 'Black Friday',
  subBadgeColor: '',
})

/* 两个一起改。 */
const both = planBadgeApply({
  tags: 'Bestseller, New',
  color: '#1F7A55',
  campaign: 'Cyber Monday',
  campaignColor: '#C62828',
  writeCampaign: true,
})
check('both → tags normalised', both.badge, { tag: 'Bestseller, New', badgeColor: '#1F7A55' })
check('both → campaign kept whole', both.sub.subTag, 'Cyber Monday')
check('both → campaign colour kept', both.sub.subBadgeColor, '#C62828')

/* 勾了开关但输入为空 = 有意清空大促标签。 */
const clearCampaign = planBadgeApply({ campaign: '', writeCampaign: true })
check('an empty campaign with the switch on clears it', clearCampaign.sub, {
  subTag: '',
  subBadgeColor: '',
})

console.log(`\n${'─'.repeat(44)}`)
console.log(`Passed ${passed}${failed ? `, failed ${failed}` : ''}`)
if (failed) process.exit(1)
