-- ============================================================
-- Saodimallsu Selection — 秒杀档期表（一个货号多条时间窗）
-- Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
-- 幂等：可以重复执行。
--
-- 为什么需要一张新表
-- ─────────────────
-- 之前秒杀信息存在 products 行上（sale_start / sale_end / sale_price /
-- original_price / is_campaign），一件商品因此**只有一个**档期。运营的实际
-- 情况是同一件商品今天、后天、大后天各打折一次 —— 那张表装不下。
--
-- 这里把它拆成 deals：一行 = 一个档期，按 sku 关联商品。前台取这件商品的
-- 「进行中的那一档」；都还没开始就取「最近的一档」；全都结束了就当作没有秒杀。
--
-- 兼容
-- ────
-- products 上那五个旧列保留不动，且**优先级更低**：deals 里有这个 sku 的行时
-- 用 deals，没有就退回旧列。这样迁移过程中两边都能读，历史数据也不需要搬。
-- ============================================================

create table if not exists public.deals (
  id              uuid primary key default gen_random_uuid(),
  sku             text        not null,
  sale_start      timestamptz not null,
  sale_end        timestamptz not null,
  sale_price      numeric(10, 2),
  original_price  numeric(10, 2),
  is_campaign     boolean     not null default false,
  sub_tag         text        not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint deals_window_valid check (sale_end > sale_start)
);

comment on table public.deals is
  '秒杀档期：一行一个时间窗，按 sku 关联 products。前台取进行中/最近的一档。';

create index if not exists deals_sku_idx on public.deals (sku);
create index if not exists deals_window_idx on public.deals (sale_start, sale_end);

-- 幂等 upsert 需要这三列上有唯一索引，否则 PostgREST 会拒绝整个 upsert
-- （"no unique or exclusion constraint matching the ON CONFLICT specification"）。
delete from public.deals a
using public.deals b
where a.ctid < b.ctid
  and a.sku = b.sku
  and a.sale_start = b.sale_start
  and a.sale_end = b.sale_end;

create unique index if not exists deals_window_uniq
  on public.deals (sku, sale_start, sale_end);

alter table public.deals enable row level security;

drop policy if exists deals_read on public.deals;
create policy deals_read on public.deals
  for select using (true);

drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals
  for insert with check (public.is_admin());

drop policy if exists deals_update on public.deals;
create policy deals_update on public.deals
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals
  for delete using (public.is_admin());

-- 实时：运营导完档期，已经打开的前台要自己更新。
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deals'
  ) then
    alter publication supabase_realtime add table public.deals;
  end if;
end $$;

alter table public.deals replica identity full;

-- 检查
-- select sku, count(*) from public.deals group by sku order by 2 desc limit 20;
