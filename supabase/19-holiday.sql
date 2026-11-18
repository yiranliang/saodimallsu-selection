-- ============================================================
-- 节日专区开关（products.is_holiday）
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么
-- ────
-- 「节日特选」以前靠 tag 里的一枚 Holiday 来表达：打开开关会往标签里塞一个词，
-- 删掉那个词开关就自动关。语义被绑在一起，运营也没法给商品只开节日、不打标签。
-- 现在它是一列独立的布尔值，和 Coming Soon（is_teaser）同一个做法。
-- ============================================================

alter table public.products
  add column if not exists is_holiday boolean not null default false;

comment on column public.products.is_holiday is
  '节日特选：为 true 时进入前台节日专区（独立于 tag，不再写 Holiday 标签）。';

-- 历史数据：以前靠标签表达节日的那批商品，一次性迁到这个开关上。
update public.products
   set is_holiday = true
 where coalesce(is_holiday, false) = false
   and (
     tag ilike '%holiday%'
     or tag ilike '%christmas%'
     or tag ilike '%xmas%'
     or tag ilike '%festive%'
     or tag ilike '%圣诞%'
     or tag ilike '%节日%'
   );

-- 检查
-- select count(*) from public.products where is_holiday;
