# L1：旧缓存非 html contentType 也走自愈

- Issue：[#216](https://github.com/xforce-io/researcher/issues/216)
- 层级：**L1**
- 状态：**Draft**
- 日期：2026-10-08
- 分支：`bugfix/216-cache-contenttype-selfheal`
- 现有机制：[212-url-extract-readability.md](212-url-extract-readability.md) §4.4 S4；[212-url-extract-how.md](212-url-extract-how.md)

Issue 是验收依据。本文是 Draft，未 Approved。L2 不需要（见 §13）。

## 1 背景

#212 给 URL 抽取缓存加了读时自愈：命中后若正文低于**当前**门槛，删 key 当 miss。实现把「要不要判断」写成 `contentType` 包含 `html` 才进入门槛。旧记录的 `contentType` 来自当时的 HTTP 头；空头会落成 `application/octet-stream`，HTML 抽取仍可能已经跑过。这类短/坏正文今天会被当成可用命中。

#212 同时规定：过门槛才写缓存，只针对 HTML 抽取失败。PDF / 纯文本 / Markdown / X 状态只要非空就会写入，其中可以合法地短。自愈不得把这些成功产物仅仅因为短而丢掉。

## 2 名词解释

沿用 [名词表](../glossary.md) 的文档、深读记录、深读产物、Library，以及 #212 的最短正文门槛、强制重抓。本设计新增：

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| 自愈判断 | 读 URL 缓存命中后，决定这条记录是可用命中，还是删掉该 key 当 miss 的规则 | TTL、清缓存、强制重抓 |
| 类型化非 html 产物 | 已标明为 pdf / plain / user-pasted，或旧记录 contentType 已是 pdf / text/plain / text/markdown 的成功缓存 | 任意短正文、非 html 一律放过 |

「字」「词」与 #212 相同。不引入新门槛数字。

## 3 目标与非目标

目标（与 Issue S1 对应）：

- **S1** 任意 `contentType` 的旧缓存都进入自愈判断，不再因为不含 `html` 而被跳过。至少一条非 html 短记录被测到：重读不当可用命中。

非目标：改 HTML 抽取（Readability / DOM 回退）；给缓存加 TTL 或扫盘；改写入门槛本身；改 `:4500`、Node 版本、公共 API / CLI / 配置 / 缓存文件形状；#217–#220、#201。

## 4 能力

每次 `fetchUrlMaterial` 读缓存（且未 `forceRefetch`）都必须做自愈判断。`contentType` 不再是进入判断的前提。

判断结果只有两种：

| 结果 | 条件 | 行为 |
|---|---|---|
| 删 key 当 miss | 正文低于**当前**门槛，且**不是**类型化非 html 产物 | 删该 key 的 `.txt` / `.meta.json`，继续 HTTP |
| 可用命中 | 正文过门槛，或是类型化非 html 产物 | 返回缓存，不打网 |

类型化非 html 产物（不过长度门槛）：

- `extractionMethod` 为 `pdf` / `plain` / `user-pasted`（#212 之后的成功非 html 写入）
- 或旧记录没有 HTML 抽取方式（`readability` / `dom-fallback`），且 `contentType`（大小写不敏感）标明 `application/pdf`、`text/plain` 或 `text/markdown`

其余短记录一律当 miss，包括：

- `contentType` 含 `html` 的短正文（#212 已覆盖）
- 旧记录 `contentType` 为 `application/octet-stream`、空、或其它未类型化值的短正文（本票）
- `extractionMethod` 为 `readability` / `dom-fallback` 且现在低于门槛的记录（门槛被调高时仍自愈）

长正文无论 `contentType` 都是可用命中。不扫全目录。粘贴正文仍不写 URL 缓存。

## 5 思路与折衷

#212 的意图是「坏 HTML 抽取进不去、已经进去的下次丢掉」，不是「所有短缓存都非法」。旧写入把空 Content-Type 记成 `application/octet-stream`，却仍可能对看起来像 HTML 的字节跑过抽取；用 `includes('html')` 当闸门会漏掉这些毒缓存。

放弃：对所有 contentType 一律套门槛（会在下次读时丢掉合法短 PDF / README / X 状态，并造成写了再删的循环）。放弃：只看正文是否像 HTML 标签（缓存里存的是抽取后的纯文本，毒缓存往往没有标签）。

保留：当前门槛数字、按 key 删除、`forceRefetch`、过短 HTML 不写缓存。

## 6 架构

```
fetchUrlMaterial
  └─ 未 forceRefetch
       └─ 读 <key>.meta.json + <key>.txt
            └─ 自愈判断（与 contentType 是否含 html 无关）
                 ├─ 短且非类型化非 html 产物 → 删 key → HTTP
                 └─ 过门槛或类型化非 html 产物 → 返回命中
```

主路径：非 html 旧短缓存进入判断 → miss → 重抓。
保留路径：短 PDF / 纯文本命中仍返回，不重抓。
失败路径：重抓后仍过短的 HTML 继续 throw、不写缓存（#212）。

## 7 模块

| 模块 | 负责 |
|---|---|
| `src/sources/url-fetch.ts` | 读缓存时的自愈判断；删除仍只针对本 key |
| `tests/sources/url-fetch.test.ts` | S1：非 html 短缓存进入判断并当 miss；类型化短产物仍命中 |

不改抽取、runner、Web、CLI、配置。

## 8 API/CLI

无。`fetchUrlMaterial` 的调用方契约不变：同一 `canonicalId`，同一可选 `forceRefetch`。缓存目录、文件名、`meta.json` 字段集合不变。

## 9 边界

- 只影响 URL 抽取缓存读路径，不影响 arXiv 缓存。
- 不把合法短 PDF / 纯文本 / Markdown / X 状态当毒缓存。
- 未知或空 `contentType` 的短记录按毒缓存处理（fail closed），不猜测它是 PDF。
- 不改粘贴、强制重抓、门槛配置。

## 10 迁移 / 兼容 / 回滚

- 无存数迁移、不扫盘。旧 key 在下一次 `fetchUrlMaterial` 时按新判断处理。
- 回滚代码即回到「只对 html contentType 自愈」；已删的毒缓存不会自动回来。
- 新写的 HTML 过短仍不落盘；新写的短 PDF / plain 仍落盘，且下次读仍命中。

## 11 测试计划

不新增功能文件。用户入口仍是 Library 对已缓存 URL 再深读；本票用单测锁判断。

| Story | 功能文件 | 用户入口 |
|---|---|---|
| S1 本票 | 现有 `.agents/skills/verify-researcher/features/url-extract-reread.md`（S4 自愈） | 再次深读一条已缓存 URL；非 html 短记录不得直接当命中 |

Unit：`tests/sources/url-fetch.test.ts`

- 旧记录 `contentType: application/octet-stream`、短正文、无 `extractionMethod`：当 miss，HTTP 被调用，成功正文覆盖该 key（S1）
- 短 `extractionMethod: pdf` / `plain`：仍命中，不打网
- 已有：短 `text/html` 自愈；过短 HTML 不写缓存

禁止把 live URL 写进默认 `npm test`。

## 12 开放问题

无。调查后选定 §4 的类型化非 html 豁免；若不豁免，S1 只能靠「凡短即删」，会丢掉合法短 PDF / 纯文本。该选择不改公共契约，不另交 peng。

## 13 是否需要 L2

不需要。未命中 when-to-write 的 L2 条：无公共 API / CLI / 配置变更，缓存存储形状不变，无新运行时依赖。

## 14 关联

- [#216](https://github.com/xforce-io/researcher/issues/216)
- [#212](https://github.com/xforce-io/researcher/issues/212) / [#213](https://github.com/xforce-io/researcher/pull/213)（S4 自愈；Knox P3 指出非 html 漏判）
- [212-url-extract-readability.md](212-url-extract-readability.md)
- [212-url-extract-how.md](212-url-extract-how.md)
