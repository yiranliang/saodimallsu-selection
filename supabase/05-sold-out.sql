-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 单变体断货（Sold out）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行。
--
--  为什么是「组合级」而不是「颜色级」
--  ────────────────────────────────────
--  真实断货是 SKU 级的 —— 最先卖完的永远是某个尺码。只记颜色的话，
--  标了 Green 就会把还有货的 Green|L 一起干掉。
--
--  键的格式和 asins.variants 完全一样（"Colour|Size"，见 utils/sku.js 的
--  variantKey），所以「这个组合有没有 ASIN」和「这个组合有没有货」共用同一套
--  查法。one size 商品的 size 段为空，键是 "Green|"。
--
--  为什么是 json 不是 jsonb
--  ────────────────────────
--  和 specs / variant_images 保持一致。jsonb 会按长度重排键，这个项目已经
--  因为 jsonb 差点让历史选款码解错。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists sold_out_variants json not null default '[]'::json;

-- 只允许数组。写成 {"Colour":["Green"]} 会让前台的 every/includes 静默失效，
-- 那种错法没有任何报错，只是断货标记全部不生效。
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sold_out_is_array'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sold_out_is_array
      check (json_typeof(sold_out_variants) = 'array');
  end if;
end $$;

comment on column public.products.sold_out_variants is
  '断货的变体组合，格式 ["Green|S","Green|M"]，键与 asins.variants 一致。空数组 = 全部有货。';

-- 检查：跑完应该能看到这一列，且默认值是 []
-- select id, sku, sold_out_variants from public.products limit 5;

-- 想在数据库里手改也可以（注意 json 是整体替换，不是合并）：
-- update public.products
--    set sold_out_variants = '["Green|S","Green|M"]'::json
--  where sku = 'P9B013';
