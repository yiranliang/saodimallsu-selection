-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 商品预告（is_teaser / Coming Soon）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists）。
--
--  为什么是独立布尔列，不塞进 tag / json
--  ─────────────────────────────────────
--  预告不是「角标文案」：角标是给人看的，预告决定的是**能不能下单**。
--  混进 tag 意味着前台要靠字符串匹配来判断交易状态，一次改写文案就能
--  让锁定失效。一个 not null default false 的布尔列，读写都是直来直去，
--  也能直接建部分索引（如下）。
--
--  行为
--  ────
--  is_teaser = true：
--    · 前台照常出现（不是 hidden，不隐藏商品）
--    · 卡片角标强制显示 Coming Soon（覆盖原 tag）
--    · 详情里颜色可切、尺码全部禁用、加购按钮变 Coming Soon 且禁用
--    · 购物车里历史加购行会在生成代码时被拦下（报错，不静默剔除）
--  is_teaser = false：一切恢复，角标回到原本的 tag / badge_color。
--
--  这一列不存在时前端不会崩：productStore 探测列失败会从 select 里剔掉它，
--  写入时也不带它（见 src/store/productStore.js 的 OPTIONAL_COLUMNS）。
--  也就是说：**先跑这条 SQL，再去后台打开开关**，顺序反了开关存不进去。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists is_teaser boolean not null default false;

comment on column public.products.is_teaser is
  'true = Coming Soon：前台可见但尺码锁定、不可加购、不可生成选择码。与 hidden 无关。';

-- 前台/后台都只在小范围里筛「是不是预告」，部分索引足够。
create index if not exists products_is_teaser_idx
  on public.products (is_teaser)
  where is_teaser;

-- 检查：跑完应该能看到 is_teaser 列，现有商品全是 false
-- select id, sku, is_teaser from public.products limit 10;

-- 想直接在数据库里把某个商品标成预告也可以：
-- update public.products set is_teaser = true where sku = 'P9B013';
