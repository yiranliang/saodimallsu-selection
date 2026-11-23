-- 23-category-pins.sql
--
-- 分类内的「置顶」。
--
-- 为什么需要这一列：货架顺序只有一份 sort_order（全局）。运营的诉求是
-- 「这件商品在 Cropped Cardigans 里排第一，但不要在 All products 里抢位置」，
-- 用全局顺序表达不了 —— 在筛选视图里点「移到最前」只会改全局，回到 All 才明显。
--
-- 形状：{ "<分类名>": <权重> }，越大越靠前；键不存在 = 不置顶。
-- 一件商品同时属于多个分类时，可以在每个分类里各钉一个位置。
--
-- 幂等：重复执行安全。

alter table public.products
  add column if not exists category_pins jsonb not null default '{}'::jsonb;

comment on column public.products.category_pins is
  '分类内置顶权重：{ "分类名": 权重 }。0 / 缺键 = 不置顶；只在对应分类视图生效。';
