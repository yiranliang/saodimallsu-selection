-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · Supabase schema
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行，已存在的对象会跳过（policy 会先 drop 再建）。
--
--  执行顺序（本文件已按此顺序排列）：
--    1. 序列 + id 生成函数
--    2. categories / products / asins / admin_users 四张表
--    3. 触发器（分类自动补建、updated_at 维护）
--    4. 权限 GRANT
--    5. RLS 策略
--    6. Realtime publication
--
--  重要：specs / variant_images 用的是 json 而不是 jsonb。
--  原因见文件末尾「为什么是 json 不是 jsonb」——用 jsonb 会静默破坏历史选款码。
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. 商品 id 序列
--    p001 / p002 / … 现有 id 由前端「最大号 + 1」算出，多人同时新增会撞号。
--    换成数据库序列后，编号只增不减，删掉 p003 也绝不会再把 p003 发出去。
--    —— 这是「历史选款码永远有效」的前提。
-- ───────────────────────────────────────────────────────────────────────────

create sequence if not exists public.products_id_seq start with 1;

create or replace function public.next_product_id()
returns text
language sql
volatile
as $$
  select 'p' || lpad(nextval('public.products_id_seq')::text, 3, '0');
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. 表结构
-- ───────────────────────────────────────────────────────────────────────────

-- ── 2.1 categories ────────────────────────────────────────────────────────
-- name 直接做主键：products.category 用它做外键，改名可以 ON UPDATE CASCADE，
-- 不用前端再写一遍「先把商品挪过去再改名」。
--
-- 唯一的例外是「改名撞上已有分类」（Uncategorised → Tops 而 Tops 已存在）：
-- CASCADE 会撞主键，那种情况必须先 update products 把商品挪到目标分类，
-- 再 delete 掉旧分类行。这个分支由前端处理，和现在的逻辑一致。
create table if not exists public.categories (
  name        text        primary key,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.categories is
  'Storefront category rail. sort_order controls the order of the pills.';


-- ── 2.2 products ──────────────────────────────────────────────────────────
create table if not exists public.products (
  id             text        primary key default public.next_product_id(),
  sku            text,
  name           text        not null default '',
  category       text        not null default 'Uncategorised'
                               references public.categories (name)
                               on update cascade
                               on delete restrict,
  image          text        not null default './placeholders/placeholder.svg',
  specs          json        not null default '{}'::json,
  variant_images json        not null default '{}'::json,
  hidden         boolean     not null default false,
  tag            text        not null default '',
  sort_order     integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid        references auth.users (id) on delete set null,

  constraint products_specs_is_object
    check (json_typeof(specs) = 'object'),
  constraint products_variant_images_is_object
    check (json_typeof(variant_images) = 'object')
);

comment on table  public.products is
  'Catalogue. `id` is what selection codes store — never renumber, never reuse.';
comment on column public.products.sku is
  '货号 as it appears in the source sheet. data/asins.js is keyed by this.';
comment on column public.products.specs is
  '{"Colour":["Black","Oatmeal"],"Size":["S","M"]} — key order is significant.';
comment on column public.products.variant_images is
  '{"Colour":{"Black":"https://…"}} — optional per-option photos. URLs only.';
comment on column public.products.hidden is
  'true = off the storefront but still resolvable by old selection codes.';

create index if not exists products_category_idx
  on public.products (category);

create index if not exists products_sort_idx
  on public.products (sort_order, id);

-- 货号不允许重复（空值不算）—— 重复的货号会让 ASIN 映射对不上
create unique index if not exists products_sku_unique
  on public.products (sku)
  where sku is not null and sku <> '';


-- ── 2.3 asins ─────────────────────────────────────────────────────────────
-- 一行一个货号，variants 里放整张变体表，和前端 asinStore 的形状 1:1。
--   { "P9B013": { "Black|S": "B0H6XHHZ8N", "Black|M": "…" } }
-- 故意不做 products 外键：货号可改、商品可删，ASIN 表要能独立存在。
create table if not exists public.asins (
  sku        text        primary key,
  variants   json        not null default '{}'::json,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint asins_variants_is_object
    check (json_typeof(variants) = 'object')
);

comment on table public.asins is
  'One row per 货号. variants = {"Colour|Size": "ASIN"}. Never enters a selection code.';


-- ── 2.4 admin_users ───────────────────────────────────────────────────────
-- 谁能写。默认策略是「allowlist」而不是「任何登录用户」：
-- Supabase 默认开放邮箱注册，如果不关掉注册、又用 authenticated 判断权限，
-- 任何人拿自己邮箱注册一下就能删你的商品库。
create table if not exists public.admin_users (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  email      text,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Allowlist of accounts allowed to write. Rows are added by hand in the SQL Editor.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. 函数与触发器
-- ───────────────────────────────────────────────────────────────────────────

-- ── 3.1 is_admin() ────────────────────────────────────────────────────────
-- security definer：策略里调用时不需要调用者自己有 admin_users 的读权限，
-- 否则 RLS 会自己套自己，变成永远 false。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the caller is on the admin allowlist. Used by every write policy.';


-- ── 3.2 自动补建分类 ──────────────────────────────────────────────────────
-- 编辑器里分类是自由输入框（可以手打一个新分类）。
-- 外键要求分类必须存在，所以插入/改分类之前先补一行。
create or replace function public.ensure_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is null or btrim(new.category) = '' then
    new.category := 'Uncategorised';
  else
    new.category := btrim(new.category);
  end if;

  insert into public.categories (name, sort_order)
  values (
    new.category,
    coalesce((select max(c.sort_order) + 1 from public.categories c), 0)
  )
  on conflict (name) do nothing;

  return new;
end;
$$;

drop trigger if exists products_ensure_category on public.products;
create trigger products_ensure_category
  before insert or update of category on public.products
  for each row execute function public.ensure_category();


-- ── 3.3 updated_at / updated_by ───────────────────────────────────────────
create or replace function public.touch_product()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before insert or update on public.products
  for each row execute function public.touch_product();

create or replace function public.touch_asins()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists asins_touch on public.asins;
create trigger asins_touch
  before insert or update on public.asins
  for each row execute function public.touch_asins();


-- ───────────────────────────────────────────────────────────────────────────
-- 4. 权限
--    RLS 管「哪些行」，GRANT 管「哪些操作」。两层都要有，缺一个就是 401/403。
-- ───────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;

-- 红人浏览：只需要读商品和分类
grant select on public.products   to anon, authenticated;
grant select on public.categories to anon, authenticated;

-- ASIN 只给登录用户（见下方说明）
grant select on public.asins to authenticated;

-- 写入只给登录用户，具体到行由 RLS 再筛一遍
grant insert, update, delete on public.products   to authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.asins      to authenticated;

grant select on public.admin_users to authenticated;

-- 没有这一条，authenticated 插入时 nextval 会 permission denied
grant usage, select on sequence public.products_id_seq to authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.next_product_id() to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. RLS
--    先 drop 再 create，保证重复执行不报错。
-- ───────────────────────────────────────────────────────────────────────────

alter table public.products    enable row level security;
alter table public.categories  enable row level security;
alter table public.asins       enable row level security;
alter table public.admin_users enable row level security;

-- ── 5.1 products ──────────────────────────────────────────────────────────
-- 读：anon + authenticated 全开。这一条同时也是 Realtime 能推给红人的前提。
drop policy if exists products_read   on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;

create policy products_read on public.products
  for select to anon, authenticated
  using (true);

create policy products_insert on public.products
  for insert to authenticated
  with check (public.is_admin());

create policy products_update on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy products_delete on public.products
  for delete to authenticated
  using (public.is_admin());

-- ── 5.2 categories ────────────────────────────────────────────────────────
drop policy if exists categories_read   on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;

create policy categories_read on public.categories
  for select to anon, authenticated
  using (true);

create policy categories_insert on public.categories
  for insert to authenticated
  with check (public.is_admin());

create policy categories_update on public.categories
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy categories_delete on public.categories
  for delete to authenticated
  using (public.is_admin());

-- ── 5.3 asins ─────────────────────────────────────────────────────────────
-- 注意：读权限收得很紧 —— 只给 authenticated **且** 在 admin_users 白名单里。
-- ASIN 是这套系统里真正敏感的东西（能反查你的 listing），
-- 前台红人浏览商品完全不需要它，只有后台查码才需要。
--
-- 为什么不是只写 to authenticated：
--   Supabase 默认开放邮箱注册。如果注册开关没关掉（新版界面不好找），
--   任何人用自己邮箱注册一下就会拿到 authenticated 身份，
--   只写 to authenticated 的话他就能把 4648 条 ASIN 全部读走。
--   加上 is_admin() 之后，没有白名单的人读到的永远是 0 行。
drop policy if exists asins_read   on public.asins;
drop policy if exists asins_insert on public.asins;
drop policy if exists asins_update on public.asins;
drop policy if exists asins_delete on public.asins;

create policy asins_read on public.asins
  for select to authenticated
  using (public.is_admin());

create policy asins_insert on public.asins
  for insert to authenticated
  with check (public.is_admin());

create policy asins_update on public.asins
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy asins_delete on public.asins
  for delete to authenticated
  using (public.is_admin());

-- ── 5.4 admin_users ───────────────────────────────────────────────────────
-- 只能看到自己那一行，用来回答「我到底是不是管理员」。
-- 没有任何写策略 —— 加人只能在 SQL Editor（service role）里做。
drop policy if exists admin_users_self on public.admin_users;

create policy admin_users_self on public.admin_users
  for select to authenticated
  using (user_id = auth.uid());


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Realtime
--    只开 RLS 不加 publication → 前端 subscribe 不报错但永远收不到事件。
--    只加 publication 不开 RLS 的 SELECT → 同样静默收不到。
--    两个都要。
-- ───────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'categories', 'asins'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- DELETE 事件默认只带主键。FULL 之后 payload.old 是整行，
-- 前端可以顺手把「谁被删了」的提示做得更准确。
alter table public.products   replica identity full;
alter table public.categories replica identity full;
alter table public.asins      replica identity full;


-- ───────────────────────────────────────────────────────────────────────────
-- 7. 初始分类
--    外键要求商品引用的分类必须存在，先把现有的七个 + 兜底桶塞进去。
-- ───────────────────────────────────────────────────────────────────────────

insert into public.categories (name, sort_order) values
  ('Tops',         0),
  ('Knitwear',     1),
  ('Dresses',      2),
  ('Bottoms',      3),
  ('Outerwear',    4),
  ('Shoes',        5),
  ('Accessories',  6),
  ('Uncategorised', 7)
on conflict (name) do nothing;


-- ───────────────────────────────────────────────────────────────────────────
-- 8. 检查一下
-- ───────────────────────────────────────────────────────────────────────────

-- 8.1 三张表都应该 rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('products', 'categories', 'asins', 'admin_users')
order by tablename;

-- 8.2 应该看到三行 products / categories / asins
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- 8.3 策略清单
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 建管理员账号（手动，只做一次）
--
--  ① Dashboard → Authentication → Users → Add user
--       email:     ops@yourbrand.com
--       password:  一个强口令
--       勾上 Auto Confirm User（否则要收邮件点确认）
--
--  ② Dashboard → Authentication → Sign In / Providers → Email
--       关掉 "Allow new users to sign up"   ← 一定要关
--     （Supabase 默认开放注册，不关的话任何人都能注册进来）
--
--  ③ 回到 SQL Editor，把邮箱换成你的，跑一次：
--
--     insert into public.admin_users (user_id, email)
--     select id, email from auth.users where email = 'ops@yourbrand.com'
--     on conflict (user_id) do nothing;
--
--  ④ 确认：
--     select * from public.admin_users;
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. 导入完现有商品后，把序列推到正确位置（第二步会用到）
--
--   现有 139 个商品是带 id（p001…p139）导进来的，序列还停在 1，
--   下一个新增商品会拿到 p001 撞主键。导入完成后跑一次：
--
--     select setval(
--       'public.products_id_seq',
--       greatest(coalesce(max(substring(id from 2)::int), 1), 1),
--       true
--     )
--     from public.products
--     where id ~ '^p[0-9]+$';
--
--   之后新增商品不要在前端指定 id，交给数据库默认值。
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 为什么 specs 用 json 而不是 jsonb
--
--   jsonb 会重排对象的 key（先按长度、再按字节序），
--   json  保留原始文本和 key 顺序。
--
--   v4 选款码的规格段是「按位置」编码的：只存值，靠
--   Object.keys(product.specs) 的顺序去对应。现有数据是 Colour → Size。
--   一旦存成 jsonb，读出来会变成 Size(4) → Colour(6)，解码时
--   "Black|M" 就会被读成 Size=Black, Colour=M —— 历史码全部错位，
--   而且不报错、不崩，只是悄悄换了颜色和尺码。
--
--   所以：specs / variant_images / asins.variants 全部用 json。
--   代价是不能对 json 建 GIN 索引，但这里从来不需要按规格检索。
-- ═══════════════════════════════════════════════════════════════════════════
