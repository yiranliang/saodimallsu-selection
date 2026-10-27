# 第二个品牌上线清单

> 场景：同样的代码，新仓库、新 Supabase 项目、294 个货号 / 26,830 条 ASIN。
> 这份清单按「改代码 → 建库 → 切环境 → 导入 → 验收」排，每步都有可复制的命令。

---

## 0. 五分钟版

```bash
git clone <repo> brand-b && cd brand-b
npm install

# 1) 改品牌（只改 6 个文件，别 sed 全仓）
# 2) 新建 Supabase 项目，按顺序跑 supabase/01…08
cp .env.example .env.brandb            # 填新项目的 URL / key / 管理员账号
npm run env:show -- --env=.env.brandb  # 确认打的是新库（看货号）

# 3) 先干跑，再写
npm run batch:upsert -- "b.xlsx" --env=.env.brandb --expect-brand=brandb
npm run batch:upsert -- "b.xlsx" --env=.env.brandb --expect-brand=brandb --write
```

---

## 1. 改品牌名（问题 2）

### 1.1 先看清楚有多少处

```bash
grep -rn "Aoysky\|AOYSKY" src index.html
```

只有 **17 处**，分布在 6 个文件。没有藏在构建产物里，也没有写进数据结构 ——
商品表里存的只有 `id / sku / name / specs / image`，品牌名跟数据完全无关，
所以「改名不会动到商品数据」这件事是结构决定的，不是运气。

### 1.2 真正面向用户的只有 5 处

| 位置 | 内容 | 说明 |
|---|---|---|
| `src/data/products.js` → `brandConfig` | `name` / `welcome` / `tagline` / `logoText` | **主入口**。页头、提货码页、加载骨架都读它 |
| `index.html` | `<title>`、`<meta name="description">` | 浏览器标签和分享卡片 |
| `src/components/admin/AccessGate.jsx` | "This area is for the Aoysky team." | 后台登录门禁的文案 |
| `src/pages/admin/ProductsPage.jsx` | CSV 导出表头 `Aoysky · sold out · …` | 导出的文件名/表头 |
| `src/main.jsx` + `DeveloperPage.jsx` | `window.AOYSKY` 调试全局 | 只在控制台用，可选 |

`brandConfig.logoText` 是**一个字母**（现在是 `A`），不在上面的 grep 结果里，
要手动改成新品牌的首字母。

### 1.3 安全的替换命令

```bash
# 变量先设好
BRAND_EN="NewBrand"     # 英文名，用于 title / 文案
BRAND_SLUG="newbrand"   # 小写标识，用于 .env 的 BRAND_SLUG

# 只对这 6 个文件生效（把列表写全，比 sed 全仓安全得多）
perl -pi -e "s/Aoysky/$BRAND_EN/g; s/AOYSKY/\U$BRAND_EN\E/g" \
  src/data/products.js \
  index.html \
  src/components/admin/AccessGate.jsx \
  src/pages/admin/ProductsPage.jsx \
  src/main.jsx \
  src/pages/admin/DeveloperPage.jsx

# 再手动改 logoText（首字母）
# src/data/products.js: logoText: 'A'  →  'N'
```

### 1.4 有三样东西**不要**跟着改

| 东西 | 为什么 |
|---|---|
| `zby-` 选款码前缀 | 见 1.5。它是协议，不是品牌 |
| `mako_*` / `mako_catalogue_v1` 等存储键 | 纯粹是本地命名空间，两个站不同源，不冲突；改了只会让老站用户丢购物车 |
| `README.md` / `HANDOVER.md` 里的品牌名 | 那是历史记录，改了反而读不懂当时发生了什么 |

### 1.5 建议顺手把码前缀改掉（安全考虑，不是美观）

如果两个站都用 `zby-`，B 品牌的码粘进 A 的后台**能解开** —— 因为码里存的是 `p001`
这样的 id，而 A 库里也有 `p001`，于是会静默解成 A 的商品。这是唯一一处「换个品牌
会真的出错」的地方。

```js
// src/utils/code.js
const PREFIX = 'ngb'      // 新品牌自己的前缀，别和 zby 撞
```

改完要同步三处断言（`scripts/test-code.mjs` 的 `[5b]` 节）：
`code starts with zby-`、`rejection names the new prefix`、`prefix match is case-insensitive`。
跑 `npm run test:code` 会直接告诉你哪几条挂了。

---

## 2. 新建 Supabase 项目并按顺序跑 SQL

新项目是空库，**顺序不能换**（后面的脚本依赖前面的表/函数）：

```
supabase/01-schema.sql          表、RLS、admin_users、is_admin()
supabase/02-import-helpers.sql  sync_product_id_seq()
supabase/03-harden-asins.sql    asins 的读权限收紧
supabase/04-product-links.sql   前台「View on Amazon」用的公开视图
supabase/05-sold-out.sql        sold_out_variants 列
supabase/06-reorder.sql         reorder_products()
supabase/07-badge-color.sql     badge_color 列
supabase/08-teaser.sql          is_teaser 列
```

全是幂等的（`create ... if not exists` / `create or replace`），重复跑不会炸。

跑完在 SQL Editor 里确认三件事：

```sql
select count(*) from public.admin_users;   -- 应该有你自己的邮箱
select count(*) from public.products;      -- 0
select * from pg_policies where tablename = 'products';  -- 至少 4 条
```

---

## 3. 一套代码、两个库：怎么切才安全（问题 4）

### 3.1 一个品牌一个 env 文件

```
.env                  ← 当前机器上的默认目标（A 品牌，已存在）
.env.aoysky           ← A 品牌（可选，如果你也想显式指定）
.env.brandb           ← B 品牌（新建）
.env.example          ← 模板，入库
```

`.gitignore` 已经覆盖 `.env.*`（只放行 `.env.example`），所以这两份密钥都不会进仓库。

每个文件里加两行品牌标识，它们是护栏的输入：

```ini
BRAND_NAME=BrandB
BRAND_SLUG=brandb
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_ADMIN_EMAIL=ops@brandb.com
SUPABASE_ADMIN_PASSWORD=xxx
```

### 3.2 三种指定方式（优先级从高到低）

```bash
# ① 单条命令指定 —— 推荐，因为它写在命令里，事后能从 shell 历史里查到
npm run batch:upsert -- "b.xlsx" --env=.env.brandb

# ② 环境变量 —— CI / 一键脚本用
ENV_FILE=.env.brandb npm run batch:upsert -- "b.xlsx"

# ③ 不指定 —— 读 .env（单品牌的老用法，完全不变）
npm run batch:upsert -- "b.xlsx"
```

`--env=` 指到一个不存在的文件会**直接报错退出**，不会回退到 `.env`。
回退才是真正危险的：你以为在导 B，实际写进了 A。

```bash
$ npm run batch:upsert -- "b.xlsx" --env=.env.nope
✗ 找不到 env 文件：/path/to/brand-b/.env.nope
```

### 3.3 写之前先问一句「这是哪个库」

```bash
npm run env:show -- --env=.env.brandb
```

```
  Supabase 目标
  env      /path/to/brand-b/.env.brandb
  品牌     BrandB  [brandb]
  目标库   abcdefghijklmnop.supabase.co

  凭据     管理员 ops@brandb.com

  现在有什么
    products     0 行
    asins        0 行（每行一个货号，变体在 variants 里）
    categories   0 行

  前 3 个货号（认品牌用）
    （空表 —— 还没导入过商品）

  ✓ BRAND_SLUG=brandb —— 写入脚本可以加 --expect-brand=brandb 做二次核对
```

**第三段是重点**：两个项目在控制台里长得一模一样，但货号不会。导入过一次之后，
`env:show` 会列出前 3 个货号，一眼就能认出这是 A 还是 B。

### 3.4 护栏：`--expect-brand`

```bash
npm run batch:upsert -- "b.xlsx" --env=.env --expect-brand=brandb
```

```
✗ 品牌不符：命令行要的是 brandb，当前 env 是 aoysky。
  目标库是 xwkghmhuwoivwxuhfnpr.supabase.co —— 拒绝执行。检查 --env 或 .env 指向。
```

- 不传 `--expect-brand` 时行为**完全不变**（老命令照跑）
- 传了但 env 里没写 `BRAND_SLUG`：也会拒绝，并告诉你去加那一行
- `batch:upsert` 和 `batch:delete` 都支持；`batch:delete` 尤其需要（删错了只能重导）

### 3.5 三个脚本的横幅现在都带「目标库」

```
  BrandB → 批量 upsert
  env      ...\.env.brandb
  品牌     BrandB  [brandb]
  目标库   abcdefghijklmnop.supabase.co
  文件     b.xlsx
  模式     干跑 —— 只打印计划，一个字节都不写（加 --write 才落库）
```

干跑也会打印，所以「看一眼再决定写不写」是默认动作，不需要额外记步骤。

---

## 4. 26,830 条 ASIN 能不能一次导入（问题 1）

### 4.1 实测：不会溢出

用 294 货号 × 92 条 / 4.5 MB 的 xlsx 在本地跑了一遍解析（不连库）：

| 指标 | 实测 |
|---|---|
| 数据行 | 26,830 |
| xlsx 体积 | 4.5 MB |
| `XLSX.readFile` + `sheet_to_json` | **344 ms** |
| 进程 RSS 增量 | **16 MB**（171 → 187 MB） |

26,830 行在 Node 里只是二十几万个单元格对象，离默认堆上限（4 GB）差两个数量级。
真正会炸的是「几百万行 + 保留全部中间对象」，这里两个条件都不成立。

### 4.2 写库本来就是分批的，而且真正写的行数不是 26,830

`asins` 表的结构是 **一行一个货号**，变体放在 `variants` jsonb 里：

```
asins(sku primary key, variants jsonb)
   'P9B013' → { "Black|S": "B0…", "Black|M": "B0…", … }
```

所以 26,830 条 ASIN = **294 行**。`scripts/batch-upsert.mjs` 的写入是：

```js
for (const slice of chunks(asinRows)) {          // CHUNK = 100 行
  await supabase.from('asins').upsert(slice, { onConflict: 'sku' })
}
```

- products 新建：`chunks(rows)`，每批 100 行
- asins 写入：`chunks(asinRows)`，每批 100 **货号**（≈ 9,200 条 ASIN / 批）
- 每个货号的 `variants` 是**按 key 合并**：表里写到的变体被写入/更新，表里没提到的变体**不会被删**

结论：**不需要额外做 chunking，已经做了**；内存和请求体积都不是问题。
如果哪天单批请求体太大（PostgREST 报 `payload too large`），把 `cli-common.mjs`
里的 `CHUNK` 从 100 调到 50 即可，不用改别的。

### 4.3 导入命令（先干跑，再写）

```bash
# ① 确认库
npm run env:show -- --env=.env.brandb

# ② 干跑：只打印计划，一个字节都不写
npm run batch:upsert -- "B-品牌-ASIN.xlsx" --env=.env.brandb --expect-brand=brandb

# ③ 看这三个数字对不对，再写
#    新商品 = 294、已有货号 = 0、被拒绝的行 = 0
npm run batch:upsert -- "B-品牌-ASIN.xlsx" --env=.env.brandb --expect-brand=brandb --write
```

首次上新建议加 `--hide-new`：新货号先 `hidden = true`，前台看不到，
补完图和价格再去后台批量 Unhide。**老货号的状态不会被这个开关影响。**

### 4.4 导完核对（SQL Editor）

```sql
select count(*) from public.products;                       -- 294
select count(*) from public.asins;                          -- 294（行 = 货号）
select sum(jsonb_object_length(variants)) from public.asins; -- 26830（总共 ASIN 数）
select count(*) from public.product_links;                  -- 294
```

第三个查询是真正的验收：它数的是 `variants` 里的键，也就是「有 ASIN 的变体数」。
和 26,830 对得上，才说明每一条都进了库。

> **如果这个数比 26,830 小**，通常不是丢数据，而是表里有重复组合：
> 同一个 `货号 + 颜色 + 尺寸` 出现了两次（ASIN 不同）。`variants` 的键是
> `颜色|尺寸`，一个组合只能有一个 ASIN，脚本按 `--conflict=first`（默认）保留第一个，
> 并在干跑报告里把那几条列出来。要么确认保留哪一个，要么用 `--conflict=last` 换一边。
>
> 两种情况都要在干跑的「新商品 / 变体总数」里先看见，别等导完才发现。

---

## 5. 2.6 万条 ASIN 会不会拖慢首屏（问题 3）

### 5.1 结论：不会。前台根本拿不到 ASIN

| 数据 | 谁拉 | 多大 | 什么时候 |
|---|---|---|---|
| `products` | 红人（匿名） | 294 行 ≈ 40 kB gzip | 首屏前，决定卡片 |
| `product_links`（公开视图） | 红人（匿名） | **≈ 5 kB gzip** | 首屏之后，补「View on Amazon」 |
| `asins`（26,830 条） | **只有登录的管理员** | ≈ 34 kB gzip | 后台打开时 |

三个数字都来自实测（用 294 × 92 的合成数据量出来的）：

- `product_links`：294 行、27,048 个 `"Colour|Size": true` 键，
  原始 **534 kB**，gzip 后 **5 kB**（109 倍压缩，因为键高度重复）。
- `asins` 整表：294 行 / 27,048 个 URL，原始 146 kB，gzip **34 kB**。

### 5.2 为什么 ASIN 数量进不了首屏

1. **RLS 就挡住了**：`asins` 只对 `authenticated + is_admin()` 开放，红人是匿名。
2. **而且我们根本不发这个请求**：`src/main.jsx` 里的 `loadAsins()` 只在
   `getAuthState().user` 存在时才调用（这是上一轮性能优化时加的），
   匿名访客的请求列表里没有它。
3. **分页是本地切片**：下拉 24 个卡片，和库里有 294 个还是 2,940 个货号无关 ——
   首次请求只拉一次目录，之后「Load more」纯前端。
4. **图片是 320w + lazy**：首屏几张图由视口决定，和 ASIN 数量无关。

### 5.3 唯一会随 ASIN 增长的地方

管理员的 **ASIN 面板**（`ProductsPage` / `ProductEditor`）会整表读 `asins`。
26,830 条时是 34 kB gzip，桌面端可以忽略；如果哪天涨到 20 万条（≈ 250 kB gzip），
再考虑按货号分页读。**红人那一侧不受影响。**

---

## 6. 上线前自测

```bash
npm test                     # 纯逻辑，不碰库
npm run build                # 分包体积：入口应仍是 ~38 kB gzip
npm run env:show -- --env=.env.brandb
npm run preview -- --port 4173
node scripts/perf-check.mjs http://localhost:4173 --warm   # 首屏 / 复访
```

浏览器里过一遍：首屏骨架 → 卡片 → 点开详情 → 选颜色尺码 → 加购 → 生成码 →
在 `/#/admin` 用这个码解出来。这一条链路走过，剩下的都是数据问题，不是代码问题。
