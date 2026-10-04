# L1：URL 抽取可靠化与粘贴全文重新深读

- Issue：[#212](https://github.com/xforce-io/researcher/issues/212)
- 层级：**L1**（下文 L2 为同一路径的实现边界）
- 状态：**Approved**
- 日期：2026-10-04
- 批准：peng 2026-10-04 22:53 Asia/Shanghai，D1–D7 按推荐；身份表「来源·用户粘贴」改为「正文来源」
- Knox：生产路径禁止正则抽取。Readability 不过门槛则 linkedom DOM 启发式回退。徽标文案「已回退备用抽取」（L2 注明，无需再问 peng）
- 分支：`bugfix/212-url-extract-readability`
- 现有机制：[212-url-extract-how.md](212-url-extract-how.md)
- 线框：[wireframes/](212-url-extract-readability/wireframes/)

线框（静态 HTML 复用 `app.css`，无头 Chrome 1366×960）：

| 状态 | PNG |
|---|---|
| B 正常已深读 | [01-normal-read.png](212-url-extract-readability/wireframes/01-normal-read.png) |
| C 抽取过短 | [02-failed-too-short.png](212-url-extract-readability/wireframes/02-failed-too-short.png) |
| D 抓取失败 | [03-fetch-error.png](212-url-extract-readability/wireframes/03-fetch-error.png) |
| E 重新深读进行中 | [04-rereading.png](212-url-extract-readability/wireframes/04-rereading.png) |
| F 粘贴过短校验 | [05-paste-too-short.png](212-url-extract-readability/wireframes/05-paste-too-short.png) |
| G 粘贴成功 | [06-paste-success.png](212-url-extract-readability/wireframes/06-paste-success.png) |

Issue 是验收依据。L1 已 Approved。L2 只补实现边界，不改已批契约；Knox 的 DOM 回退与四条选节点/测试规则见文末 L2。

## 1 背景

URL 文档 `paper_url_68770fd28371a54c`（every.to [codex-graded-my-ai-habits…](https://every.to/p/codex-graded-my-ai-habits-then-it-became-my-coach)）抓取 HTTP 200、约 158KB，正文抽取只得到 82 字节。现有 `extractHtmlMainText` 用正则取第一个 `<article>`，命中文末推荐卡片；非空即放行；`runLibraryRead` 照常写读记并标 `status=read`；URL 缓存无 TTL，重读继续命中坏缓存。

peng 已批准本票端到端范围。本文件只锁定契约与失败 UX，供审阅。

## 2 名词解释

沿用 [名词表](../glossary.md) 的文档、深读记录、深读产物、Library。本设计新增：

| 规范名 | 一句话定义 | 禁止别称 |
|---|---|---|
| 抽取方式 | 得到喂给模型的正文的方法：`readability` / `legacy-html` / `pdf` / `plain` / `user-pasted` | parser、engine |
| 最短正文门槛 | 判定抽取或粘贴是否可用的默认下限：1000 字或 150 词，可配置 | 质量分、付费墙分 |
| 粘贴全文 | 用户把原文贴进文档页，作为本次深读正文，不经 URL 抓取 | 手动导入、覆盖来源 |
| 强制重抓 | 本次深读跳过 URL 缓存，重新 HTTP | 清缓存、TTL |
| 失败分类 | `extract_too_short` / `fetch_error` / `empty_text` / `agent_error` | 笼统 failed |

「字」= Unicode 码点去掉首尾空白后的长度。「词」= 按空白切开的非空段。不在 L1 做中文分词。

## 3 目标与非目标

目标（与 Issue S1–S4 一一对应）：

- **S1** 用 `@mozilla/readability` 抽 HTML 正文，旧正则作兜底；读记/元数据记录抽取方式与正文长度。every.to 这篇 ≥ 1000 字；回归样本不短于修复前。
- **S2** 低于门槛视为抓取失败：不写读记产物、不标已深读；失败原因与抽到的长度可持久看见。
- **S3** 失败文档页说清原因与字数，可粘贴全文重新深读；产物标明来源是用户粘贴。
- **S4** 过短内容不写 URL 缓存；重读不命中坏缓存；已有毒缓存可自愈。

非目标：付费墙指纹；重复「来源」显示（可顺手，见 §12）；topic `read()` 改成强制 requireText；给 `papers read` 加 URL；自动改写历史上已标 `read` 的空产物。

## 4 能力

### 4.1 S1 抽取

HTML 主路径：linkedom 把字符串变成 Document，再 `@mozilla/readability` 的 `Readability.parse()`。

推荐 **linkedom**，不选 jsdom：

- researcher 是 Node CLI / 本机 serve，不是浏览器 bundle。只需要一份 Document，不要 jsdom 的 Window/CSSOM。
- linkedom 体积与冷启动远小于 jsdom，每次深读都要 parse 一次 HTML。
- Readability 只依赖 DOM Document；`parseHTML` 够用。
- 旧 `extractHtmlMainText` 仍是兜底，linkedom 边缘 API 缺口不会让抽取归零。

顺序：`readability` 得到非空 textContent → 用它。否则 `legacy-html`。再空 → `empty_text` 失败。PDF / 纯文本 / Markdown / X 状态路径不变，方式记 `pdf` 或 `plain`。

成功喂给模型前，把抽取方式与 `bodyChars` / `bodyWords` 写入：

- 深读产物 frontmatter：`extraction_method`、`body_chars`、`body_words`
- 本次 `PaperRead` 的同名可选字段（失败时也能看，不依赖产物）

回归：见 §11。every.to 夹具 + 至少 3 个此前成功的 URL HTML 夹具。夹具进仓库，单测不打网。

### 4.2 S2 门槛

默认：**字数 < 1000 或 词数 < 150 即失败**（票面原文）。配置见 §12 D2。

门槛在「已得到候选正文、写入缓存之前」判定。失败：

- throw 带稳定前缀的错，例如 `url extract too short: 82 chars, 12 words (min 1000 chars or 150 words)`
- Library runner 不调模型、不写产物
- `upsertRead({ status: 'failed', lastError, failureCode: 'extract_too_short', extractedChars, extractedWords, extractionMethod })`
- 文档状态是「深读失败」，不是「已深读」

`empty_text` 与 HTTP/网络失败同样不写产物、不标已深读。模型自己挂了仍是 `agent_error`（现有行为）。

topic `read()` 保持今天的 `requireText` 默认 false：门槛失败会 throw，于是走进现有 agent-fetch 兜底。不把 Library 失败 UX 扩到 topic notes。

### 4.3 S3 失败 UX 与粘贴全文

只出现在 paper/blog 等可深读的外部材料详情。自主笔记 / 视频不动。

失败面板放在现有 `document-header` 的 banner 位（与今天「深读失败」同一槽），可以长过一行，但默认不铺英文日志。阅读面仍在：无产物用空态；若曾成功过，保留上次产物（#186）。

#### 页面状态与文案

所有可见文案简体中文，语气跟现有「深读失败 / 重试深读 / 尚无深读产物」对齐。`lastError` 英文诊断只进折叠「运行详情」。

**A. 正常 · 未深读**

- 元数据：未深读
- 主按钮：深读
- 阅读面：尚无深读产物，可点击深读开始。
- 无粘贴区

**B. 正常 · 已深读**（抓取成功，非粘贴）

- 元数据：已深读
- 主按钮：重新深读（`force: true`，且 `forceRefetch: true`，见 S4）
- 身份表可有一行：抽取：Readability · 正文 12,480 字
- 无失败条、无粘贴区

**C. 失败 · 抽取过短**（线框 `02-failed-too-short.png`）

- 元数据：深读失败
- 条目标题：深读失败
- 原因：抽取正文过短，可能是付费墙或页面结构干扰。只得到 82 字 / 12 词（门槛 1000 字或 150 词）。
- 说明：可从原文复制全文，粘贴后重新深读。
- 文本框标签：原文全文
- placeholder：把原文全文粘贴到这里
- 主按钮：用粘贴全文重新深读（文本框空或仍过短时 disabled）
- 次按钮：强制重新抓取
- 阅读面：无产物则「尚无深读产物。」；不把 82 字当正文展示

**D. 失败 · 抓取错误**（线框 `03-fetch-error.png`）

- 元数据：深读失败
- 条目标题：深读失败
- 原因：抓取失败。页面给一行中文归类（「网络超时」/「HTTP 403」/「HTTP 404」/「无法连接」）；归不了就写「抓取失败」。
- 细节：折叠「运行详情」里放 `lastError`
- 同样有粘贴区 + 主按钮「用粘贴全文重新深读」+ 次按钮「重试深读」（`force: true`，`forceRefetch: true`）

**E. 重新深读进行中**（线框 `04-rereading.png`）

- 元数据：深读中
- 沿用现有：深读中 / 正在提取内容并生成深读产物。
- 粘贴区保留但 disabled，提示：深读进行中，完成前不能再次提交。
- 主按钮「深读」不出现。日志仍在折叠「运行详情」。

**F. 粘贴校验过短**（线框 `05-paste-too-short.png`）

- 仍停在失败态，不发 POST，不新建 `reading` 记录
- 文本框下红字：粘贴内容过短（320 字 / 48 词）。请贴全文后再试，门槛是 1000 字或 150 词。
- 主按钮保持 disabled
- 服务端若仍收到过短粘贴：422，不改读记。`error: paste_too_short`，文案同上。页面内联显示，不用 `alert`。

**G. 粘贴成功**（线框 `06-paste-success.png`）

- 元数据：已深读
- 主按钮：重新深读
- 身份表必有一行：来源：用户粘贴（与 URL 行分开，不替代原文链接）
- 产物 frontmatter：`extraction_method: user-pasted`，以及本次粘贴的 `body_chars` / `body_words`
- 无失败条、无粘贴区（与正常已深读相同；用户若再失败，粘贴区回来）

未深读页不预置粘贴区。先抓取，失败后再给人一条逃逸路径。

#### 交互

1. 打开失败文档 → 立刻看见原因、字/词、两个动作。
2. 「强制重新抓取 / 重试深读」：POST `{ force: true, forceRefetch: true }`，进状态 E。
3. 往文本框粘贴 → 本地按同一门槛计数；过短显示 F，达标后按钮可点。
4. 「用粘贴全文重新深读」：POST `{ force: true, pastedText }`。服务端再判一次门槛。过短 422（F）。达标则 `reading` → runner **跳过 fetch**，用粘贴正文 → 成功则 G。
5. 进行中禁止重复提交（沿用 `dataset.saving` 与任务 409）。
6. 粘贴正文不写 URL 缓存。只服务这一次、这一份文档。

### 4.4 S4 缓存

写入：候选正文过门槛才 `writeUrlCache`。过短、空、HTTP 失败都不写。

读取：命中后若正文已低于**当前**门槛，当 miss，并删掉该 key 的 `.txt` / `.meta.json`。已有毒缓存第一次重读就会自愈。

`force: true` 的 Web/CLI 重跑必须带 `forceRefetch: true`（重新深读 / 重试 / 强制重新抓取）。`fetchUrlMaterial` 增加 `opts.forceRefetch`：为真则不读缓存。

不做 TTL。URL 正文不是 arXiv 那种不可变，但本票只修「毒缓存」，不引入过期策略。

粘贴正文永不入 URL 缓存。

## 5 思路与折衷

先换抽取器，再用门槛把「非空即成功」砍掉，再用粘贴给付费墙/残页一条人能完成的路。缓存只保证「坏结果进不去、已经进去的会在下次读时丢掉」。

放弃：付费墙分类器；jsdom；给未失败页预置粘贴；自动重写历史空产物；缓存 TTL。

保留：现有深读三态、force 去重、mutationId、SSE、#207 的折叠运行详情、#186「后一次失败不吃掉前一次产物」。

## 6 架构

```
文档页 ──POST /reads──► handleReads
                         │ pastedText? ──门槛──► 422 或 runner(paperText=paste)
                         │ forceRefetch? ──► fetchUrlMaterial({ forceRefetch })
                         ▼
                   loadSourceMaterial(requireText)
                         ▼
                   fetchUrlMaterial ── cache? ── HTTP ── readability ── legacy
                         │                         │
                         │ 过短/空：不写 cache      │ 过门槛：写 cache
                         ▼
                   失败 → PaperRead failed + 分类/长度
                   成功 → artifact FM + PaperRead read
```

主路径：抓取 → Readability → 过门槛 → 模型 → `read`。
失败路径：过短/空/HTTP → `failed` + 页面粘贴/重抓。
粘贴路径：跳过 fetch 与 cache → 同一 runner。

## 7 模块

L1 只定所有权，不写实现说明书。L2 再钉接口形状。

| 模块 | 负责 |
|---|---|
| `src/sources/url-fetch.ts` | Readability + linkedom、旧抽取兜底、门槛、cache 写入/自愈、`forceRefetch`、抽取元数据 |
| `src/pipeline/read.ts` | 把元数据带出 `SourceMaterial`；`requireText` 时门槛失败要 throw |
| `src/web/library-read.ts` | 接受可选粘贴正文；产物 FM 写 method/长度/粘贴 |
| `src/library/model.ts` + `store.ts` | `PaperRead` 增加失败分类与长度字段 |
| `src/config/global-config.ts` | 可选门槛配置 |
| `src/web/server.ts` `handleReads` | `pastedText` / `forceRefetch`；粘贴过短 422 |
| `src/web/views.ts` + `app.css` | §4.3 六态与中文文案 |
| `src/cli.ts` + `commands/library.ts` | 新增 `library read` |
| `tests/fixtures/url-extract/` | 保存的 HTML 夹具（实现阶段加入，本 PR 不提交夹具） |

## 8 API/CLI

### Web：扩展现有 POST

`POST /library/documents/:documentId/reads`

```json
{
  "force": true,
  "mutationId": "uuid",
  "forceRefetch": true,
  "pastedText": "optional full text"
}
```

规则：

| 条件 | 响应 |
|---|---|
| 缺文档 / note / video | 现有 404 / 422 |
| 忙 | 409 `busy` |
| 无 force 且已有完成读记，且无 `pastedText` | 200 复用（现有） |
| 有 `pastedText` 且过短 | **422** `{ error: "paste_too_short", chars, words, minChars, minWords, message }`。不写 reading |
| 有达标 `pastedText` | 202，开 job，跳过 fetch |
| `forceRefetch: true` | 202，fetch 跳过 cache |
| 缺 `forceRefetch` 的 `force: true` | 仍按 `forceRefetch: true` 执行（重新深读不得命中坏缓存） |

GET 读记 JSON 增加可选：`failureCode`、`extractedChars`、`extractedWords`、`extractionMethod`。`lastError` 仍在。旧记录缺这些字段时，页面只显示通用「深读失败」+ 重试 + 粘贴，不编造字数。

HTML 文档页按 §4.3 渲染。`Accept: application/json` 的 GET 文档可以仍只回文档本体；字数以 GET `/reads` 为准。

### CLI

新增，不复用 `papers read`（它只收 arXiv）：

```
researcher library read <document-id-or-url>
  --force
  --force-refetch
  --paste-file <path>
```

- 输入 URL 且文档不存在 → 先按 `library add` 入库再深读
- `--paste-file` 读 UTF-8，走与 POST `pastedText` 同一门槛与 runner
- `--paste-file -` 读 stdin
- `--force-refetch` 映射 `forceRefetch`
- 过短粘贴：进程退出码非 0，stderr 英文：`paste too short: 320 chars, 48 words`
- 成功：stderr 一行产物路径（对齐 `papers read`），stdout 可静默

`researcher read`（topic pending note）本期不接粘贴。

### 配置

`~/.researcher/config.yaml` 可选：

```yaml
urlExtract:
  minChars: 1000
  minWords: 150
```

缺省即上表。只影响本机 runner，不进 workspace 文件。

## 9 边界

- 粘贴与抓取正文都是不可信数据，继续只当模型输入。
- 动态文本转义不变。失败原因里的数字来自服务端计数，不是用户 HTML。
- 粘贴体积：沿用现有 JSON body 上限；超过现有 413。不为本票另开 multipart。
- 不改批注、topic 关联、视频分析。
- 不把 URL 缓存搬进 workspace。
- 同源写保护、`mutationId` 重放保持原样。

## 10 迁移 / 兼容 / 回滚

- 无 Library 数据迁移。新字段缺省即旧记录。
- 已标 `read` 的空产物不自动改写。用户「重新深读」后走新规则。
- 毒缓存：下次 `fetchUrlMaterial` 自愈删除。不扫全目录。
- 回滚代码即回到旧抽取；已删的毒缓存不会自动回来。
- 新依赖只在实现 PR 进 `package.json`：`@mozilla/readability`、`linkedom`。本设计 PR 不改 `src/`。

## 11 测试计划

须写 L2（见 §12）。L2 测试计划必须点名功能文件。下面是 L1 已能锁定的意图与文件名。

| Story | 功能文件 | 用户入口 |
|---|---|---|
| S1–S4 本票 | **新增** `.agents/skills/verify-researcher/features/url-extract-reread.md` | Library → 失败 URL 文档详情 → 看原因/字数 → 粘贴 → 重新深读；以及强制重抓不再命中坏缓存 |
| S3 详情层级保全 | **更新** `.agents/skills/verify-researcher/features/document-detail.md` | 在 #209 S3 失败条之外，补过短失败的中文原因、字数、粘贴区；进行中仍是一行中文 |

E2E（keel-verify / 隔离 workspace，桌面 1366×768）：

- S1：every.to 夹具强制重抓后正文 ≥ 1000 字；回归夹具长度不低于 golden。
- S2：人造过短页 → 状态深读失败、无新产物、身份不是已深读。
- S3：失败页六态可判；粘贴达标后产物可见「来源：用户粘贴」；过短粘贴 422 且无新 reading。
- S4：先造毒缓存再深读，HTTP 被调用且成功正文进产物；过短结果目录里没有新的 cache txt。

Integration：`tests/web/server.test.ts` 扩 POST `/reads`（`pastedText` / 422 / `forceRefetch`）；`tests/web/views.test.ts` 锁文案与粘贴控件；`tests/web/library-read.test.ts` 锁「过短不跑模型」。

Unit：`tests/sources/url-fetch.test.ts` 用 `tests/fixtures/url-extract/`：

- `everyto-codex-graded.html`：从 live 页保存（实现阶段抓一次，剥 script/cookie，提交静态 HTML）。断言 Readability 正文 ≥ 1000，且优于第一 `<article>` 正则。
- 至少 3 个已成功样本（建议：现有单测那种 article/main 博客；一篇 GitHub README HTML；一篇常见 docs 页）。golden：title 片段 + `minChars`。
- 人造：推荐卡片在前、真文在后的 `<article>` 页；过短页不写 cache；毒 cache 自愈。

禁止把 live every.to 写进默认 `npm test`。夹具缺失则单测失败，fail fast，不静默跳过。

## 12 开放问题（交 peng）

每条都有推荐。圈选或改口后 L1 才可 Approved。

**D1. DOM：linkedom vs jsdom**  
推荐：linkedom。理由见 §4.1。若实现时 every.to 夹具在 linkedom 上 parse 失败，再改 jsdom，不在 L1 双轨。

**D2. 门槛：或 vs 与；中文页**  
推荐：保持票面「< 1000 字 **或** < 150 词」。中文页词数常 < 150，会主要靠字数。备选：只看 `minChars`（更简单，英文短词页可能漏）。

**D3. 毒缓存**  
推荐：读时自愈删除 + 过短不写 + 重新深读默认 `forceRefetch`。不扫盘、不上 TTL。

**D4. 粘贴 API**  
推荐：扩展现有 `POST .../reads`，不新增资源。CLI 用新的 `library read --paste-file`。

**D5. 历史空读记**  
推荐：不迁移。页面继续显示那份空产物直到用户重新深读。重新深读成功后新记录为最新 `read`。

**D6. 重复「来源」**  
推荐：本票不做。身份表「来源：用户粘贴」是新行，不合并现有两行 URL。

**D7. 未深读页是否也给粘贴**  
推荐：不给。先自动抓；失败后再贴。

## 13 是否需要 L2

需要。命中 when-to-write 的 L2 条：公共 API/CLI、跨模块新存数（`PaperRead` 字段 + 产物 FM）、生产运行时依赖（`@mozilla/readability` + linkedom）。

L1 批准后、写代码前，用同一路径出 L2（可仍叫本文件，状态仍 Draft 直到 peng 批 L1；L2 补实现边界，不改已批契约）。L2 至少补：

- `UrlMaterial` / `SourceMaterial` / `PaperRead` / POST body 的字段级接口
- linkedom + Readability 的失败回退顺序（含 `parse() === null`）
- 夹具文件清单与 golden 数字
- `url-extract-reread.md` 逐步用户入口（与 S1–S4 逐条）
- `document-detail.md` 要改的具体 Drive 行

L1 已批，L2 见下文。

## 14 关联

- [#212](https://github.com/xforce-io/researcher/issues/212)
- [keel-how](212-url-extract-how.md)
- [线框](212-url-extract-readability/wireframes/)
- #207 深读三态与失败条层级
- #209 失败原因可读
- #186 后一次失败不覆盖上次产物
- `docs/superpowers/specs/2026-05-04-add-url-source-design.md`（早期 URL 设计：当时打算让 agent 自己抓；现状已是 runner 抓取）

# L2：实现边界

- 层级：**L2**
- 状态：随 L1 Approved 一并落地（peng 已批契约；Knox 四条选节点/测试规则写入本文）
- 徽标文案改动（Knox，无需再问 peng）：失败条与身份表「抽取」行写 **已回退备用抽取**，不用「已回退旧抽取」。

## L2.1 字段级接口

```ts
type HtmlExtractionMethod = 'readability' | 'dom-fallback';
type ExtractionMethod = HtmlExtractionMethod | 'pdf' | 'plain' | 'user-pasted';
type ReadFailureCode = 'extract_too_short' | 'empty_text' | 'fetch_error' | 'agent_error';

interface UrlExtractThreshold { minChars: number; minWords: number } // default 1000 / 150

interface UrlMaterial {
  title: string; text: string; contentType: string; docType: DocType; url: string;
  extractionMethod?: ExtractionMethod; bodyChars?: number; bodyWords?: number;
}

interface SourceMaterial {
  meta: ArxivMetadata; paperText: string; slugSeed: string; fetchInstruction: string; docType: DocType;
  extractionMethod?: ExtractionMethod; bodyChars?: number; bodyWords?: number;
}

interface PaperRead {
  // existing fields …
  failureCode?: ReadFailureCode;
  extractedChars?: number;
  extractedWords?: number;
  extractionMethod?: ExtractionMethod;
}

// POST /library/documents/:id/reads
interface ReadsPostBody {
  force?: boolean;
  mutationId?: string;
  forceRefetch?: boolean;   // missing + force:true ⇒ treat as true
  pastedText?: string;      // present + too short ⇒ 422, no reading row
}

interface LibraryReadRunnerOptions {
  workspaceRoot: string; paper: Paper; readId: string;
  pastedText?: string; forceRefetch?: boolean;
  // existing onLine / onEvent / topicContext …
}
```

产物 frontmatter 新增：`extraction_method`、`body_chars`、`body_words`。读记 JSON 同步这些字段。旧记录缺字段时页面不编造字数。

配置：`~/.researcher/config.yaml` → `urlExtract.minChars` / `urlExtract.minWords`。缺省 1000 / 150。只影响本机 runner。

`fetchUrlMaterial(id, { docType?, forceRefetch? })`。`forceRefetch` 为真则不读 cache。HTML 过短/空不写 cache。命中 HTML cache 若低于**当前**门槛则删 key 当 miss。

错误：`UrlExtractError`（`failureCode` + 可选长度/方式）。HTTP/网络 → `fetch_error`。模型失败 → `agent_error`。粘贴过短 CLI：`paste too short: N chars, M words`，非 0 退出。

Web 422：`{ error: "paste_too_short", chars, words, minChars, minWords, message }`，不写 reading。页面内联，不用 `alert`。

CLI：`researcher library read <document-id-or-url> [--force] [--force-refetch] [--paste-file <path>|-]`。URL 且文档不存在则先 `library add`。stdout 静默，stderr 一行产物路径。

## L2.2 抽取顺序与选节点（Knox）

顺序（HTML only；PDF / plain / X 不走门槛）：

1. linkedom `parseHTML` → `Readability.parse()`。`parse() === null` 或抛错 ⇒ 空 text，不算过门槛。
2. Readability 正文非空且 **字 ≥ minChars 且 词 ≥ minWords** ⇒ `extractionMethod=readability`。
3. 否则 DOM 回退。回退过门槛 ⇒ `dom-fallback`。
4. 两条都不过 ⇒ throw，不写读记产物、不写 URL cache。

**禁止**：生产路径正则取第一个 `<article>` / `<main>` / `<body>`。旧 `extractHtmlMainText` 已移出 `src/`，仅测试 helper 可对照。

**选节点规则（方案 b + 链接密度上限）**：

- 候选只收 `article`、`main`、`[role=main]`。**不要**把 `body` 和它们放进同一池按文本最长打分——`body` 包含 article/main，几乎永远赢，等于整页。
- 每个候选先剥 chrome，再算链接密度 = 链接文字码点数 / 可见文字码点数。`linkDensity > 0.5` 的候选丢掉。
- 在剩余且过门槛的节点里取**最深**（`elementDepth`）；同深度取更长文本，再同则文档序。
- **仅当**没有过门槛的语义候选时，才用剥过 chrome 的 `body`。body 也不和 article/main 比长度。body 也必须过门槛 **且** `linkDensity ≤ 0.5`，否则 `accepted=false`，整页抽取失败（不把过密/过短 body 当成功正文）。
- 页面同时有 `article` 和 `main`：套这条规则。嵌套时更深的赢；兄弟节点同深度则更长文本赢。夹具必须断言选中节点符合本条。

**去推荐卡只用结构信号**：

- 标签：`nav` / `aside` / `footer` / `header` / `[role=navigation]` / `[role=complementary]`。
- 再删子孙 `article|section|div` 中「至少 2 个 `<a>` 且 linkDensity > 0.5」的容器（由深到浅），避免付费墙/相关阅读块污染 body。
- **禁止**按 class/id 名关键词匹配（如 `/recommend|related|post-preview/`）。

中文词数：空白切 token；含汉字的 token 按汉字个数计词，让中文页能过 150 词。门槛仍是票面「字 < 1000 **或** 词 < 150」。

## L2.3 夹具与 golden

目录：`tests/fixtures/url-extract/`。缺夹具则单测失败，不 skip。

| 文件 | 断言 |
|---|---|
| `everyto-codex-graded.html` | 断言**实际路径**为 `readability`（本夹具实测）。正文 ≥ 1000 字，含 `blank slate` 与 `Eight Levels`。另对同一夹具跑 `extractDomFallback`：回退也不得等于第一篇 `<article class="post-preview">` 推荐卡。 |
| `blog-article.html` | title 含 `Cache design`；≥ 1000 字 |
| `github-readme.html` | title 含 `Spatiotemporal`；≥ 1000 字 |
| `docs-page.html` | title 含 `API Overview`；≥ 1000 字 |

合成页（可写在测试里）：

1. Readability 不过门槛、DOM 回退过门槛 → 写读记，`extractor=dom-fallback`。`tests/sources/url-extract-fallback-path.test.ts` 与 `tests/web/url-extract-runner.test.ts` stub `Readability.parse()` 为短正文（真实 Readability 只要页面里有过门槛语义节点几乎总会赢，无法稳定构造「主路径短、回退长」）；回退选节点与写读记仍走生产代码。
2. 两条都不过 → 失败态，不写读记产物、不写 cache。
3. 同时有 `article` 与 `main` → 选中节点符合 L2.2：嵌套取更深；同深度取更长文本。另断言：有过门槛的 `article` 时不得改选更长的 `body`。

功能文件：`.agents/skills/verify-researcher/features/url-extract-reread.md`（S1–S4 用户入口）。`document-detail.md` 增 #212 S3 行：过短失败中文原因/字数/粘贴区；进行中粘贴 disabled；成功「正文来源」与「已回退备用抽取」。

冒烟：`scripts/smoke-212-url-extract.mjs`。独立 clone 里 `npm ci && npm run build` 后可跑。`--cache-dir` 或 `RESEARCHER_HOME` 指向临时缓存。目标 Node：**v23.11.0**（Mac :4500 同版本）。

依赖：`@mozilla/readability` ^0.6.0 Apache-2.0；`linkedom` ^0.18.13 ISC。进 lockfile。
