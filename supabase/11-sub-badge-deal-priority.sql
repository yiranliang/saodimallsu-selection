-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 副角标（sub_tag / sub_badge_color）+ 秒杀专区置顶（deal_priority）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists）。
--
--  为什么副角标是独立的两列，而不是塞进 tag
--  ──────────────────────────────────────
--  黑五期间一件商品要同时说两件事："它在秒杀"（⚡ 25% OFF，由 sale_* 实时算出）
--  和"它是黑五主推"（运营手填）。前者是**状态**，后者是**决定** —— 状态会随
--  时间自己变，决定不会。挤进同一个 `tag` 就只能二选一，或者让运营每天手动
--  在两种文案之间改来改去。
--
--  所以：主角标仍在左上（tag + badge_color，优先级 Coming Soon > ⚡ Deal >
--  💰 ACC > tag），副角标固定在右上（sub_tag + sub_badge_color），两者互不
--  覆盖。副角标不参与 `badgeFor` 的那条优先级链 —— 它从来不是"替代品"。
--
--  为什么置顶是一个整数，而不是布尔
--  ──────────────────────────────
--  布尔只能表达"钉住/没钉住"，而专区里通常有一批主推、彼此之间还要分先后
--  （1 = 最前）。0 = 不参与置顶，和现有商品的默认值一致，所以这次迁移不需要
--  回填数据。排序规则见 utils/deal.js 的 `dealsOrder`：
--      deal_priority 降序 → 结束/开始时间升序 → 后台拖拽序
--  置顶**只在秒杀专区内生效**，常规货架仍按 sort_order —— 货架不该因为一场
--  活动自己重排。
--
--  三列缺失时前端都不会崩：productStore 探测到列不存在会从 select 里剔掉，
--  写入时也不带它（见 OPTIONAL_COLUMNS）。也就是说：**先跑这条 SQL，再去
--  后台填副角标 / 填置顶**，顺序反了这两项存不进去（主角标和秒杀不受影响）。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists sub_tag text not null default '';

alter table public.products
  add column if not exists sub_badge_color text;

alter table public.products
  add column if not exists deal_priority integer not null default 0;

comment on column public.products.sub_tag is
  '副角标文字（前台右上角）。空字符串 = 不显示。与 tag 互不覆盖，黑五期间用于「Black Friday」这类主推标识。';

comment on column public.products.sub_badge_color is
  '副角标背景色 #RRGGBB（大写）。null = 默认炭灰。文字色由亮度自动选，见 utils/badge.js。';

comment on column public.products.deal_priority is
  '秒杀专区内置顶权重，越大越前。0 = 不置顶。只在 ⚡ Limited Deal 专区生效，不影响常规货架 sort_order。';

-- 专区列表最多几百行，这个索引只在真要用大数字置顶时才被 planner 选中；
-- 部分索引（where <> 0）让它保持在几十字节，不为"所有商品都是 0"付代价。
create index if not exists products_deal_priority_idx
  on public.products (deal_priority desc, sort_order)
  where deal_priority <> 0;

-- 检查：跑完应该能看到三列，现有商品 sub_tag = ''、deal_priority = 0
-- select id, sku, tag, sub_tag, deal_priority from public.products limit 10;

-- 想在数据库里直接给黑五主推置顶也可以（例：权重 5 的最前）：
-- update public.products set sub_tag = 'Black Friday', sub_badge_color = '#2B2B2B',
--        deal_priority = 5 where sku in ('P5B008', 'N2Z033');
