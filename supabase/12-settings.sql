-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 全局设置（settings）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行。
--
--  为什么需要一张表，而不是 localStorage / 前端常量
--  ──────────────────────────────────────────────
--  这个值是**给红人看的**：运营在黑五期间把「Limited Deals」改成
--  「Black Friday Deals」，红人手机上必须同步。localStorage 只存在于运营
--  自己那台电脑的浏览器里；写死成常量则要发一次版才能改名。所以它必须跟着
--  数据库走 —— 这也是唯一能"改完立刻生效、所有设备一致"的存法。
--
--  为什么是 key/value 而不是给 products 加一列
--  ─────────────────────────────────────────
--  这是站点级配置，不属于任何一件商品。塞进 products 就得每行重复一遍，
--  改一次要写 273 行，还会让"商品表"多出一个和商品无关的字段。
--
--  表极小（现在只有一个 key），读一次即全量缓存，写只有 admin 能做。
--  ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.settings (
  key         text        primary key,
  value       text        not null default '',
  updated_at  timestamptz not null default now()
);

comment on table public.settings is
  '站点级配置（key/value）。目前只有 deals_tab_label：前台 ⚡ 秒杀专区的展示名。';

alter table public.settings enable row level security;

-- 读：所有人。前台（含未登录的红人）要拿这个字符串来渲染 Tab 名。
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select using (true);

-- 写：仅 admin。和 products / categories 同一套 is_admin() 判定。
drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert with check (public.is_admin());

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete using (public.is_admin());

-- 实时：运营改完，已经打开着的页面要跟着变（不然红人要刷新才看到）。
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
      and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;

alter table public.settings replica identity full;

-- 默认值：没有这一行时前端也会退回 'Campaign Deals'，这里写进来只是让运营
-- 第一次打开后台就看到当前生效的名字，而不是一个空输入框。
-- 注意：这个 key 命名的是**大促专区**（🔥），常规秒杀 Tab 的名字固定为
-- `Limited Deals`，不跟这个设置走。
insert into public.settings (key, value)
values ('deals_tab_label', 'Campaign Deals')
on conflict (key) do nothing;

-- 检查
-- select * from public.settings;
