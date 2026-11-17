-- ============================================================
-- deals：折扣文案列（可编辑、可同步）
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么
-- ────
-- 「折扣率」是导入表里的一列（如 20% OFF），此前只落在 products 上，档期表
-- 里没有。档期页要能编辑它、并且和商品库同步，所以把它变成档期自己的列：
-- 前台合并档期时会用它覆盖商品上的值。
-- ============================================================

alter table public.deals
  add column if not exists discount_label text not null default '';

comment on column public.deals.discount_label is
  '折扣文案（如 20% OFF）。空 = 由两个价格算，算不出就不显示。';

-- 检查
-- select sku, sale_price, original_price, discount_label from public.deals limit 5;
