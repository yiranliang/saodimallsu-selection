-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · ACC（Amazon Creator Connections）佣金
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行（add column if not exists）。现有行自动补 false / NULL。
--
--  两列，一开关一数据
--  ──────────────────
--  has_acc  boolean not null default false   业务开关：前台出不出角标和卡片
--  acc_id   text                              Campaign ID，纯文本
--
--  为什么开关是布尔列，而秒杀没有布尔列
--  ──────────────────────────────
--  秒杀的"开"可以由"这两个时间非空"推导出来，多一个 is_deal 只会多一处
--  「开关关了但时间还在」的中间状态（见 09-deal.sql）。ACC 没有可以推导的
--  东西：Campaign ID 可以是空的（活动还没批下来），也可以先填好再开，
--  所以必须有一个独立的布尔值来表达"现在对红人展示吗"。
--
--  为什么 acc_id 不跟随开关清空
--  ──────────────────────────
--  has_acc = false 时 acc_id 仍然保留。ID 是拿不到第二次的运营资产，
--  一次误点开关就把它清掉，等于让人去亚马逊后台重新抄一遍。
--  前台只认 has_acc，所以"关掉"依然是真的关掉。
--
--  这一组列不存在时前端不会崩：productStore 把它们列为可选列，探测失败就
--  从 select 和写入里一起剔掉（见 src/store/productStore.js），后台会显示
--  一条黄色提示。**先跑这条 SQL，再去后台打开开关**，顺序反了开了也存不住。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists acc_id  text,
  add column if not exists has_acc boolean not null default false;

comment on column public.products.has_acc is
  'Amazon Creator Connections 开关：true = 前台出 💰 Earn Commission 角标和佣金卡片';
comment on column public.products.acc_id is
  'ACC Campaign ID，纯文本；开关关闭时保留，不随开关清空';

-- 检查：两列都在，且现有商品全是 false / NULL
-- select count(*) filter (where has_acc) as on_count, count(*) from public.products;

-- 想在库里直接开一场活动也可以：
-- update public.products
--    set has_acc = true,
--        acc_id  = '你的 Campaign ID'
--  where sku = 'P9B013';
