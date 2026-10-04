# keel-how：URL 深读抽取、缓存与文档页（#212）

本会话将改现有子系统。只描述**现在怎么工作**，出处均为仓库内路径与符号。不代替 L1。

## Overview

URL 文档入库后，深读主路径是 Web Console（`researcher serve`，默认 `:4500`）上的文档详情。点「深读」会：

1. 把一次深读记录标成 `reading`
2. 用 runner 抓取 URL 正文
3. 把正文喂给模型写深读产物
4. 成功标 `read`，失败标 `failed`

抓取与抽取在 TypeScript runner 内完成，不把「空正文」交给模型兜底（Library 路径）。缓存是机器级、无 TTL。文档页是服务端 HTML，失败时把 `lastError` 原文丢进紧凑条。

票面 every.to 案例能穿过整条成功路径：HTTP 200 且抽取结果非空（82 字节推荐卡片），于是写出空读记并标 `status=read`，坏结果还被永久缓存。

## 怎么跑

### 入库

- CLI：`researcher library add|import <url>` → `runLibraryAdd`（`src/commands/library.ts`）
- Web：`POST /library/documents` → `handleImportDocument`（`src/web/server.ts`）同样调用 `runLibraryAdd`
- 输入经 `normalizePaperInput`（`src/library/identity.ts`）→ `canonicalizeUrl`（`src/sources/url.ts`）得到 `url:<normalized>`
- 文档 id：`paperIdForSource`（`src/library/identity.ts`）对 canonical id 做 sha256，取前 16 hex，写成 `paper_url_<digest>`。票面 `paper_url_68770fd28371a54c` 即此 digest。

入库**不抓正文**。`runLibraryAdd` 只 `upsertPaper`。

### 触发深读（Web 主路径）

1. 文档页 `renderLibraryPaper`（`src/web/views.ts`）按 `readStatus` 画「深读 / 重新深读 / 重试深读」。重新/重试带 hidden `force=1`。
2. 浏览器 `JSON_FORM_JS`（同文件）把表单 POST 成 JSON 到 `/library/documents/:id/reads`。
3. `handleReads`（`src/web/server.ts`）：
   - 无 `force` 且已有完成读记（`hasCompletedRead`）→ 200，不重跑
   - 同文档任务忙 → 409 `busy`
   - 否则 `upsertRead({ status: 'reading' })`，`registry.startJob`，202
4. Job 调 `libraryReadRunner`（默认 `defaultLibraryReadRunner` → `runLibraryRead`，`src/web/library-read.ts`）。
5. 成功：`upsertRead({ status: 'read', artifactPath })`；失败：`upsertRead({ status: 'failed', lastError })`。

`force: true` **只绕过「已有成功读记则复用」**，不绕过 URL 缓存。

### CLI 深读（不是 every.to 这条）

- `researcher papers read`（`runPapersRead`，`src/commands/papers.ts`）**只接受 arXiv**，同样走 `LibraryReadRunner`。
- `researcher read`（`runRead`，`src/commands/read.ts`）走 topic 管线 `read()`（`src/pipeline/read.ts`），写入 `notes/pending`，**不是** Library 文档页。
- **没有** `library read` 子命令，也没有粘贴全文入口。

### 抓取与抽取

`runLibraryRead` 先 `onEvent(stage=fetch-source)`，再：

```
loadSourceMaterial(sourceId, { docType, requireText: true })
```

（`src/web/library-read.ts` → `src/pipeline/read.ts`）

`loadSourceMaterial` 按前缀分发。`url:` 走 `readUrlSource`：

- 调 `fetchUrlMaterial`（`src/sources/url-fetch.ts`）
- 成功：`paperText = fetched.text`，`fetchInstruction = ''`
- 失败：`requireText === true` 时直接 throw；否则（topic `read()`）填 `source_fetch_instruction`，让 agent 自己抓

`fetchUrlMaterial`：

1. 必须 `url:` 前缀，否则 throw
2. `readUrlCache(canonicalId)` 命中即返回，**不看长度、无 TTL**
3. X 状态 URL → `fetchXStatusMaterial`
4. GitHub 仓库根 → `githubRepoRawCandidates` 先试 raw `paper.pdf` / README
5. 否则 `fetchOneUrl`：`httpGet`（先 `fetch`，失败再 `curl`）
6. HTTP 非 2xx 或 `> MAX_BYTES`（5 MiB）throw
7. PDF / 纯文本 / Markdown 各走自己的路径
8. HTML：`extractHtmlMainText(html)`
9. **仅** `!text.trim()` 时 throw `url fetch produced empty text`
10. `writeUrlCache`

`extractHtmlMainText`：

- title：第一个 `<title>`
- 去掉 script/style/noscript/comment
- **第一个** `<article>`，否则 `<main>`，否则 `<body>`
- 标签换成空白/换行，解码少量实体

这就是 every.to 的根因：文末推荐卡片也是 `<article>`，正则取第一个，得到约 82 字节；非空，不当失败。

### 读记与状态

`PaperRead`（`src/library/model.ts`）：`queued | reading | read | failed`，可选 `artifactPath`、`lastError`、`mutationId`。没有抽取方式、正文字数、失败分类。

落盘：`PaperLibrary.upsertRead`（`src/library/store.ts`）写成

`.researcher-workspace/library/documents/<id>/reads/<readId>.json`

列表状态：`latestReadStatus`（`src/web/discovery.ts`）取 **最新一条** `updatedAt` 的 `status`。零条 = `unread`。

成功产物：`writeLibraryReadArtifact`（`src/web/library-read.ts`）写 frontmatter（`title/authors/source_kind/source_id/source_url/pdf_url/read_id/kind/doc_type/tags`）+ 模型正文。没有 `extraction_method`、`body_chars`、用户粘贴标记。

`runLibraryRead` 在 `loadSourceMaterial` 之后若 `!material.paperText.trim()` 会再 throw 一次。82 字节过得了这关，模型仍会跑，产物可以很空，状态仍是 `read`。

### URL 缓存

实现就在 `src/sources/url-fetch.ts` 底部，**不是** `src/sources/cache.ts`（那是 arXiv）。

- 目录：`resolveResearcherHome()` + `cache/url/`（默认 `~/.researcher/cache/url`，`src/paths.ts`）
- key：`urlCacheKey` = sha256(canonicalId) 前 16 hex（与 `paper_url_` 后缀同一算法、同一输入）
- 文件：`<key>.meta.json` + `<key>.txt`
- `readUrlCache`：两文件都在就读；坏 JSON 当 miss
- `writeUrlCache`：原子写；**不检查长度**
- 无 TTL、无失效、无 `forceRefetch`

票面 `~/.researcher/cache/url/68770fd28371a54c.txt` 即此 key。

### 文档页与 API

| 方法 | 路径 | 处理函数 | 现在做什么 |
|---|---|---|---|
| GET | `/library/documents/:id` | `handleDocumentResource` | HTML：`renderLibraryPaper`；`Accept: json` 只回文档，不含读记 |
| POST | `/library/documents/:id/reads` | `handleReads` | body：`{ force?, mutationId? }`。无粘贴字段 |
| GET | `/library/documents/:id/reads` | 同上 | `readJson` 列表 |
| GET | `/library/documents/:id/reads/:readId` | 同上 | 单条 |
| GET | `.../reads/:readId/artifact` | 同上 | Markdown |
| GET | `.../reads/:readId/stream` | 同上 | SSE |

失败 UI：`renderDeepReadAction`（`src/web/views.ts`）在 `status === 'failed'` 时画「深读失败」+ `lastError`（`.read-error.mono`）+「重试深读」。没有字数、没有「疑似付费墙」、没有 textarea。

进行中：一行「深读中 / 正在提取内容并生成深读产物。」，日志在折叠「运行详情」。

身份表：`renderPaperIdentityMeta` 对 `url:` 写一行「来源」= canonical URL，若产物 frontmatter 还有 `source_url` 再写一行「来源」。票面把重复来源列为范围外可选顺手修。

## 东西在哪

| 机制 | 路径 | 符号 |
|---|---|---|
| HTML 抽取（第一篇 article） | `src/sources/url-fetch.ts` | `extractHtmlMainText` |
| 抓取 + 只拒空正文 | 同上 | `fetchOneUrl` |
| URL 缓存读写 | 同上 | `readUrlCache` `writeUrlCache` `urlCacheKey` |
| 对外抓取入口 | 同上 | `fetchUrlMaterial` |
| URL 规范化 | `src/sources/url.ts` | `canonicalizeUrl` |
| 文档 id | `src/library/identity.ts` | `paperIdForSource` `normalizePaperInput` |
| 来源加载 / requireText | `src/pipeline/read.ts` | `loadSourceMaterial` `readUrlSource` |
| Topic 深读（agent 兜底） | 同上 | `read` |
| Library 深读 runner | `src/web/library-read.ts` | `runLibraryRead` `writeLibraryReadArtifact` |
| 读记模型 | `src/library/model.ts` | `PaperRead` `PaperReadStatus` |
| 读记落盘 | `src/library/store.ts` | `upsertRead` `listReads` |
| Web 读记 API | `src/web/server.ts` | `handleReads` `readJson` `hasCompletedRead` |
| 文档页 / 失败条 | `src/web/views.ts` | `renderLibraryPaper` `renderDeepReadAction` `renderPaperIdentityMeta` |
| 列表状态 | `src/web/discovery.ts` | `latestReadStatus` |
| 全局配置（无抽取门槛） | `src/config/global-config.ts` | `GlobalConfigSchema` |
| 机器 home | `src/paths.ts` | `resolveResearcherHome` |
| serve 入口 | `src/cli.ts` | `serve` 默认端口 `4500` |
| Library CLI（无 read） | `src/cli.ts` / `src/commands/library.ts` | `library add/import/list/show` |
| 现有单测 | `tests/sources/url-fetch.test.ts` | `extractHtmlMainText` / cache 第二次命中 |
| 现有 HTTP 测 | `tests/web/server.test.ts` | POST `/reads`、`force` |
| 现有 runner 测 | `tests/web/library-read.test.ts` | mock `fetchUrlMaterial` |
| 驾驶手册 | `.agents/skills/verify-researcher/SKILL.md` | Launch / Doctor / Drive |
| 文档详情功能图 | `.agents/skills/verify-researcher/features/document-detail.md` | 含 #209 失败原因 |

## Gotchas

1. **非空即成功**。`fetchOneUrl` 与 `runLibraryRead` 都只拦 `trim()` 后空串。推荐卡片、登录墙、cookie 墙只要有几个词，就会写成 `read`。
2. **坏缓存比坏抽取更持久**。`readUrlCache` 在 HTTP 之前返回。`force` 重跑仍命中同一 `<sha16>.txt`。无删除/TTL/forceRefetch API。
3. **缓存是机器全局的**，按 `RESEARCHER_HOME`，不是 workspace。隔离测试必须自设 `RESEARCHER_HOME`（现有 `url-fetch` 单测已这么做）。
4. **`requireText` 只绑 Library runner**。topic `read()` 抓取失败会改成「让 agent 自己抓」，不把失败写进 Library `PaperRead`。
5. **失败文案是英文异常串**。`lastError` 直接进页面 `.read-error.mono`。没有 `failureCode`，UI 做不出「抽取过短 / N 字」。
6. **成功产物不记抽取过程**。frontmatter 没有 method / 长度 / 是否用户粘贴。
7. **没有粘贴通道**。`handleReads` 的 JSON 只有 `force` 与 `mutationId`。CLI 也没有 paste-file。
8. **`papers read` 帮不上 URL 文档**。它在 `runPapersRead` 里直接拒绝非 arXiv。
9. **后一次失败按设计不应吃掉前一次产物**（`docs/design/186-standalone-notes.md`），但本次 every.to 是「成功且空」，不是 failed。修复后需要决定这些历史 `read` 空产物怎么处理。
10. **重复「来源」**在 `renderPaperIdentityMeta`：canonical URL 一行 + frontmatter `source_url` 一行。范围外。
