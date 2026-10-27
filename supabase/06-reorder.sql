-- ═══════════════════════════════════════════════════════════════════════════
--  Saodimallsu Selection · reorder_products
--  在 01-schema.sql 之后跑一次（Supabase → SQL Editor）。
--
--  作用只有一个：把「一整个有序 id 数组」一次性写进 products.sort_order。
--  拖拽松手时前端调它一次，数据库在一个事务里改完所有行。
--
--  为什么必须有这个函数，而不是前端循环发 update：
--    · sort_order 是密集的（0…194，中间没有空隙）。把第 190 位拖到第 3 位，
--      意味着中间那 187 行的数字全都要变。
--    · 前端循环发 190 条 update，没有事务包着：网络断在第 90 条，数据库就停在
--      一个「一半新一半旧」的顺序上，而且没人知道是哪一半。重新拖一次也未必能
--      恢复——因为顺序本身已经被写坏了。
--    · 函数体在 Postgres 里是一个事务。要么 195 行全对，要么一行都没动。
--
--  顺带的好处：这个函数写的是 0…N-1 的连续序号，所以它同时会**抹平**
--  「置顶/置底」按钮留下的负数和空洞。跑一次拖拽，序号就重新变整齐。
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.reorder_products(p_ids text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_given    integer;
  v_distinct integer;
  v_total    integer;
  v_missing  integer;
  v_updated  integer;
begin
  /* ── 入参体检 ──────────────────────────────────────────────────────────
   * 这三道检查看起来啰嗦，但每一条都对应一种「静默写坏顺序」的方式：
   *   · 空数组 → 下面的 update 什么也不做，调用方却以为成功了
   *   · 有重复 id → 同一行被赋两个值，最后一个是随机的
   *   · 不是全量 → 只给了一部分行编号，剩下的行会和它们撞号
   * 所以一律抛异常，而不是「尽力而为」。
   */
  if p_ids is null then
    raise exception 'reorder_products: id list is null'
      using errcode = '22023';
  end if;

  select count(*) into v_given from unnest(p_ids) as t(id);
  if v_given = 0 then
    raise exception 'reorder_products: id list is empty'
      using errcode = '22023';
  end if;

  select count(distinct t.id) into v_distinct from unnest(p_ids) as t(id);
  if v_distinct <> v_given then
    raise exception 'reorder_products: duplicate ids (% given, % distinct)', v_given, v_distinct
      using errcode = '22023';
  end if;

  /* 必须是**全量**目录。前端只有在没筛选、没搜索时才允许拖拽，所以它拿到的
   * 就是全部商品；如果不是，说明两边数据不同步（别人刚加了商品），此时唯一
   * 安全的动作是让调用方刷新后重试。
   * 换成「只排这一段」会让没传上来的行保留旧数字，和新编号混在一起。 */
  select count(*) into v_total from public.products;
  if v_given <> v_total then
    raise exception 'reorder_products: expected all % products, got % — reload the console and try again',
      v_total, v_given
      using errcode = '22023';
  end if;

  select count(*) into v_missing
    from unnest(p_ids) as t(id)
   where not exists (select 1 from public.products p where p.id = t.id);
  if v_missing > 0 then
    raise exception 'reorder_products: % id(s) no longer exist — reload the console and try again', v_missing
      using errcode = '22023';
  end if;

  /* ── 权限 ──────────────────────────────────────────────────────────────
   * security invoker 意味着 RLS 照常生效（products_update 要求 is_admin()）。
   * 显式判一次，是为了给非管理员一个能看懂的错误，而不是「更新了 0 行」
   * —— RLS 过滤 UPDATE 是静默的，不报错。 */
  if not public.is_admin() then
    raise exception 'reorder_products: only admins can reorder the catalogue'
      using errcode = '42501';
  end if;

  /* ── 一次写完 ──────────────────────────────────────────────────────────
   * `with ordinality` 直接给出数组下标（从 1 开始），减 1 就是 0…N-1。
   * 单条 UPDATE、单条语句、单事务 —— 195 行一起生效或一起不生效。 */
  update public.products p
     set sort_order = (t.ord - 1)::integer
    from unnest(p_ids) with ordinality as t(id, ord)
   where p.id = t.id;

  get diagnostics v_updated = row_count;

  /* 兜底：真被 RLS 静默吞掉了，宁可回滚也不要留个半成品顺序。
   * 函数里抛异常 = 整个事务回滚，前面的 update 一起撤销。 */
  if v_updated <> v_given then
    raise exception 'reorder_products: only % of % rows were updated (not an admin?)',
      v_updated, v_given
      using errcode = '42501';
  end if;

  return v_updated;
end;
$$;

comment on function public.reorder_products(text[]) is
  'Rewrite products.sort_order from one ordered id array, atomically. '
  'Requires the FULL catalogue (no duplicates, no missing ids) so that the result '
  'is a total order — a partial list would collide with the rows it left out.';

/* ── 授权 ──────────────────────────────────────────────────────────────────
 * Postgres 默认把 EXECUTE 给 PUBLIC，也就是 anon 也能通过 /rpc/reorder_products
 * 调到它（虽然 RLS 会挡住写入，但没必要把入口开着）。先收回，再单独给
 * authenticated —— 真正的门是函数里的 is_admin()。 */
revoke all on function public.reorder_products(text[]) from public;
revoke all on function public.reorder_products(text[]) from anon;
grant execute on function public.reorder_products(text[]) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  跑完之后的自查（可选，粘到 SQL Editor 单独执行）
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0) 如果前端调它报 "Could not find the function ... in the schema cache"
--     （PGRST202），那是 PostgREST 的缓存还没刷新，不是函数没建好。等十几秒，
--     或者手动催一下：
--     notify pgrst, 'reload schema';
--
--  1) 函数在不在、签名对不对
--     select p.proname, pg_get_function_arguments(p.oid) as args
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'reorder_products';
--
--  2) 空跑一次（按当前顺序传进去，等于什么都不改，但会证明函数跑得通）
--     期望返回 195。
--     select public.reorder_products(
--       array(select id from public.products order by sort_order, id)
--     );
--
--  3) 顺序是否连续
--     期望 rows = 195、min = 0、max = 194、distinct = 195。
--     select count(*) as rows,
--            min(sort_order) as min,
--            max(sort_order) as max,
--            count(distinct sort_order) as distinct_orders
--       from public.products;
--
--  4) 普通用户不能调（在浏览器 console 里、用 anon key 调，应报 42501 或权限错误）
--     supabase.rpc('reorder_products', { p_ids: [] })
