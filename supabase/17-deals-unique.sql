-- ============================================================
-- deals：唯一索引（幂等 upsert 需要它）
-- Supabase Dashboard → SQL Editor → 粘贴 → Run
--
-- 为什么需要
-- ────────
-- 导入用的是 `upsert(..., { onConflict: 'sku,sale_start,sale_end' })`，
-- PostgREST 要求这三列上**存在唯一索引/约束**，否则会直接报
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- 于是整批写入失败 —— 表现就是"点了导入，表里还是空的"。
--
-- 没有重复数据时这个索引不会冲突；有重复时先跑下面那条去重语句。
-- ============================================================

-- 1) 如果之前已经导过重复行，先去掉完全重复的（保留最早插入的那一条）
delete from public.deals a
using public.deals b
where a.ctid < b.ctid
  and a.sku = b.sku
  and a.sale_start = b.sale_start
  and a.sale_end = b.sale_end;

-- 2) 唯一索引
create unique index if not exists deals_window_uniq
  on public.deals (sku, sale_start, sale_end);

-- 检查
-- select indexname from pg_indexes where tablename = 'deals';
