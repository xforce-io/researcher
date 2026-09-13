# Library 文档的 topic 关联

Web 控制台 + `researcher run`。关联对 paper、自主笔记、视频都是文档级能力；本文件只管后两类，paper 的面板由 #97 既有范围覆盖。

## 用户入口（必须都走）

1. **笔记详情 Topic link 面板**：Select topic → Why(可选) → `Link topic`；已关联后主按钮为 `Link another topic`。
2. **笔记/视频详情 Linked topics 行**：`Edit`（改 rationale 后 `Update`）与 `Unlink`（confirm 后生效）。
3. **视频详情 Topic link 面板**：位置在页头 Analyze/状态之下，**不在** `.video-workbench` 双栏内；媒体缺失时面板仍可用。
4. **Topic 页 Related papers**：列出已关联的笔记与视频，不只列 paper。
5. **`researcher run`（discover 关闭）**：从 linked 队列取文档做集成；缺集成来源的文档被列出并保留在队列里。
6. **CLI `researcher library link` / `unlink`**：接受任意 documentId，不再只收 paper id。

只走 API 不点按钮，或只点按钮不跑 Run，都算未完成。

## 夹具

- 秒级、含清晰语音的 mp4（同 [library-video-analyze.md](./library-video-analyze.md)）。
- workspace 至少 2 个 topic，且两者 `topic_oneline` / `thesis.md` 措辞可区分，否则推荐无法判定是否只取 ≤3 条。
- 至少 1 条有正文的自主笔记。

## #197 S1

前置：Library 已有 1 条自主笔记；workspace ≥2 topic。

打开笔记详情 → 面板选 topic → `Link topic` → 刷新详情 → 打开该 topic 页。详情出现 `Linked topics` 且列出该 topic；topic 页 Related papers 列出这条笔记。

判定：`links.jsonl` 中该 documentId 恰 1 行；documentId 不变。

## #197 S2

前置：Library 已有 1 条已分析出台词的视频。

打开视频详情 → 面板选 topic → `Link topic` → 刷新 → 打开 topic 页。关联可见；播放器、台词列表、搜索仍可用；台词与媒体不变。

判定：关联前后 `media.sha256` 与当前台词逐字相等；面板在 DOM 中位于 `.video-workbench` **之前**；Library 仍 1 条该视频。

## #197 S3

前置：笔记有正文、视频有台词。

分别打开两者详情看 Suggest 区 → 点一条推荐。点击只把该 topic 填进表单并给出提示，**不写入关联**；需再点主按钮才生效。

判定：推荐条数 ≤3；点击后 `links.jsonl` 不变；提交后才新增 1 行。已关联 ≥2 或已集成时 Suggest 不出现。

## #197 S4

前置：一条自主笔记已关联 1 个 topic。

再关联第 2 个 topic → 对第 1 个点 `Unlink` 并确认。两步后详情与两个 topic 页的状态都与操作一致。

判定：最终该 documentId 只剩 1 行关联；既有集成记录不因 unlink 消失。

## #197 S5

前置：某 topic 已关联 1 条有台词的视频且未集成；discover 关闭。

对该 topic 跑一次 `researcher run` → 再跑一次。第一次把视频集成为该 topic 的一篇 note，正文取自台词（含 `[m:ss]` 时间戳，有中文台词时附在原文下方），不含深读产物标记；第二次不再取同一条。

判定：集成 note 新增 1 篇，第二次新增 0 篇且 outcome 为 `all-integrated`；`seen.jsonl` 不含该 documentId。

## #197 S6

前置：某 topic 关联了一条尚未分析、没有台词的视频。

对该 topic 跑一次 `researcher run`。不产出集成 note；输出里逐条列出被held back 的 documentId 与原因（缺台词）；队列里其它可集成文档不受影响。

判定：集成 note 新增 0 篇；outcome 为 `blocked-queue`；`integrations` 无新增。

## 不做

paper 面板的行为变更、文档批注、给笔记/视频做深读、批量关联、推荐的 LLM 排序、删除/归档这两类文档。
