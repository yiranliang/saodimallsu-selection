-- ============================================================
-- 分类的一级归属（categories.group_name）
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么
-- ────
-- SHOP 菜单是两级：一级（Tops / Bottoms …）→ 二级（具体分类）。但 categories
-- 只有 name + sort_order，没有"父级"。这个关系先写在前端关键词表里，运营新增
-- 分类（比如 Loungewear）就会落进兜底的「More」。
--
-- 加一列把它交给数据：后台「设置 → 分类」里每个分类选一个一级分组，前台菜单
-- 直接读这一列。留空 = 未分组，前台会按关键词兜底，不会消失。
-- ============================================================

alter table public.categories
  add column if not exists group_name text not null default '';

comment on column public.categories.group_name is
  '一级分组名（Tops / Bottoms / Sets & Dresses / Accessories / Shoes）。空字符串 = 未分组。';

-- 按现有命名习惯回填一次，跑完之后运营可以逐个改。
update public.categories
   set group_name = 'Tops'
 where group_name = ''
   and (
     name ilike '%top%'
     or name ilike '%sweatshirt%'
     or name ilike '%jacket%'
     or name ilike '%cardigan%'
     or name ilike '%pullover%'
     or name ilike '%blazer%'
     or name ilike '%vest%'
     or name ilike '%outerwear%'
     or name ilike '%shirt%'
   );

update public.categories
   set group_name = 'Bottoms'
 where group_name = ''
   and (
     name ilike '%bottom%'
     or name ilike '%pants%'
     or name ilike '%jogger%'
     or name ilike '%jeans%'
     or name ilike '%skirt%'
     or name ilike '%shorts%'
   );

update public.categories
   set group_name = 'Sets & Dresses'
 where group_name = ''
   and (name ilike '%set%' or name ilike '%dress%');

update public.categories
   set group_name = 'Accessories'
 where group_name = ''
   and (
     name ilike '%scarf%'
     or name ilike '%hat%'
     or name ilike '%cover%'
     or name ilike '%accessor%'
   );

update public.categories
   set group_name = 'Shoes'
 where group_name = ''
   and (name ilike '%shoe%' or name ilike '%boot%' or name ilike '%sandal%');

-- 检查
-- select name, group_name from public.categories order by sort_order;
