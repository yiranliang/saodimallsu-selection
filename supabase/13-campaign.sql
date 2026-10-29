-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 大促归属（campaign deals）
--  Supabase Dashboard → SQL Editor → 整段粘贴 → Run
--
--  幂等：可以重复执行。
--
--  为什么要这一列
--  ──────────────
--  大促（黑五）和日常秒杀是两种东西：日常秒杀红人要区分"正在抢 / 即将开始"，
--  所以前台按紧迫度排、卡片挂倒计时；大促期间时间固定，她们只关心"折扣多狠"，
--  所以按折扣区间浏览、按折扣从高到低排。
--
--  这两种视图是同一条 `sale_*` 数据上的两个切片，切法必须跟着商品走 ——
--  所以它是一列，不是一张表、也不是一个全局开关：一次大促可以只有一部分
--  商品参加，而同一件商品在下一场活动里可能回到常规。
--
--  为什么是 boolean 而不是 enum
--  ────────────────────────────
--  现在只有两种状态，布尔就够了；`is_teaser` / `has_acc` 都是这个形制，
--  读写两侧的"缺列降级"也已经按布尔练过一遍。真出现第三种（clearance…）
--  再加列或换 enum，那时它才真的需要。
--
--  默认 false = 常规秒杀：老数据不需要回填，没跑过这列的前端读回来是
--  `undefined`，`Boolean()` 之后同样是"常规"，行为与拆分前一致。
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists is_campaign boolean not null default false;

comment on column public.products.is_campaign is
  '大促归属：true = Campaign Deals（按折扣区间浏览、按折扣排序），false = 常规秒杀（按紧迫度）。由导入弹窗 / 批量开秒杀选定。';

-- 检查
-- select is_campaign, count(*) from public.products group by 1;
