# 项目长期约定（MAKO 红人专属选款网站）

> 只记「不写下来下次一定会踩」的东西。日常进展记在 `YYYY-MM-DD.md`。

## 数据层硬约束

- **`products.specs` 只能追加，永不重排、永不删除、永不给已有商品新增规格维度。**
  选款码存的是选项**下标**（v4）和商品在列表中的**位置**（legacy），`specTypes = Object.keys(specs)`
  还决定一个码有几位。给一个 one size 商品补上 `Size: []`，会让它历史上发出去的每个码都错位。
  同理 `sort_order` 不能动。

- **`products` 的写入 payload 要窄。** 运营在 `/#/admin` 里手工填了名字/分类/图片，这些不在
  `src/data/products.js` 里。任何「把本地文件 upsert 上去」的脚本都会冲掉它们 ——
  `push-supabase.mjs` 是重建工具（首次导入用），日常补数据要用 `import-asins.mjs`（只 update `specs`）。

- **`asins.variants` 的增量合并必须先读后写。** 一列 json，没法在 SQL 里做部分更新；
  表里没提到的键不在 payload 里，才可能「绝不删除」。

- **`public/` 是 Vite 的隐形泄露通道**，`public/*` 会原样拷进 `dist/`。全量 ASIN 只能放
  `scripts/out/`（已 gitignore），`src/` 下也不许 import `data/asins.js`（动态 `import()` 也不行）。

## 工具与流程

- **表格类数据先自己数一遍再信工具。** `workbuddy-sheetagent` 报「0 空行」时，实际
  `!ref` 是 `A1:D3773`、真实数据只到 3296 行 —— 有 477 行空行。用 `XLSX` 读出来自己
  `filter(allEmpty)` 才算数，否则会导入 477 个空变体。

- **测试写「只能靠量」的断言。** 尺寸、行数、`object-fit`、`line-clamp`、视口内的按钮位置 ——
  这些从代码里读不出来，只能真开浏览器量。

- **改动前先量，别照着用户描述改。** 用户说「标题单行截断」，实测早就是 `line-clamp-2`，
  真正的问题是卡宽 169px 下两行只放得下 20 字符。照着症状改会改坏一个本来就对的属性。
