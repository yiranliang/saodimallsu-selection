# 交接文档 · Saodimallsu 红人专属选款站

> **给接手的 AI / 工程师：先读完这一份，再动任何代码。**
>
> 本文覆盖旧版 `HANDOVER.md`。旧版是 2775 行的历史踩坑记录（A 品牌时期的逐条复盘），
> 已归档为 `HANDOVER-ARCHIVE.md`——遇到"为什么当初这么写"的问题再去翻它，**不要按它改代码**
> （里面还有 Aoysky 时期的品牌名、端口、测试条数，已过期）。
>
> 最后更新：2026-10-29 · 当前品牌：**Saodimallsu（B 品牌）** · 代码前缀：`sdm`

---

## 0. 三条最先要记住的规矩

1. **改之前先看第 2 节的红线。** 这个项目最贵的不是功能，是"看起来改好了、其实静默毁数据"的那类改动。
2. **测试用 `npm test`（纯逻辑，不碰数据库）。** 浏览器自动化（`npm run smoke*`）会真实打 Supabase、消耗流量，部分还会写库，**非极必要不跑**（见第 5 节）。
3. **确认 `.env` 指向 B 品牌库再干活。** 这个坑真实发生过：`.env` 里填成了 A 品牌地址，导致整轮调试都在 A 的数据上做（见第 4 节的自检命令）。

---

## 1. 项目定位

**Saodimallsu** 是一个面向红人（influencer）的**选款网站**：红人在专属页面浏览商品、挑颜色和尺码、加入购物车，最后生成一个「选款码」发给品牌方对接人；运营在后台用选款码反查她选了什么，并把对应变体的亚马逊 ASIN 复制出来下单。

**业务闭环**

```
红人：浏览网格 → 点卡片开详情弹层 → 选色/码 → 加购物车 → 生成选款码 → 发给对接人
运营：登录 #/admin → 选款码查询/解码 → 拿到「货号 + 颜色 + 尺码 + ASIN」→ 亚马逊下单
```

**技术栈**

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite 5 + Tailwind 3，`HashRouter`（hash 路由，静态托管零配置） |
| 后端 | Supabase（Postgres + Auth + Realtime + RLS） |
| 部署 | Cloudflare Pages（Framework preset `Vite`，build `npm run build`，输出 `dist`） |
| 测试 | 纯 Node 断言脚本（`scripts/test-*.mjs`）+ Playwright 浏览器冒烟（按需） |

**Cloudflare Pages 配置要点**

- `base: './'`（`vite.config.js`）——产物可直接丢进任意子目录/子域。
- 用了 HashRouter，**不需要 `_redirects`**。
- Build environment variables 里只配 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（Production 与 Preview 都要）。
  `SUPABASE_ADMIN_EMAIL` / `SUPABASE_ADMIN_PASSWORD` **不要**配到 Pages，它们只给本地脚本用。
- 手动部署：`npm run build && npx wrangler pages deploy dist --project-name=<项目名>`。

**品牌与语言（硬性）**

- 前台文案**纯英文**（红人是英语用户）。
- 后台文案**全中文**，且由 `scripts/test-admin-i18n.mjs` 强制：后台里出现裸英文文本节点会让 `npm test` 失败。
- 品牌名/口号集中在 `src/data/products.js` 的 `brandConfig`（`name` / `welcome` / `tagline` / `mission` / `logoText`）。
  ⚠️ `scripts/build-catalog.mjs` 里有一份**同名副本**，那是生成 `products.js` 的模板，改文案必须两处一起改，否则下次生成会被覆盖回去。

---

## 2. 核心架构与红线

### 2.1 选款码（`src/utils/code.js`）

| 常量 | 值 | 说明 |
|---|---|---|
| `CODE_PREFIX` | `sdm` | 当前品牌，产出码形如 `sdm-<payload>`。**换品牌只改这一个常量** |
| `LEGACY_CODE_PREFIXES` | `['zby']` | 历史前缀，**只进不出**：能解，不再生成 |
| `ACCEPTED_CODE_PREFIXES` | `[CODE_PREFIX, ...LEGACY]` | 解码接受集合 |

**红线**

- 既不是当前前缀、也不在白名单里的前缀，一律返回 `Invalid brand prefix` 拒绝解析——**这是防串库的保险丝**（两个品牌都用 `p034` 这类 id，异品牌码会解出一个看似合理、实际全错订单）。
- `decodeCode` 返回的 error 字符串是**契约**：`scripts/decode.mjs`、`window.SAODIMALLSU.decode`、`scripts/test-code.mjs` 都对着它断言。改文案要同步改断言。
- **已发出的码永远不能失效**。改码格式的逻辑前，先想清楚历史码怎么解。
- 不要在码里塞 ASIN：ASIN 会变，码不能变。

### 2.2 数据库字段红线（动了会静默毁数据）

1. **`specs` 只能追加，不能重排——键和值都不行。**
   - 键序（`Object.keys(specs)`）：v4/v5 码的每一位按类型顺序对齐，改键序 = 历史码解码成**别的选项**，且不报错。
   - 选项数组序：v1/v2 码存的是**选项下标**，挪一下数组，老码就指向另一个尺码。
2. **尺码顺序只在「渲染时算」**：任何展示都必须走 `sizeAxisOf()` / `sortSizes()`（`src/utils/sizes.js`）；
   **绝不能把排好序的数组写回 `specs`**。颜色**不排序**，保持商品自己声明的顺序。
3. **`specs` / `variant_images` / `sold_out_variants` 是 `json`，不是 `jsonb`。**
   jsonb 会按键长度重排键序，同样毁历史码。`asins.variants` 是 jsonb，所以**更不能依赖它的键序**取"第一个"。
4. **`src/store/mapping.js` 是字段白名单**（在 `store/` 下，不在 `utils/` 下）。新增字段要改**三处**：`shared()`（给前台的驼峰值）、`rowToProduct()`（读）、`productToRow()`（写）。
   只改前后两处、漏了读，结果是「存得进去、永远读出来是空」——存成功了所以没人怀疑。
5. **可选列必须在「读」和「写」两侧都降级。** PostgREST 遇到不存在的列会把**整条 SELECT 判 400**（不是返回空）。
   现有可选列：`sold_out_variants`、`badge_color`、`sub_tag` / `sub_badge_color`、`sale_*`、`is_campaign`、`deal_priority` 等。
   新增可选列要同时加：**`src/store/productStore.js`** 里的 `OPTIONAL_COLUMNS`、`rowFor()` 的摘除清单、以及类似 `badgeColumnAvailable` 的开关（这些都在 productStore，不在 mapping.js）。
6. **`variantKey(colour, size)` → `` `${colour}|${size}` ``**（`src/utils/sku.js`）是唯一实现。
   `asins.variants`、`product_links`、`sold_out_variants` 三处共用，**别各自拼字符串**。
7. **`asins.sku` 是主键，改货号 = 迁移这一行，不是复制。** 编辑器保存时先 `moveAsins(旧, 新)` 再写商品；
   目标货号已有 ASIN 行时**拒绝并保持原样**（合并变体表需要人判断"哪个 ASIN 才对"）。
8. **改颜色/尺码名 = 迁移 variant 键，不是改字符串。** 写 `products.specs` 的同时必须重写
   **三处**：`asins.variants`、`sold_out_variants`、`variant_images`（漏了就是"改个名，这个颜色的实拍图没了"）。
   判断"是不是改名"只能靠「旧值从新列表消失 + 新值不在旧列表出现过」两条同时成立；缺一条不许动。
9. **`sort_order` 只能由重排写入方写**（`reorder_products` RPC / `moveProduct(s)ToEdge`）。
   保存、导入、实时同步一律不得把位置放进 payload——位置一旦能从快照推导，一次保存就回滚一次拖拽。
10. **增量导入绝不覆盖已有字段。** 已存在商品的 update payload 字面上只有 `{ specs }`；
    `name` / `category` / `image` / `hidden` / `tag` / `variant_images` / `sold_out_variants` 都不在里面。
11. **脚本只追加，删除走专用通道**：`npm run batch:delete`，或编辑器里手动清空 ASIN 输入框（那是唯一会删 ASIN 的入口）。

### 2.3 「无 ASIN = 前台自动断货」——业务红线

**这是当前最重要的运营规则，别改回去。**

起因：很多商品停产/缺货/不再补货，根本没有 ASIN。旧行为是它在前台照样能被选中加购，产生无效选款。

**现在的规则**

- 某个「颜色|尺码」没有绑定 ASIN → **前台自动视为断货**：该尺码按钮置灰、标 `Sold out`，不可加购；
  整个商品的变体全都没有 ASIN → 卡片按钮禁用、显示 `Sold out`。
- **绝对不要「没有 ASIN 就把这个商品/变体丢掉」。** 必须**保留变体（颜色+尺码照样出现在 specs 里）**，
  只是置灰。丢掉她就连"有这个颜色"都看不到了，比选错更糟。

**实现方式（改这块之前必须读懂）**

| 环节 | 位置 | 要点 |
|---|---|---|
| 判定核心 | `src/utils/soldOut.js` | 纯函数（Node 测试直接 import）。`isSoldOut` / `isOptionAvailable` / `soldOutSummary` 接受**可选** `asinLookup(colour,size)=>boolean`；不传时行为与旧版完全一致 |
| 前台信号 | `src/store/linkStore.js` | 匿名红人**读不到真实 ASIN**（RLS 限制），唯一可用信号是公开视图 `product_links.linked_variants`。`listingKnownFor()` 在视图**未就绪时返回 `true`**（未知 ≠ 没有，否则加载瞬间全站变灰） |
| 详情弹层 | `src/components/ProductDetail.jsx` | `asinLookup` → `soldOutNow` + `isOptionAvailable`；无 ASIN 的尺码置灰 |
| 商品卡片 | `src/components/ProductCard.jsx` | `soldOutSummary(product, asinLookup)`；全变体不可用 → `orderable=false` |
| 购物车/生成码 | `src/pages/SelectionPage.jsx`、`src/components/CartDrawer.jsx` | 生成码前拦截"含不可用项" |
| 导入脚本 | `src/utils/asinsImportCore.js` + `scripts/batch-upsert.mjs` | `readTable(rows, { allowMissingAsin: true })`：`batch:upsert` 下空 ASIN 行**不再整行拒绝**，保留颜色/尺码进 specs，但**不写 asins 键** |
| 后台提示 | `src/components/admin/ProductEditor.jsx` | `missing > 0` 时红色提示「缺少 ASIN 的组合在前台会被当作『Sold Out』处理」——**必须中文**，英文会被 `test-admin-i18n` 拦下 |

**注意区分两种导入模式**

- `batch:upsert`（建商品 + 建变体）：允许空 ASIN（`allowMissingAsin: true`）。
- `import:asins` / 浏览器导入（只导 ASIN）：**保持严格**，空 ASIN 行照旧 reject——那两条路径空行没有任何意义。

### 2.4 前端绝不引入全量 ASIN 数据

**红线：`src/data/asins.js`（约 4500 条 ASIN）绝对不能 import 进 `src/` 的任何地方。**

- 这个文件仍在仓库里，但**只给 Node 脚本**用（`npm run push`、`npm run catalog`、`scripts/decode.mjs` 从磁盘读）。
- 只要 `src/` 里出现 `import ... from '../data/asins'`（哪怕动态 `import()`），Vite 就会把它打成 chunk
  并在产物里留下一个可被 DevTools 直接请求的 URL —— **`asins` 表的 RLS 就形同虚设**。
  `src/utils/asinStore.js` 顶部有完整说明，读一遍。
- 前台/后台的 ASIN 一律**运行时从 Supabase 取**，读取权限由 RLS 限定在 `public.admin_users` 白名单内。
- 前台匿名用户能拿到的只有 `product_links` 视图的三列：`product_id` / `asin` / `linked_variants`。
- 未配置数据库时（裸 `npm run dev` 且无 env），ASIN 映射就是空的、查码显示 "No matching ASIN"——**这是正确状态**，不要去"修"。

### 2.5 React 结构红线（刚踩过，白屏级事故）

**组件里所有 Hook（`useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` …）必须在组件顶层、
按固定顺序、无条件执行——并且必须排在任何一个提前 `return` 之前。**

真实事故（2026-10-28）：`ProductDetail.jsx` 里新增的
`const asinLookup = useMemo(...)` 被写在了 `if (!product) return null` **之后**。
弹层关闭时 `product === null` → 少执行一个 Hook；点开商品 → 多执行一个 Hook →
`Minified React error #310: Rendered more hooks than during the previous render.` → **所有商品详情白屏**。

修复后的正确位置：Hook 在第 233 行，`if (!product) return null` 在第 238 行（依赖写 `product?.id` 保证 null 安全）。
代码里留了注释「MUST stay above the early return」，**不要把它挪下去**。

---

## 3. 当前功能清单

| 功能 | 位置 | 备注 |
|---|---|---|
| **极简骨架屏** | `src/pages/SelectionPage.jsx`（`holdSkeleton`）+ `index.html` 的 boot ring | 首屏立刻出骨架，不做固定 450 ms 等待；数据到齐后短暂 hold 再淡出，避免闪一下 |
| **秒杀系统（两个专区）** | `supabase/09-deal.sql`、`supabase/13-campaign.sql`、`src/utils/deal.js`、`src/utils/dealImport.js` | 导入/批量开秒杀时**必选归属**：`is_campaign=false` → ⚡ `Limited Deals`（按紧迫度、卡片带倒计时）；`true` → 🔥 大促 Tab（名字读 `settings.deals_tab_label`，按折扣区间 chip 过滤、按折扣从高到低排）。两个 Tab 计数为 0 时各自隐藏 |
| **双角标堆叠** | `src/utils/deal.js` 的 `badgeStackFor()` + `BADGE_ZONE`、`supabase/11-sub-badge-deal-priority.sql` | 第一行是**身份**（大促标 / Limited Deal），第二行是**决定**（运营手填 `sub_tag`）。`sale_*` 是实时算出的状态，`sub_tag` 是人填的决定——所以是两列，不是塞进同一个 `tag`。**两个秒杀专区都不挂活动身份**：大促区连 `Limited Deal` 也不挂（整区都在大促），常规区挂 `Limited Deal` 但摘掉 `Black Friday` 这类标（判定见 `isCampaignLabel`） |
| **后台全中文** | `src/i18n/admin.js` + `scripts/test-admin-i18n.mjs` | 新增后台文案必须中文；漏翻会被测试拦下 |
| **批量改角标 / 分类** | `src/utils/batchBadge.js`、`src/utils/batchOps.js` | 支持快捷模板（Black Friday / Cyber Monday / 50% OFF）、颜色、批量分类；有 `max 32` 等约束与"会被遮住多少"的预览 |
| **图片懒加载** | `src/components/ProductImage.jsx`（`loading` / `decoding`）+ `src/utils/image.js`（`sizedImage` / `imageSrcSet`） | 变体图与列表图都走 srcset；详情用大图尺寸 |
| 商品拖拽排序 | `src/pages/admin/ProductsPage.jsx` + `reorder_products` RPC | 主路径是拖拽，另有置顶/置底/上移/下移/批量；筛选状态下拖拽关闭 |
| 改名迁移 | `src/utils/variantRename.js` | 改颜色/尺码名连带迁移 asins / sold_out_variants / variant_images |
| Coming Soon（teaser） | `src/utils/teaser.js`、`supabase/08-teaser.sql` | 锁购买不锁浏览：颜色可选、尺码不可选、不显示价格与倒计时 |
| ACC 佣金 | `src/utils/acc.js`、`supabase/10-acc.sql` | 生成码时可带 campaign id，一键复制 |
| 选款码查询/解码 | `src/pages/admin/LookupPage.jsx`、`src/components/admin/AdminResult.jsx` | 三个出口：复制清单 / 逐条复制 ASIN / 查看明细 |
| 购物车 7 天生命周期 | `src/hooks/useSelection.js`、`src/utils/selectionExpiry.js` | 时间戳只在"选择真的变了"时更新；`reconcile` 与单纯打开页面**不盖戳** |
| 实时同步 | `src/lib/realtime.js` | 商品/分类/角标改动推到前台；订阅 channel 名为本地命名空间常量（`mako-*`），**不要改**（两站不同源，改了会让老用户丢购物车） |
| 后台门禁 | `src/components/admin/AccessGate.jsx`、`src/lib/auth.js` | Supabase Auth + `public.admin_users` 白名单；无权限账号看到 Not authorised |
| 调试全局 | `src/main.jsx` | `window.SAODIMALLSU.{decode,encode,products,refresh,codePrefix}`；`window.MAKO` 是历史别名，保留一版 |

---

## 4. 环境变量

**唯一正确的文件：项目根目录的 `.env.saodimallsu`。**（本仓库是 B 品牌专用 checkout）

包含 6 个键：

```ini
VITE_SUPABASE_URL=https://xbarvhwnuucstfmobszh.supabase.co
VITE_SUPABASE_ANON_KEY=<见 .env.saodimallsu，sb_publishable_ 开头>
SUPABASE_ADMIN_EMAIL=<运营管理员邮箱>
SUPABASE_ADMIN_PASSWORD=<见 .env.saodimallsu>
BRAND_NAME=Saodimallsu
BRAND_SLUG=sdms
```

> 真实密钥只存在 `.env.saodimallsu` / `.env` 里（均已被 `.gitignore` 覆盖）。
> **不要把密钥贴进文档、提交到仓库或发到聊天里。**

### 4.1 三个必须知道的坑

1. **Vite 只自动读 `.env`，不读 `.env.saodimallsu`。**
   所以本地开发前必须 `cp .env.saodimallsu .env`（`.env` 已在 `.gitignore` 里）。
   `.env.*` 通配也在 `.gitignore` 里（第 19–20 行，只放行 `.env.example`），所以各品牌的 env 文件都不会入库。
   命令行脚本则支持 `--env=.env.saodimallsu` 显式指定。
2. **`BRAND_SLUG` 是 `sdms`，不是 `sdm`。** 它是批处理脚本的防呆护栏：
   `npm run batch:upsert -- <文件> --env=.env.saodimallsu --expect-brand=sdms`
   写错会直接拒绝执行（**这是设计如此**，目的是防止把 B 品牌的数据写进 A 品牌的库）。
3. **换 env 后必须杀进程重启。** Vite 在启动时注入 `import.meta.env`，热更新不会换库。

### 4.2 开工前自检（30 秒，别省）

这个坑真实发生过：`.env` 里填的是 **A 品牌**地址（`xwkghmhuwoivwxuhfnpr`），导致整轮调试都在 A 的数据上做，
页面看起来"能跑"，其实测的是另一个品牌。用下面两条确认：

```bash
# 1) 看注入到 dev 产物里的地址（不要只看 .env 文件）
curl -s http://localhost:5181/src/lib/supabase.js | grep -oE "https://[a-z0-9]+\.supabase\.co"
# 期望：https://xbarvhwnuucstfmobszh.supabase.co

# 2) 用 key 反证归属：打 B 库应 200，打 A 库应 401 Invalid API key
KEY=$(grep -E "^VITE_SUPABASE_ANON_KEY=" .env | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: $KEY" \
  "https://xbarvhwnuucstfmobszh.supabase.co/rest/v1/product_links?select=product_id&limit=1"
```

> 注：`VITE_SUPABASE_ANON_KEY` 是 `sb_publishable_…`（新版 publishable key），**不是 JWT**，
> 解不出项目 ref——所以别用"解 JWT 比对"的办法验库，用上面的 200/401 法。

### 4.3 数据归属怎么一眼分辨

| 库 | 商品特征 |
|---|---|
| **B 品牌（Saodimallsu，当前）** | 针织 / 开衫：`Oversized Cardigans…`、`Striped Cardigan…` |
| A 品牌（Aoysky，旧） | 运动服饰：`Sports Bra…`、`Cargo Pants… Parachute` |

两库的 `p001` 名字完全不同，据此可瞬间判断连的是哪个库。

---

## 5. 测试红线（重要）

### 5.1 默认只跑 `npm test`

```bash
npm test        # 29 个关卡 / 1792 条断言，纯 Node，不碰数据库，几秒到几十秒
```

覆盖：选款行、目录管道、映射（含 `sort_order` 不可回写）、选款码（含 legacy 前缀）、变体图、增量导入、
断货判定（含"无 ASIN = 断货"）、尺码排序、改名迁移、后台筛选、购物车过期、批量脚本、角标配色、
后台全中文/前台零汉字、JSX 标签闭合等。

**改完代码的标准动作：`npm test` 全绿 + `npm run build` 通过。** 这两条够了。

### 5.2 `npm run smoke*` 是「真打数据库」的测试，非极必要不要跑

```bash
npm run smoke          # 前台主路径（需先起 dev server，默认打 5178）
npm run smoke:gate     # 后台权限 / 排序 / 缺货看板 / ASIN 面板 …
npm run smoke:cart     # 购物车 7 天生命周期（只写 localStorage）
npm run smoke:asins    # 查码结果出口
npm run smoke:realtime # 实时订阅
npm run smoke:soldout  # ⚠️ 会「借一个商品写入断货标记，再用 finally 还原」
npm run shots          # ⚠️ 后台各页截图
```

**为什么限制**

- 每一次运行都会产生真实的 Supabase REST/Realtime 请求，**消耗项目流量与配额**；项目后期数据量大，跑一轮代价不低。
- `smoke:soldout` **会写库**（临时标记 + 还原），`shots` 会大量加载图片。线上有真实运营数据时尤其要克制。
- 只有在**极必要时**才跑，且遵守：
  1. 先确认 `.env` 指向 B 库（第 4.2 节）；
  2. 只跑**最小**的那一条，不要整套连跑；
  3. 跑完检查是否有残留（`smoke:soldout` 的还原是否成功）。
- **允许的例外**：像 React #310 这种"必须真机点一下才知道有没有白屏"的崩溃，
  用**最小范围**的浏览器验证（打开首页 → 点 1~3 个商品 → 断言控制台 0 致命错误），验证完即删临时脚本。

### 5.3 构建后必看一项

`npm run build` 之后确认 `dist/index.html` 里的 favicon 引用带 `?v=N`。
favicon 缓存极顽固，换图必须把 `?v=N` 加一，否则浏览器永远显示旧图标。

---

## 6. 目录地图

```
src/
├─ main.jsx                 入口 + 调试全局 window.SAODIMALLSU
├─ App.jsx                  HashRouter 路由
├─ pages/
│  ├─ SelectionPage.jsx     前台主页面（网格/搜索/分页/购物车/生成码/骨架屏）
│  └─ admin/                后台：ProductsPage（商品库）、LookupPage（查码）、
│                           DeveloperPage（解码工具）、AdminLayout
├─ components/
│  ├─ ProductCard.jsx       卡片（角标堆叠；加购按钮是否可用由 `orderable` 决定）
│  ├─ ProductDetail.jsx     详情弹层（规格矩阵、断货置灰、倒计时、ACC）
│  ├─ CartDrawer.jsx        侧边购物车
│  └─ admin/                AccessGate（门禁）、ProductEditor（编辑器 + ASIN 管理）、AdminQuery/AdminResult
├─ utils/                   纯逻辑，全部可被 Node 测试直接 import
│  ├─ code.js               选款码 encode/decode（前缀在这里）
│  ├─ soldOut.js            断货判定（asinLookup 参数）
│  ├─ deal.js               秒杀档期 + badgeStackFor
│  ├─ sku.js                variantKey（唯一实现）
│  ├─ sizes.js              尺码排序（只在渲染时用）
│  ├─ mapping.js            字段白名单（shared / rowToProduct / productToRow）
│  └─ asinsImportCore.js    表格导入核心（readTable / aggregate …）
├─ store/                   linkStore（product_links 视图）、productStore、mapping
├─ hooks/                   useProducts / useSelection / useAuth / useAmazonLinks …
└─ data/
   ├─ products.js           brandConfig + 静态兜底目录
   └─ asins.js              ⚠️ 约 4500 条 ASIN，仅给脚本用，src/ 绝不可 import

supabase/      01…12 建库脚本（见下）
scripts/       test-*.mjs（纯逻辑）/ smoke-*.mjs（浏览器）/ batch-*.mjs（运维）/ build-catalog.mjs
```

---

## 7. 数据库脚本（新库初始化顺序）

SQL Editor 里**按 01 → 12 依次执行**，全部幂等，可重复跑：

| # | 文件 | 作用 |
|---|---|---|
| 01 | `01-schema.sql` | 建表、RLS、`admin_users`、`is_admin()` |
| 02 | `02-import-helpers.sql` | `sync_product_id_seq()` |
| 03 | `03-harden-asins.sql` | `asins` 读权限收紧（只给白名单管理员） |
| 04 | `04-product-links.sql` | `product_links` 公开视图（含 `linked_variants`） |
| 05 | `05-sold-out.sql` | `sold_out_variants` 列 |
| 06 | `06-reorder.sql` | `reorder_products()` RPC |
| 07 | `07-badge-color.sql` | `badge_color` 列 |
| 08 | `08-teaser.sql` | `is_teaser` 列 |
| 09 | `09-deal.sql` | 秒杀档期字段 |
| 10 | `10-acc.sql` | ACC 佣金 |
| 11 | `11-sub-badge-deal-priority.sql` | 副角标 `sub_tag` / `sub_badge_color` + 秒杀专区置顶 `deal_priority` |
| 12 | `12-settings.sql` | 全局设置（大促专区 Tab 名，`deals_tab_label`） |
| 13 | `13-campaign.sql` | 大促归属 `is_campaign`（两个秒杀 Tab 的切分依据；缺列时全部算常规） |

**批量导入（换季上新）**

```bash
# 干跑：只打印计划，一个字节都不写。先看清「新增 / 合并 / 被拒」三个数字
npm run batch:upsert -- "D:/Desktop/spring.xlsx" --env=.env.saodimallsu --expect-brand=sdms

# 落库；首次上新建议加 --hide-new（新货号先 hidden，补完图再放出）
npm run batch:upsert -- "D:/Desktop/spring.xlsx" --env=.env.saodimallsu --expect-brand=sdms --write --hide-new

# 下架：xlsx/csv/txt，一行一个货号
npm run batch:delete -- "D:/Desktop/retired.xlsx" --env=.env.saodimallsu --expect-brand=sdms --force
```

表头固定四列：`货号 | ASIN | 颜色 | 尺寸`（ASIN 可为空，见 2.3）。

---

## 8. 已知坑速查

| 现象 | 原因 / 处理 |
|---|---|
| **点商品详情白屏，`React error #310`** | Hook 被写在提前 `return` 之后。所有 Hook 必须在组件顶层、第一个 early return 之前（见 2.5） |
| 某个字段总读成空，但保存成功 | 漏了 `mapping.js` 的 `rowToProduct()`（见 2.2 第 4 条） |
| 控制台只有一行 400，没有列名 | PostgREST 遇到**不存在的列**会整条 SELECT 报 400。按 `OPTIONAL_COLUMNS` 降级，或先跑对应 SQL |
| 改完 CSS 后页面样式"没生效" | Tailwind 类名没被扫描到，或撞上 dev 热重载（刷新一次） |
| 尺码顺序乱（`XXL` 跑到 `S` 前） | 展示前没走 `sortSizes()`；**不要**改 `specs` 里的数组顺序 |
| favicon 换了不生效 | `index.html` 里的 `?v=N` 没加一 |
| 前台出现中文 | 违反了"前台纯英文"，`npm test` 会用「前台零汉字」拦住 |
| 后台文案被测试拦下 | 后台必须全中文，走 `src/i18n/admin.js` |
| 老选款码解不出来 | 前缀白名单或 `specs` 键序被动过（见 2.1 / 2.2） |

---

## 9. 交接当天建议做的 4 件事

1. `npm install` → `cp .env.saodimallsu .env` → `npm test`（应全绿）→ `npm run build`。
2. `npm run dev -- --port 5181`，按 4.2 节自检库地址与 key 归属，确认页面是**针织/开衫**（B 品牌），不是运动服饰。
3. 点开 1~2 个商品详情：确认弹层正常、无 `#310`、规格可选、出现 `Add to my selection`。
4. 通读第 2 节红线 + `src/utils/soldOut.js`、`src/store/linkStore.js`、`src/store/mapping.js` 三个文件的头部注释。

> 旧版 2775 行的历史复盘在 `HANDOVER-ARCHIVE.md`（Aoysky 时期），只在追查"当年为什么这么设计"时查阅。
