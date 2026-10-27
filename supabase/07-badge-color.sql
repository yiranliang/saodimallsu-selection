-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 角标自定义颜色（badge_color）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists）。
--
--  为什么是独立列，不塞进现有 json
--  ──────────────────────────────
--  specs / variant_images / sold_out_variants 都是「和变体有关」的数据，
--  而角标颜色是商品的展示属性，跟变体无关。塞进 json 的代价是每次读都要
--  「进对象里捞」，而且将来想按颜色筛选就没法建索引。
--  一个 nullable text 列，读写都是直来直去。
--
--  格式
--  ────
--  '#RRGGBB'（大写），或 null = 用默认样式（炭灰底 + 米白字）。
--  前端 utils/badge.js 的 normaliseBadgeColor() 会把 #abc 展开、把非法值
--  （'red'、rgb()、导入时串列的脏数据）当成 null —— 所以这里不做约束：
--  加 check 会让一次脏数据把整条保存/导入打挂，而颜色本来就该安静降级。
--
--  这一列不存在时前端不会崩：productStore 探测列失败会从 select 里剔掉它，
--  写入时也不带它（见 src/store/productStore.js 的 OPTIONAL_COLUMNS）。
--  也就是说：**先跑这条 SQL，再去后台挑颜色**，顺序反了颜色存不进去。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists badge_color text;

comment on column public.products.badge_color is
  '商品角标背景色 #RRGGBB（大写）。null = 默认炭灰。仅影响前台 tag 徽标的底色，文字色由亮度自动选。';

-- 检查：跑完应该能看到 badge_color 列，现有商品全是 null
-- select id, sku, tag, badge_color from public.products where tag <> '' limit 10;

-- 想在数据库里直接给某个角标上色也可以：
-- update public.products set badge_color = '#B3453A' where tag = 'New';
