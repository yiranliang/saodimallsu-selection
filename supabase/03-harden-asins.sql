-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · 03 · 收紧 asins 的读权限
--
--  背景：你提到新版界面没找到「关闭注册」的开关。那意味着任何人都能
--  用自己邮箱注册一个账号，拿到 authenticated 身份。
--
--  01-schema.sql 里 asins 的读策略原本是 `to authenticated using (true)`，
--  在这种前提下等于「任何注册用户都能把 4648 条 ASIN 全读走」——
--  ASIN 能用来反查你的 listing，是这套系统里最该护住的数据。
--
--  这一条把读权限改成「必须同时是白名单成员」。
--  跑一次即可，重复执行也安全。
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists asins_read on public.asins;

create policy asins_read on public.asins
  for select to authenticated
  using (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────────
-- 验证：应该返回 1 行，qual 里能看到 is_admin()
-- ───────────────────────────────────────────────────────────────────────────
select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'asins' and cmd = 'SELECT';
