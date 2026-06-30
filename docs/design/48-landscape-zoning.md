# 48 · landscape/notes 分区熵减:三区 + 每 PR rebalance

> Issue: researcher#48
> 状态:设计已批准(经 brainstorming 收敛),待实施计划。
> 分支:`feat/48-landscape-zoning`

## 背景 / 问题

深读论文单调累积,而**领域在演进、焦点在漂移**。当前两个产物对此的应对能力不对称:

| 产物 | 现状 | 聚焦能力 |
|---|---|---|
| `report.md` | thesis 驱动,失配时 Step B 自我重建 | ✅ 有 |
| `notes/00_research_landscape.md` | 结构锁死、只增不减(supersede 仅打标签不下沉) | ❌ 无 |
| `notes/NN_*.md` | 平铺、不可变证据单元 | ❌ 无 |

后果:landscape 体量单调膨胀;且每 tick 把**整份** landscape 喂进 `discover`/`synthesize` 的 prompt,既涨 context 成本,又用陈年/无关条目稀释模型注意力。

**目标 = 熵减**:系统随焦点自动"重新归心" —— 当前相关的浮上来、陈年的下沉;且因领域会回摆,下沉的能重新浮回,而非单向按时间归档。

## 已批准的设计取舍

| 维度 | 决定 | 理由 |
|---|---|---|
| 排名形态 | **方案 B**:机械复合分预算 + LLM 只裁决边界 | 稳定/可审计/省 token,且保留语义"相关度"——焦点漂移的核心信号 |
| 触发时机 | **每次 package** | 用户选定;省去阈值/计数器,直接挂进既有流程 |
| 阶段位置 | rebalance 置于 **synthesize 之前** | zone 是 synthesize 写内容的**输入**;且 synthesize 既有写动作顺手吸收链接重写 |
| notes 分区 | **物理目录** `notes/active|buffer|history/` | 用户选定:人翻目录即可分清 |
| pin | note **frontmatter `pin` 字段** | 与 zone 同处、就近可见 |
| 防抖 | **滞回(hysteresis)** | 每 PR 全库重排易抖,需余量/驻留约束压制 |
| 两条路径 | paper PR 与 feed 窗口提交**都触发** | 行为一致 |

## 数据模型

### note frontmatter(新增约定)

notes 现在**没有** YAML frontmatter(开头即 H1)。本期在每篇 `notes/NN_*.md` 的 H1 **之上**引入最小 frontmatter,不干扰按 `## ` 标题扫描的综合逻辑、也不进入 landscape:

```yaml
---
zone: active        # active | buffer | history —— 单一事实源
pin: false          # true 时 rebalance 永不移动它
score: 0.42         # 上次复合分(信息性/可审计,人可忽略)
zone_since: r-20260630-...   # 进入当前 zone 的 run id(滞回驻留判定用)
---
```

- 新笔记由 `read` 阶段诞生于 `zone: active, pin: false`。
- `score`/`zone_since` 由 rebalance 维护;`zone`/`pin` 是 rebalance 与人共同可写,但**人写 `pin: true` 后机器不得覆盖移动**。

### 三区语义

| zone | 含义 | 在 report | 在 landscape | 喂进 prompt |
|---|---|---|---|---|
| `active` | 当前焦点、承重 | 主线分析 | 重点位 | 全文 |
| `buffer` | 仍相关、非前线 | 轻量提及/按需 | 次级位 | 全文 |
| `history` | 已离开当前焦点 | 附录(superseded 同处) | 归档子列表 | **仅紧凑单行索引** |

> "喂进 prompt"列即熵减的兑现:`discover`/`synthesize` 把 active+buffer 全文给模型,history 压成单行,context 不随语料单调膨胀。

### 目录布局

```
notes/
  00_research_landscape.md      # 索引,留在顶层,不参与分区
  active/   07_foo.md  …
  buffer/   03_bar.md  …
  history/  01_baz.md  …
```

**编号 `NN_` 即身份**:move 只改位置,**绝不重编号**;`[N]` 引用按编号解析,跨目录不受影响。

## 排名:机械分 + LLM 边界裁决

### 机械信号(runner 廉价预算,确定性)

- **热度 heat**:全库 `[N]` 对该 note 的引用计数(grep landscape + report + 其他 notes)。
- **时间衰减 recency**:自该 note 被加入或最近一次被引用以来经过的 run 数。
- **活跃度 activity**:是否被最近 K 个 run/新笔记关联。
- **supersede 标记**:landscape 中带 `(superseded by [N])` 的强制 history 候选。

机械层先给**临时档**:supersede'd 且低热 → history 候选;高热或近期被引 → active;其余落 buffer(即"边界")。

### LLM 边界裁决(rebalance 阶段,小 prompt)

只对**边界候选**(机械档落在 buffer、或临界、或 supersede 但仍高热的矛盾项)调一次 LLM,结合**当前 thesis** 判定相关度,输出最终 zone。非边界项直接采用机械档,不进 LLM —— 省 token。

### 熵减的强制杠杆:`active` 软上限

核心知减少 context 的旋钮是 **`active` 区目标上限**(`zoning.active_max`)。active 超限时,把**未 pin、分数最低**的 active 压到 buffer;buffer 超限同理压到 history。这把"领域在长大"翻译成"焦点保持小而清"。

### 滞回防抖

note 只有在**同时满足**才移动:① 未 pin;② 目标 zone ≠ 当前 zone;③ 已在当前 zone 驻留 ≥ `zoning.min_dwell` 个 run,**或**信号余量超过阈值 `margin`。避免 active⇄buffer 反复横跳与 git diff 噪声。

### 配置(`project.yaml`,最小面)

```yaml
zoning:
  active_max: 12      # active 软上限,超限压低分者入 buffer
  buffer_max: 30      # buffer 软上限,超限压入 history
  min_dwell: 2        # 滞回:换区前在当前 zone 至少驻留几个 run
```

缺省即开启;不写则用上列默认。`pin` 不受上限影响。

## 流水线

```
discover → read → rebalance → synthesize → package
```

**为什么 rebalance 在 synthesize 之前**(而非"包含"或"之后"):

- zone 是 synthesize 写内容的**输入**:`active`→report 主线/landscape 重点位,`history`→report 附录/轻量位。"这篇属于哪区"必须先于"怎么写它"。
- **之后**:synthesize 已把某篇当 active 写进主线,rebalance 才判 history → 内容与分区打架、需返工。最差。
- **包含**:省一次 LLM 调用,但 synthesize 职责爆炸(语义分区+机械分+git mv+链接重写+内容整合搅一锅),难测。
- **之前**:rebalance 只做"机械分 + LLM 边界裁决 + `git mv` + 改 frontmatter zone";紧接着的 synthesize **本就要重写** landscape/report/README,顺手发出移动后的正确路径链接 —— **故不需要单独的链接重写引擎**。zone 成为干净单向数据流:`rebalance 定区 → synthesize 按区写`。代价仅每 PR 一次(很小的)边界 LLM 调用。

### rebalance 阶段 I/O

- **输入**:当前 thesis、全库 notes 的 frontmatter(zone/pin/score/zone_since)、机械信号、`zoning.*` 配置。
- **动作**:算分 → 边界 LLM 裁决 → 应用滞回与软上限 → 对要换区者 `git mv` 到目标子目录 + 更新其 frontmatter(`zone`/`score`/`zone_since`)。
- **输出**:写 `rebalance-summary.md` 到 run 目录(移动了哪些、为何),供 package 写进 PR body / 审计。
- **不动**:note 正文(仅移动 + 改 frontmatter)、landscape、report、README(那些由其后 synthesize 统一重写)。

## 受影响的代码面(细节留给实施计划)

1. **`src/pipeline/read.ts`**:新笔记写入 `notes/active/`;编号扫描从顶层平扫改为**跨 `active|buffer|history` 子目录递归**;新笔记落地即带 frontmatter(`zone: active`)。
2. **`prompts/stage-read.md` + `methodology/01-reading.md`**:把 frontmatter(zone/pin)纳入笔记模板约定。
3. **新增 `src/pipeline/rebalance.ts` + `prompts/stage-rebalance.md`**:阶段实现与边界裁决 prompt。
4. **`src/pipeline/synthesize.ts` + `prompts/stage-synthesize.md`**:按 zone 渲染(active→主线、history→附录/紧凑);写文件时发出移动后的正确路径链接;`discover`/`synthesize` 上下文按 zone 取(history 仅单行索引)。
5. **`src/pipeline/discover_triage.ts`**:喂入的 landscape 按 zone 取(熵减兑现)。
6. **`src/pipeline/package.ts`(最棘手)**:`allowedPrefixes`、`candidatePaths`、以及 **snapshot→从 main 建分支→restore** 那段必须感知子目录与"删旧路径+建新路径"的移动;commit 要包含 `git mv` 的两端。这是本期最大风险点。
7. **`src/pipeline/package_feed.ts`**:feed 路径同样在每次窗口提交前触发 rebalance。
8. **`src/config/project-yaml.ts`**:解析 `zoning.*`。
9. **`src/pipeline/context.ts` / runner plan**:`rebalance` 进 `Stage` 类型与 emit 的 plan 列表;`ctx.newNoteFilename` 相关消费点改为 zone 感知路径。

## 边界情形

- **首跑/空库**:无 notes 时 rebalance 空转直通。
- **landscape 索引**:`00_*` 永不分区、留顶层。
- **supersede 与 zone**:supersede 是 history 的强候选,但若被取代者仍高热,交 LLM 裁决,不强压。
- **人手动改 zone/pin**:人写的 `pin: true` 机器必守;人手动改 `zone` 视为一次外部输入,下次 rebalance 在其基础上按滞回演进。
- **`[N]` 引用完整性**:move 不改编号,引用恒成立;迁移后由 synthesize 校正**路径型**链接(report 头部、README 表格)。

## 验收

- 单测:机械分纯函数(heat/recency 计算)、滞回判定纯函数、`active_max` 压降逻辑、编号跨子目录递归扫描。
- 集成:一条多论文序列跑下来,active 不超 `active_max`;低相关老论文被压入 buffer/history;pin 的论文恒不动;`[N]` 引用全程不断。
- 回归:既有 `run`/`run_feed` 端到端通过;report 的 `[1]…[N]` 仍全引用;无平行旧 spine 残留。
- prompt 审计:history 仅以单行进入 discover/synthesize 上下文。

## 显式 deferred

- **跨 note frontmatter 的回填迁移工具**(给已有真实工作区的老 notes 补 frontmatter + 初始分区):单独小工具,不在本期引擎改动内。
- **zone 可视化**(web console 里按区展示):#31 web-console 的后续,不在本期。
- **更复杂的排名学习**(权重自适应):本期用固定可配置阈值,不做学习。

## 关联

- Issue: researcher#48
- 触及现有不变量:reading 模板(`methodology/01-reading.md`)、synthesize 约束(`prompts/stage-synthesize.md`)、package 分支编排(`src/pipeline/package.ts`)。
- 相关:#23(feed 路径)、#31(web console,后续可视化承接)。
