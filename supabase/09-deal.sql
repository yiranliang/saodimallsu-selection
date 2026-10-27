-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 限时秒杀（Limited Deal / Flash Sale）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists）。现有行自动补 NULL。
--
--  为什么全是 text，而且不转时区
--  ────────────────────────────
--  运营填的是「美国时间字符串」，比如 2026-10-28T10:00。存成 timestamptz
--  意味着入库那一刻要选一个时区：选 UTC，前台按本地时间读回来就差了 8/12
--  小时；选 America/New_York，夏令时切换的那两个周日会自己挪一小时。
--  存原文，前台用 new Date('2026-10-28T10:00') 按浏览器本地时间解析 ——
--  行为完全可预测，运营填什么就是什么，没有任何服务器端换算。
--  代价：库里没有排序/比较能力。但没有任何查询按秒杀窗口筛商品，
--  全部在前端计算（见 src/utils/deal.js），所以这个代价是零。
--
--  字段
--  ────
--  sale_start      开始时间  2026-10-28T10:00
--  sale_end        结束时间  2026-10-30T22:00   （左闭右开：22:00 整就结束）
--  sale_price      折后价    19.99
--  original_price  原价      39.99
--  discount_label  折扣标签  50% OFF
--
--  没有布尔开关：关掉秒杀 = 把这五个字段清空（后台开关就是这么做的）。
--  少一列 is_deal，也就少一处「开关关了但时间还在」的中间状态。
--
--  这一组列不存在时前端不会崩：productStore 把它们列为可选列，探测失败
--  就从 select 和写入里一起剔掉（见 src/store/productStore.js）。
--  也就是说：**先跑这条 SQL，再去后台填时间**，顺序反了填了也存不住。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists sale_start      text,
  add column if not exists sale_end        text,
  add column if not exists sale_price      text,
  add column if not exists original_price  text,
  add column if not exists discount_label  text;

comment on column public.products.sale_start is
  '本地时间字符串 2026-10-28T10:00，不做时区换算；空 = 没有秒杀';
comment on column public.products.sale_end is
  '本地时间字符串；左闭右开，到这一刻即结束';
comment on column public.products.sale_price is
  '折后价，纯文本（19.99）。为空则前台只出角标、不出价格区';
comment on column public.products.original_price is
  '原价，纯文本。为空则不显示划线价';
comment on column public.products.discount_label is
  '折扣标签，纯文本（50% OFF）。为空则不显示标签';

-- 不加索引，也不建约束。
--   索引：没有任何查询按 sale_start/sale_end 过滤，前台是纯本地计算。
--   约束：格式校验放在后台编辑器里做成「软提示」而不是 check 约束 ——
--         一条 check 会让某行脏数据把整次保存打回，而运营此刻要的是
--         「先存下来，角标不出现我自己会发现」。真要硬校验就取消注释：
--
-- alter table public.products add constraint products_sale_window_chk check (
--   (sale_start is null or sale_start ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}')
--   and (sale_end is null or sale_end ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}')
-- );

-- 检查：跑完这五列应该都在，且现有商品全是 NULL
-- select id, sku, sale_start, sale_end, sale_price from public.products limit 10;

-- 想在库里直接开一场秒杀也可以：
-- update public.products
--    set sale_start = '2026-10-28T10:00',
--        sale_end   = '2026-10-30T22:00',
--        sale_price = '19.99',
--        original_price = '39.99',
--        discount_label = '50% OFF'
--  where sku = 'P9B013';
