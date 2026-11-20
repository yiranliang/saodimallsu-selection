-- ============================================================
-- 一个商品可以属于多个分类
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么
-- ────
-- `products.category` 是单值外键，所以一件商品只能挂一个分类。但真实目录里
-- 有跨线的情况（套装既属于 Sets 也属于 Dresses、开衫既属于 Tops 也属于 Knits）。
--
-- 做法
-- ────
-- 保留 `products.category` 当**主分类**（导入、编辑器、外键级联都不动），
-- 额外归属放这张成员表。前台/后台筛选改成"任一命中"，菜单计数按商品去重。
-- ============================================================

create table if not exists public.product_categories (
  product_id text        not null references public.products(id)   on delete cascade,
  category   text        not null references public.categories(name)
                          on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, category)
);

create index if not exists product_categories_category_idx
  on public.product_categories (category);

comment on table public.product_categories is
  '商品的额外分类归属。主分类仍在 products.category；这里只放主分类之外的。';

alter table public.product_categories enable row level security;

drop policy if exists "product_categories readable" on public.product_categories;
create policy "product_categories readable"
  on public.product_categories for select
  using (true);

drop policy if exists "product_categories writable by admin" on public.product_categories;
create policy "product_categories writable by admin"
  on public.product_categories for all
  using (public.is_admin())
  with check (public.is_admin());

-- 历史数据：把每件商品的主分类写进成员表，保证"任一命中"从第一天就成立。
insert into public.product_categories (product_id, category)
select id, category
  from public.products
 where coalesce(category, '') <> ''
on conflict do nothing;

-- 检查
-- select category, count(*) from public.product_categories group by 1 order by 2 desc;
