# L1：正文开头不再带副标题、日期和 newsletter 行

- Issue：[#217](https://github.com/xforce-io/researcher/issues/217)
- 层级：**L1**
- 状态：**Approved**
- 日期：2026-10-12
- 批准：peng via Jenny 2026-10-12
- 分支：`bugfix/217-strip-extract-lead-in`
- 现有机制：本会话 keel-how（见文末 §15）；[212-url-extract-readability.md](212-url-extract-readability.md)；`src/sources/url-extract.ts`

Issue 是验收依据。L1 已 Approved。L2 不需要（见 §13）。

## 1 背景

#212 把 HTML 抽取切到 `@mozilla/readability`（linkedom）后，every.to 这篇（夹具 `tests/fixtures/url-extract/everyto-codex-graded.html`，对应 `paper_url_68770fd28371a54c`）已能过最短正文门槛：Readability 得到约 **2424 字 / 410 词**。但抽出正文的**起始处**仍带着页面装饰行：副标题、日期/更新行、newsletter 征订行，与文章本身第一段粘在一起。Knox 在 #212 交付里标为 P3，本票承接。

用户深读时，喂给模型与出现在产物里的正文应从文章本身开始，而不是从这些页头装饰开始。

## 2 名词解释

沿用 [名词表](../glossary.md) 的文档、深读记录、深读产物、Library，以及 #212 的抽取方式、最短正文门槛。本设计新增：

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| 开头装饰行 | 抽出正文**起始处**的副标题、日期/更新元信息、newsletter 征订提示；不属于文章论述本身 | chrome、页眉、boilerplate（泛称不可单独验收） |
| 文章本身起始 | 作者论述的第一句/第一段；对本票 every.to 夹具即含 `blank slate` 的那段起笔 | 正文任意处、标题字段 |

「字」「词」与 #212 相同。不引入新门槛数字。

对本票 every.to 夹具，三类开头装饰行的可观察样例（验收钉死用，不是全站字典）：

| 类 | 夹具中的样例文本（可读性输出里可连写） |
|---|---|
| 副标题 | `Five prompts that took me from one-off chats to delegating whole projects to teams of agents` |
| 日期行 | `Oct 2, 2026 · 10 min read`，以及 `Updated Oct 4, 2026` |
| newsletter 行 | `Was this newsletter forwarded to you? Sign up to get it in your inbox.` |

## 3 目标与非目标

目标（与 Issue S1 对应）：

- **S1** 对 #212 验收用的那篇 every.to 做深读抽取时，抽出正文不以副标题、日期行或 newsletter 行开头；对应测试通过。文章本身起始仍在，且仍过 #212 最短正文门槛。

非目标：改 #212 的最短长度门槛与缓存策略（含 #216 自愈）；改 `:4500` 部署；改粘贴全文重新深读；改 PDF / 纯文本 / Markdown / X 状态路径；给公共 API / CLI / 配置加新旋钮；扫盘改写历史上已缓存的正文。

## 4 能力

深读 HTML 抽取（Readability 主路径；若走 DOM 回退，对**同一夹具**同样不得以这三类行开头）在把正文交给门槛判定与下游之前，须保证：

1. 抽出正文的起始处**不是**副标题、日期行或 newsletter 行（三类都不在起始处；可连写成一行时，整段开头装饰须去掉）。
2. 去掉开头装饰后，正文从文章本身起始继续；对本票夹具须仍匹配 `blank slate` / `Eight Levels` 一类原文，且 `countBodyStats` 仍过当前门槛。
3. `title` 字段继续单独承载页面标题（如 `How to Get Better at AI by Asking AI`）；本票不要求也不禁止标题出现在正文里——只约束**开头装饰三类**。
4. 抽取方式元数据（`readability` / `dom-fallback`）、门槛失败语义、缓存写入条件均保持 #212 / #216 契约。

实现可把「去掉开头装饰」做在 DOM 预处理、Readability 之后的文本修剪、或两者组合；**产品只认抽出正文的可观察起始**，不预定算法。允许对同类页头装饰做一般化处理，使其它站点顺带受益；**必需验收仍只钉 every.to 这篇**（Issue S1），不把「全网无装饰」写成新 Story。

## 5 思路与折衷

#212 解决的是「抽到推荐卡 / 过短仍标已深读」；本票解决的是「抽到了真正文，但页头装饰仍在起始处」。两者都是用户可见正文质量，但不改门槛与缓存。

放弃：只改 every.to 域名特判而把规则写死进产品契约（站点改版即失效，且 Issue 描述的是装饰**类**而非域名）。放弃：把副标题并进 `title` 或另开元数据字段（超出 In 范围）。放弃：调低门槛或改缓存来「冲淡」装饰行。

保留：#212 Readability → DOM 回退顺序、门槛数字、过短不写缓存、#216 自愈。

## 6 架构

```
fetchUrlMaterial → extractHtmlArticle
  ├─ tryReadability / extractDomFallback
  ├─ 去掉开头装饰行（本票；位置实现自定）
  ├─ 最短正文门槛（#212，不变）
  └─ 过门槛才写缓存 / 喂模型
```

主路径：every.to 夹具 → 正文起始为文章本身。
失败路径：去掉装饰后若仍过短 → 仍按 #212 `extract_too_short`（本票夹具去掉装饰后仍应过门槛，回归锁住）。
保留路径：粘贴全文、PDF/plain、自愈判断不变。

## 7 模块

| 模块 | 负责 |
|---|---|
| `src/sources/url-extract.ts` | HTML 抽取结果在出门前不含开头装饰行 |
| `tests/sources/url-extract.test.ts` | S1：every.to 夹具起始断言；门槛与 `blank slate` 回归 |
| 可选：同目录夹具 | 不强制新 HTML；优先钉现有 `everyto-codex-graded.html` |

不改 `url-fetch` 缓存形状、runner、Web、CLI、配置，除非实现必须复用已有导出（无新公共契约）。

## 8 API/CLI

无。`extractHtmlArticle` / `fetchUrlMaterial` 的调用方契约不变：仍返回 `title` + `text` + `extractionMethod`；无新配置键。

## 9 边界

- 只约束抽出正文的**起始处**；文章中段若出现日期或 “newsletter” 字样，不在本票删除范围内。
- 不要求删除作者名、封面 figcaption、文末相关推荐（#212 已要求不落在推荐卡）。
- 不回写或失效已存在的长缓存正文；用户若要干净正文，对 URL **强制重抓**或清该 key 后再深读（与现网一致）。产品不承诺自动迁移旧缓存文本。
- 不改 `:4500`。

## 10 迁移 / 兼容 / 回滚

- 无存数迁移。新抽取立即生效；旧缓存仍可能带装饰，直到 miss / 强制重抓。
- 回滚代码即回到「Readability 原文可含开头装饰」；已写出的干净缓存不会自动变脏。

## 11 测试计划（L1.8）

不新增功能文件。用户入口仍是 Library 对 every.to 这篇深读（夹具强制重抓或本地静态页）；本票用单测锁起始处。

| Story | 功能文件 | 用户入口 |
|---|---|---|
| S1 本票 | 现有 `.agents/skills/verify-researcher/features/url-extract-reread.md`（S1 抽取） | 打开 every.to 这篇深读；产物/抽出正文起始不是三类装饰 |

### L1.8 验收表

| ID / 关联 | 前置 | 路径 | 结果与禁止行为 | 证据 / 执行 / 属性 |
|---|---|---|---|---|
| S1.A1 / S1 | 仓库夹具 `tests/fixtures/url-extract/everyto-codex-graded.html`；当前默认门槛 | 对夹具跑 `extractHtmlArticle`（或 Library 深读夹具路径） | 抽出 `text` 起始处不含副标题样例、不含 `Oct 2, 2026` / `Updated Oct 4, 2026` 日期行、不含 newsletter 征订句；正文仍匹配 `/blank slate/i` 与 `/Eight Levels/i`；`countBodyStats` 过门槛；`extractionMethod` 为 `readability`（或该夹具若回退则 `dom-fallback`，但起始约束相同） | 单测断言起始与回归；agent 可执行；禁止默认 `npm test` 打 live every.to；必需 |
| S1.A2 / S1 | 同夹具 | 既有 every.to 回归（推荐卡、字数） | 不回归到文末推荐卡；字数仍 ≥ 1000；不把去掉装饰写成「过短失败」 | 现有 `every.to fixture path` 用例保持绿，并加上起始断言；必需 |

Unit：`tests/sources/url-extract.test.ts`

- every.to 夹具：起始不是三类装饰；`blank slate` / `Eight Levels` 仍在；字数过门槛（S1.A1 / S1.A2）
- 既有门槛边界与 DOM 回退用例保持

禁止把 live URL 写进默认 `npm test`。

## 12 开放问题

无阻塞项。Issue In/Out 与 S1 已钉死 every.to 这篇。

记录供实现参考（不改产品契约、不另交 peng）：

- 装饰行在 Readability 输出里可能被拼成**同一行**（夹具现状：副标题+日期+更新+newsletter 无换行粘连）；验收按「起始处不含这些文本」判定，不要求先有换行再删行。
- 一般化修剪可以做，但必需验收不扩成「所有站点零装饰」。

## 13 是否需要 L2

不需要。未命中 when-to-write 的 L2 条：无公共 API / CLI / 配置变更，无新存储形态或跨模块责任，无新运行时依赖；沿用 #212 抽取机制，只修正抽出正文起始的产品结果。

## 14 关联

- [#217](https://github.com/xforce-io/researcher/issues/217)
- [#212](https://github.com/xforce-io/researcher/issues/212) / [#213](https://github.com/xforce-io/researcher/pull/213)（Readability；Knox P3：开头带副标题/日期/newsletter）
- [#216](https://github.com/xforce-io/researcher/issues/216)（缓存自愈；本票不改）
- [212-url-extract-readability.md](212-url-extract-readability.md)
- [216-cache-contenttype-selfheal.md](216-cache-contenttype-selfheal.md)

## 15 keel-how（本会话，将改子系统）

**Overview.** HTML 深读正文由 `extractHtmlArticle`（`src/sources/url-extract.ts`）产出：先 `tryReadability`（linkedom + `@mozilla/readability`），过门槛则 `extractionMethod: 'readability'`；否则 `extractDomFallback`；再空/过短则 `UrlExtractError`。`normalizeExtractedText` 只做空白折叠，**不删**页头装饰。

**怎么跑.** `fetchUrlMaterial`（`src/sources/url-fetch.ts`）在 HTML 分支调用 `extractHtmlArticle(html, loadUrlExtractThreshold())`；Library 深读经 `runLibraryRead` → `loadSourceMaterial` → `fetchUrlMaterial`。

**东西在哪.**

- 抽取：`src/sources/url-extract.ts` · `extractHtmlArticle` / `tryReadability` / `extractDomFallback` / `normalizeExtractedText`
- 夹具：`tests/fixtures/url-extract/everyto-codex-graded.html`
- 回归：`tests/sources/url-extract.test.ts` · `every.to fixture path`

**Gotchas / 问题证据.**

- 预期：正文从文章本身起笔（Issue #217；Knox P3）。
- 实际（本会话对夹具跑 Readability）：约 **2424 chars**，`title` 为文章标题；**第一段文本**以副标题 + `Oct 2, 2026 · 10 min read` + `Updated Oct 4, 2026` + newsletter 征订句开头，随后才是 `For most of my working life... blank slate`。
- 根因判断依据：Readability 把 post-intro 的 subtitle / post-meta-bar 与 `articleBody` 征订句一并进 `textContent`；当前管道无「开头装饰」修剪。尚未验证的实现假设：在门槛前修剪起始装饰即可同时满足 S1 与字数门槛（夹具去掉装饰后仍远超 1000 字）。
