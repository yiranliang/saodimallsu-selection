-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · import helpers
--  在 01-schema.sql 之后跑一次（Supabase → SQL Editor）。
--
--  作用只有一个：让导入脚本能把 products_id_seq 推到「现有最大 pNNN + 1」。
--
--  为什么不直接在脚本里 setval：
--    setval 需要对序列有 UPDATE 权限，而我只给了 authenticated
--    usage + select（能取号但不能改号——改号会让历史码指向别人）。
--    所以用一个 security definer 函数包一层，只暴露「同步到最大值」这一个动作。
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sync_product_id_seq()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_num bigint;
begin
  select coalesce(max(substring(p.id from 2)::bigint), 0)
    into max_num
  from public.products p
  where p.id ~ '^p[0-9]+$';

  if max_num < 1 then
    -- 空表：下一个号是 p001
    perform setval('public.products_id_seq', 1, false);
    return 1;
  end if;

  perform setval('public.products_id_seq', max_num, true);
  return max_num;
end;
$$;

comment on function public.sync_product_id_seq() is
  'Point products_id_seq at max(pNNN) so the next insert continues the series. '
  'Never rewinds below the highest existing id — that would reissue a code-bearing id.';

grant execute on function public.sync_product_id_seq() to authenticated;

-- 检查：跑完导入脚本后应返回 139（或你的最大编号）
-- select public.sync_product_id_seq();
