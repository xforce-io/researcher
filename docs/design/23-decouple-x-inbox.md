# 23 · x-inbox 去 Twitter 化:feed 路径收敛为来源无关的通用 digest 综合

> **状态: Superseded** — feed / x-inbox 产品面已由 #148 从 researcher 删除。见 `docs/design/148-remove-x-inbox.md`。
>
> Epic(跨仓 B)。串起 `researcher`(引擎去耦)与 `researcher-invest-feeds`(富化,后续)。
> Issue: researcher#23 · 关联已交付的 researcher#21(x-inbox 源)。

## 背景 / 问题

`#21` 给 researcher 侧挂了一条 feed 流水线(`x-inbox` 源 → `feed-synthesize` → `package`),
消费 `researcher-invest-feeds` 投递到 inbox 的 digest。落地后暴露两类问题:

1. **报告偏短**:invest 项目的 `report.md` 即使消费了很多博文也写得很短。
2. **设计味道**:Twitter/推文的概念渗进了 researcher *引擎核心*,而非"只是一种 source"。

诊断后把"短"拆成两个**独立**的因,分属不同盒子:

| 症状 | 根因 | 盒子 |
|---|---|---|
| 每窗口笔记内容浅(只有生推文,没展开) | digest 是生文本,未深挖 | researcher-invest-feeds(上游) |
| `report.md` 被压扁(料多也写得短) | `feed-synthesize` 指令:"not a per-window log" + surgical + 无 paper 线的重建机制 | researcher(引擎) |

## 关键发现(修正了初版分工)

- **`researcher-invest-feeds` 是纯数据源,charter 明确"不做分析、不调 LLM"**(见其 README)。
  因此"把 deep-research/LLM 富化塞进 feeds"是错的,违反其 charter。LLM 深挖若要做,只能落在
  researcher,或作为 feeds 的**非 LLM** 链接抓取(纯 HTTP)。
- **`kind: x-inbox` 与 digest 的 `source: x-following` 不是泄漏**:它们是合法的"按来源命名",
  与 `arxiv`/`rss`/`github` 同理。真正的泄漏在 **researcher 的 prompt 把通用的"批量短信号"
  写成了 Twitter 语义**(tweet / @handle / status URL / social posts / x-following)。
- "批量短信号 vs 单篇深文档"是一个**真实的通用维度**(newsletter / Slack / RSS digest 同形),
  值得有第二种综合模式 —— 该模式本身合理,只是被贴上了 Twitter 标签。

## 目标分工

| 维度 | researcher-invest-feeds | researcher |
|---|---|---|
| X 拉取 / 过滤 / digest 格式 | ✅ 全在这(合法的 Twitter 源) | ❌ 一无所知 |
| 去 Twitter 化 prompt + 笔记命名 | ❌ | ✅ **本期** |
| 深挖 / 抓链接富化 | ⏸ 后续(仅非 LLM;待 base fetcher 跑通真实 X) | ⏸ 后续(若要 LLM 深读,作为 digest 路径的 enrich/read 阶段) |
| `report.md` 更长 | 间接(喂厚料) | ⏸ 后续(本期不动 report.md) |

## 本期范围(researcher,#23 主体)

去 Twitter 化引擎,使 feed 路径对来源无感。改动收敛在两处,**不动 `report.md` 行为、不改
`x-inbox` 源名、不改 digest 契约**:

1. **`prompts/stage-feed-synthesize.md`**:把 Twitter 专有词(tweet / @handle / status URL /
   social posts / x-following / "trusted accounts" / per-tweet triage)改写为通用的"来自可信
   来源的 feed 条目";每个 section header 描述为"承载 source byline、时间戳、链接"的通用形状;
   引用从 `[@handle](status-url)` 泛化为"内联链接到该条目"。语义不变,只去标签。
2. **`src/pipeline/feed_synthesize.ts`**:笔记文件名从硬编码 `NN_x-following-<date>.md` 改为
   从 `ctx.feedDigest.meta.source` 派生 slug(`NN_<source-slug>-<date>.md`)。当前数据
   `source: x-following` → 结果不变(`01_x-following-…`),但任何 source 都能正确流过。
   slug 逻辑抽为可单测的纯函数。

### 验收

- `tests/commands/run_feed.test.ts` 既有断言(`\d+_x-following-…`)继续通过(向后兼容)。
- 新增 slug 纯函数单测:非 Twitter source(如 `substack`)派生出对应笔记名。
- prompt 不再含 Twitter 专有词(人工 review + 既有 run_feed 端到端通过)。

## 显式 deferred(各自独立 issue,不在本期)

- **feeds 富化**(researcher-invest-feeds child issue):仅限非 LLM 的链接展开 / 抓取被引用原文,
  且**前置条件**是 base fetcher 已对真实 X 验证。当前 sample 多为无外链短评,价值待数据确认。
- **researcher 侧 LLM 深读**:若要真正的"逐条声明检索+验证",作为 digest 路径的 enrich/read 阶段,
  成本/频率模型需另行设计(feed 当初设计为单次调用以支持高频低成本消费)。
- **`report.md` 加长**:补 paper 线的 restructure 机制或放宽压缩约束 —— 本期明确不动。
- **`kind` 改名**:`x-inbox` → 更中性(如 `digest-inbox`)是可选清洁项,跨 `project.yaml` 改动面较大,
  暂不做。

## 关联

- 已交付:researcher#21(x-inbox 源)· PR #22(merged)
- 上游仓:`researcher-invest-feeds`(charter:纯数据源,不调 LLM)
- 实际项目工作区:`research-invest`(report.md / notes / README 在此)
