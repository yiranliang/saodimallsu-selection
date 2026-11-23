-- ============================================================
-- 一级分组（category_groups）
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么
-- ────
-- 上一版把一级分组写死在前端（Tops / Bottoms / …），运营没法自己加。
-- 这张表让分组本身也成为数据：可新增、改名、删除、排序。
--
-- categories.group_name 仍存"这个分类属于哪个分组"，只是可选值来自这里。
-- ============================================================

create table if not exists public.category_groups (
  name       text primary key,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.category_groups is
  '前台 SHOP 菜单的一级分组。categories.group_name 存的是这里的 name。';

alter table public.category_groups enable row level security;

drop policy if exists "category_groups readable" on public.category_groups;
create policy "category_groups readable"
  on public.category_groups for select
  using (true);

drop policy if exists "category_groups writable by admin" on public.category_groups;
create policy "category_groups writable by admin"
  on public.category_groups for all
  using (public.is_admin())
  with check (public.is_admin());

-- 初始分组（和前端原来的五个保持一致，按顺序插）
insert into public.category_groups (name, sort_order) values
  ('Tops', 0),
  ('Bottoms', 1),
  ('Sets & Dresses', 2),
  ('Accessories', 3),
  ('Shoes', 4)
on conflict (name) do nothing;

-- 检查
-- select name, sort_order from public.category_groups order by sort_order;
