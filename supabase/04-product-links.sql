-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 04 — public "View on Amazon" links
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行。
--
--  为什么需要这一步
--  ----------------
--  前台卡片上要放一个「View on Amazon」链接，链接必须包含 ASIN。但 `asins`
--  表是白名单可读的（03-harden-asins.sql），匿名访客读不到任何一行，所以
--  前台拿不到 ASIN。
--
--  解决办法是**只暴露一个 ASIN**：每个商品给出「第一个变体的 ASIN」，仅此
--  而已。链接 URL 里本来就带着这个 ASIN（amazon.com/dp/B0…），所以它必然
--  是公开信息；剩下的 4000+ 条变体映射仍然留在 RLS 后面。
--
--  为什么不把 asins 表整体开放
--  --------------------------
--  那等于把整张货盘公开，别人可以按颜色/尺码反查你的 listing。一个视图只
--  泄露「点进去必然会看到的那一个」，信息量和功能本身完全对齐。
--
--  为什么用视图而不是给 products 加一列
--  ----------------------------------
--  加列要触发器维护（asins 增删改 + 货号改名都要同步），任何一次漏同步都会
--  让链接指向旧 ASIN 且无人察觉。视图每次读都是现算的，永远和 asins 一致。
--  代价只是前台多一次很小的请求（139 行 × 2 列）。
--
--  注意：视图默认以**创建者权限**运行（security_invoker = off），因此它绕过
--  asins 的 RLS —— 这正是它能工作的原因，也是 Supabase linter 会提示
--  "security definer view" 的原因。这里是有意为之，且暴露面被视图定义严格
--  限制在一个 ASIN 上。不要往这个视图里加别的列。
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.product_links
with (security_invoker = off) as
select
  p.id as product_id,
  (
    select v.value
      from public.asins a
      cross join lateral json_each_text(a.variants) with ordinality
        as v(key, value, ord)
     where a.sku = p.sku
     -- ordinality = the order the variants were written, i.e. the first row
     -- for that 货号 in the source sheet. Deterministic, unlike "any one".
     order by v.ord
     limit 1
  ) as asin,
  -- 哪些「颜色|尺码」组合真的有 ASIN。只暴露 key（颜色和尺码本来就写在
  -- products.specs 里，是公开信息），不暴露任何一个 ASIN 的值。
  -- 前台靠它区分「这个组合没上架」和「整款都没上架」。
  (
    select coalesce(json_object_agg(v.key, true), '{}'::json)
      from public.asins a
      cross join lateral json_each_text(a.variants) as v(key, value)
     where a.sku = p.sku
       and coalesce(v.value, '') <> ''
  ) as linked_variants
from public.products p
where p.sku is not null
  and p.sku <> '';

comment on view public.product_links is
  'One ASIN per product for the storefront "View on Amazon" link, plus the set '
  'of variant keys that have a listing. Deliberately narrow: never add an ASIN '
  'value here — the full asins table stays private.';

-- 匿名也要能读（红人免登录看选款页）
grant select on public.product_links to anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  验证
-- ───────────────────────────────────────────────────────────────────────────

-- 1. 有链接的商品数 / 总商品数。第一列应接近第二列；
--    差值是「没有任何 ASIN」的商品，前台会隐藏链接。
select
  count(*) filter (where asin is not null) as with_link,
  count(*)                                as total_products
from public.product_links;

-- 2. 抽查几行，确认 asin 长得像 B0XXXXXXXX，linked_variants 是个对象
select product_id, asin, linked_variants
from public.product_links
where asin is not null
order by product_id
limit 5;

-- 3. 确认匿名能读这个视图、但仍然读不到 asins 表。
--    （在 SQL Editor 里跑是 postgres 身份，看不到差别；真正的验证在浏览器
--    无痕窗口里：前台卡片出现 View on Amazon，而 /#/admin 未登录时 ASIN 为空。）
