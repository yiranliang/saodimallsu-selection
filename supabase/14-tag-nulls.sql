-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 放开角标列的 NOT NULL（14）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行。`drop not null` / `drop default` 对已经满足的列是空操作。
--
--  为什么要跑这一条
--  ────────────────
--  11-sub-badge-deal-priority.sql 建 sub_tag 时写的是
--      add column if not exists sub_tag text not null default '';
--  所以这一列**不允许 NULL**。而"清空活动标"的代码路径（清空/改写秒杀时自动
--  摘掉 Black Friday，见 src/utils/deal.js 的 dropsCampaignTag）写的是 NULL，
--  于是整条 upsert 被数据库拒绝 —— 表现是"清空秒杀失败"，而不是角标没清掉。
--
--  那个看着很奇怪的默认值 `':text`
--  ────────────────────────────
--  它就是 `''::text`（空字符串 + 类型转换）。Postgres 存默认值时会带上显式
--  转换，`\d products` 或 information_schema 里会显示成 `''::text`；如果终端/
--  界面把两个单引号折叠了，就剩一个像 `':text` 的东西。**它不是脏数据，也不是
--  被写坏的默认值** —— 但既然这一列允许为空了，这个默认值就没有存在意义，
--  一并 drop 掉，避免以后有人看到它再怀疑一次。
--
--  为什么 tag 也一起放开
--  ────────────────────
--  `tag` 在 01-schema.sql 里是 `not null default ''`。代码目前总是显式写空串，
--  所以没炸过；但它和新规则（"没有角标 = 空/无"）是同一个语义，留着 NOT NULL
--  只会让下一次"清空"再踩一次。badge_color 本来就可空，这里写一遍是为了让
--  这段脚本自己就能回答"四列现在到底什么状态"，而不是靠记忆。
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. sub_tag：允许 NULL，并清掉 ''::text 这个默认值
alter table public.products alter column sub_tag drop not null;
alter table public.products alter column sub_tag drop default;

-- 2. tag：允许 NULL（默认值 '' 保留 —— 它是正常写法，不是转换产物）
alter table public.products alter column tag drop not null;

-- 3. badge_color / sub_badge_color：本来就允许为空。写成幂等语句，
--    万一是老库建表时带了 NOT NULL，这里一并放开。
alter table public.products alter column badge_color drop not null;
alter table public.products alter column sub_badge_color drop not null;

-- 4. 统一注释，和后端写法对齐：空串与 NULL 都表示"没有"
comment on column public.products.sub_tag is
  '副角标文字（前台右上角）。空字符串或 NULL = 不显示。清空秒杀时活动标会被自动置空（见 utils/deal.js 的 dropsCampaignTag）。';
comment on column public.products.tag is
  '主角标文字。空字符串或 NULL = 不显示。';

-- ── 检查：跑完把下面这段单独执行一遍 ──────────────────────────────────────
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'products'
--   and column_name in ('tag', 'badge_color', 'sub_tag', 'sub_badge_color')
-- order by column_name;
--
-- 预期（4 行）：
--   badge_color     | YES | NULL
--   sub_badge_color | YES | NULL
--   sub_tag         | YES | NULL      ← 关键：null 放开了，默认值也没了
--   tag             | YES | ''::text   ← 只放开 NOT NULL，默认值 '' 保留
--
-- 另外看一眼存量里"没有副角标"的两种写法各有多少（两者等价，预期总数 = 全表）：
-- select
--   count(*) filter (where sub_tag is null) as as_null,
--   count(*) filter (where sub_tag = '')    as as_empty
-- from public.products;
