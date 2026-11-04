-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 商品图片数（photo_count）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists / create or replace / drop trigger if exists）。
--
--  为什么要这一列
--  ──────────────
--  后台列表上那枚「N 张图」角标，原本是数 `variant_images`（{ 颜色类型: { 选项: URL } }）
--  得出的。但这一列是整张 products 表里**体积最不可控**的一列：每个颜色一条 CDN
--  URL，补完图的商品一条就是 0.5–2 KB。列表一屏 24 件、整个目录三百件，为了一个
--  整数把几 MB 的 JSON 全拉下来，是后台最大的 Egress 来源之一。
--
--  加一个 `photo_count` 之后，列表只查这个整数；`variant_images` 只在**打开单个
--  商品编辑器**时单条拉取（懒加载）。角标显示的数字与以前完全一致 —— 触发器用的
--  就是前端原来那套数法（逐层数非空 URL）。
--
--  为什么用触发器而不是生成列
--  ──────────────────────────
--  `variant_images` 是 json（不是 jsonb），形状是"类型 → { 选项 → URL }"的两层
--  对象。生成列只能写不可变表达式，跨两层数"非空字符串"做不了；改成 jsonb 又会
--  重排键序 —— 那会毁掉历史选款码（见 HANDOVER 红线：specs / variant_images 必须
--  是 json）。所以用一个 BEFORE 触发器在写入时算好。
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. 列本身。默认 0 = 没有专属图，前台会回落到主图。
alter table public.products
  add column if not exists photo_count integer not null default 0;

comment on column public.products.photo_count is
  'variant_images 里非空图片 URL 的数量（由触发器维护）。后台列表用它渲染「N 张图」，从而不必拉取 variant_images 本体。';

-- 2. 维护函数：逐层数非空 URL。
--    { "Colour": { "Black": "https://…", "White": "" }, "Size": {} }  → 1
create or replace function public.products_sync_photo_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer := 0;
  group_json json;
  group_count integer;
begin
  if new.variant_images is null or json_typeof(new.variant_images) <> 'object' then
    new.photo_count := 0;
    return new;
  end if;

  for group_json in
    select value from json_each(new.variant_images)
  loop
    if group_json is null or json_typeof(group_json) <> 'object' then
      continue;
    end if;

    select count(*) into group_count
    from json_each_text(group_json) as photo
    where btrim(coalesce(photo.value, '')) <> '';

    total := total + coalesce(group_count, 0);
  end loop;

  new.photo_count := total;
  return new;
end;
$$;

-- 3. 只在 variant_images 变化时重算（INSERT 也覆盖到）。
drop trigger if exists products_photo_count on public.products;
create trigger products_photo_count
  before insert or update of variant_images on public.products
  for each row execute function public.products_sync_photo_count();

-- 4. 回填存量。只有"确实带图"的行会被改写（`variant_images` 为空对象的直接
--    跳过，它们本来就是 0）。注意：这一条会触发 `products_touch`，把被改到的
--    行的 `updated_at` 刷成现在 —— 没有界面按这一列排序，所以无害，但先说清楚。
update public.products as p
set photo_count = coalesce((
  select sum((
    select count(*)
    from json_each_text(g.value) as photo
    where btrim(coalesce(photo.value, '')) <> ''
  ))
  from json_each(p.variant_images) as g
  where json_typeof(g.value) = 'object'
), 0)::int
where p.variant_images is not null
  and json_typeof(p.variant_images) = 'object'
  and p.variant_images::text not in ('{}', 'null');

-- ── 检查：跑完执行这两段 ───────────────────────────────────────────────────
--
-- a) 列和默认值都在
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'products' and column_name = 'photo_count';
-- 预期：photo_count | integer | NO | 0
--
-- b) 数字对得上：这两列应该恒等（预期 0 行不一致）
-- select id, sku, photo_count,
--        coalesce((
--          select sum((select count(*) from json_each_text(g.value) as photo
--                      where btrim(coalesce(photo.value, '')) <> ''))
--          from json_each(p.variant_images) as g
--          where json_typeof(g.value) = 'object'
--        ), 0) as expected
-- from public.products p
-- where photo_count <> coalesce((
--          select sum((select count(*) from json_each_text(g.value) as photo
--                      where btrim(coalesce(photo.value, '')) <> ''))
--          from json_each(p.variant_images) as g
--          where json_typeof(g.value) = 'object'
--        ), 0);
--
-- c) 触发器在
-- select tgname from pg_trigger
-- where tgrelid = 'public.products'::regclass and tgname = 'products_photo_count';
