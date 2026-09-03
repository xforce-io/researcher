# researcher

> [English →](./README.md)

按主题划分的研究 CLI。把一个 git 仓库变成一本"活的"研究笔记：吸收论文、维护
工作论题、维护研究 landscape 文档与论题驱动的 `report.md`，每次更新都开一条 PR ——
让人通过 diff review 始终留在闭环里。

单个主题是原子。多个主题可以组合成一个多支柱**工作区** —— 一个从单一根目录
统一推进、并可用 `researcher serve` 浏览的超级仓，详见[工作区模式](#工作区模式多支柱)。

CLI 自身不调用任何 LLM。它把方法论和项目上下文拼成 prompt，交给一个无头的
milkie agent 运行时。所有持久化状态 ——
论题、笔记、landscape、report、已读集合 —— 都以纯文本文件、Git 版本化的方式
存在主题仓库里。

## 为什么是它

绝大多数"AI 文献综述"工具都在为"广度"做优化：列论文、聚类、做摘要。这个工具
是为"逐步打磨论题"做优化的。`.researcher/thesis.md` 里的工作论题就是 spec；
每读一篇论文都被强制要么强化它、要么细化它、要么反驳它；其余产物
（`report.md`、landscape、单篇笔记）的存在意义是让这份论题**可被挑战**，
而不是为了文献综述本身。

每次 tick 会把新论文与你的 thesis 或既有笔记之间的矛盾挑出来——这份矛盾报告
通常才是**真正发生思考的地方**，而不是单篇摘要。闭环的关键是 thesis 会被读进
每次 triage 的 prompt：thesis 越锋利，下一轮被深读的论文也跟着变。

你通过审 PR diff 留在闭环里，而不是和某个 agent 不停聊。

## 示例

作者目前正在用本工具维护的两个 topic 仓库（均公开）；想直观看工具实际产物，
最直接的入口是各自的 `report.md`：

- **[research-agent-triage](https://github.com/xforce-io/research-agent-triage/blob/main/report.md)** — 生产 agent 轨迹分诊
- **[research-agent-decision](https://github.com/xforce-io/research-agent-decision/blob/main/report.md)** — KWeaver 决策 agent 层

……以及把这些支柱缝合到一起、从单一根目录推进的**工作区**（见[工作区模式](#工作区模式多支柱)）：

- **[research-harness](https://github.com/xforce-io/research-harness)** — 多支柱超级仓（trace / decision / data）

## 当前状态

已实现：
- `init` —— 在仓库里搭好 `.researcher/`
- `onboard` —— 交互式 TUI，引导你写出 `project.yaml` + `thesis.md`
- `add <arxiv-id | arxiv-url | http(s)-url>` —— 手动把一篇论文或网络来源端到端深读完
- `run` —— 自动 tick：discover → triage →（挑一篇）深读 → synthesize → package
- `methodology install / show / edit` —— 管理可移植的方法论包
- `serve [path]` —— 在工作区超级仓上启动本地 web 控制台（Home / Library / Topics）
- `papers trending | search | show | read` —— 热榜 / 查篇 / 写入 default workspace Library 的深读（agent 用 JSON；`skills/papers/SKILL.md`）

尚未接入：focused-instruction 模式（手动覆盖 triage 决策）。

## 安装

```sh
npm install
npm run build
npm link        # 暴露 `researcher` 命令
researcher methodology install   # 一次性，把方法论装到 ~/.researcher/methodology
```

依赖：
- `PATH` 上有 `milkie` CLI（agent 运行时）。可用 `RESEARCHER_MILKIE_BIN` 覆盖。
- 已认证的 `gh` CLI —— 仅当主题设置 `delivery.mode: remote` 时需要（用于
  `git push` + `gh pr create`）。主题默认本地（只 commit），纯本地仓库无需
  remote 也无需 `gh`。
- `pdftotext`（poppler）做 PDF 抽取。缺失时会回退到 abstract。
- 可选：`PATH` 上的 `pwc` CLI（[pwc-cli](https://github.com/huggingface/pwc-cli)）——宿主在 discover 阶段用 `pwc search --json` 预置候选。缺失时 collect 行为与原来一致（软降级）。

## 快速开始

在一个全新的、用于该研究主题的 git 仓库里：

```sh
git init
researcher onboard      # 6 题 TUI → 草拟出 project.yaml + thesis.md
researcher run          # 自动 tick：发现、triage、深读一篇、synthesize、开 PR
```

`onboard` 会问 6 个问题（2 必答 4 可选），用 agent 运行时把你的回答改写进
`.researcher/project.yaml` 和 `.researcher/thesis.md`，给你看 diff 确认，
然后做 initial commit。

`run` 是主要的自动化循环。每一次 tick：
1. 从 `project.yaml` 的 sources 里发现候选论文，
2. 用当前论题对它们做 triage，
3. 至多挑一篇做深读，
4. 产出 / 更新单篇笔记、landscape、`report.md`，
5. 提交到 `researcher/<run-id>` 分支并开一条 draft PR。

如果你更喜欢手工接线：

```sh
git init
researcher init                      # 用模板搭好 .researcher/
# 编辑 .researcher/project.yaml      —— 研究问题、来源、范围
# 编辑 .researcher/thesis.md         —— 你的工作假设
researcher add 2401.12345            # 也可以：researcher add https://arxiv.org/abs/2401.12345
```

`add` 走完 4 个阶段 —— bootstrap → read → synthesize → package ——
然后建一个 `researcher/<run-id>` 分支，分两个 commit（笔记 + landscape，
然后 state 更新），最后开一条 draft PR。

### 扩展到工作区

单个主题是原子。当一个计划需要并行研究多个**支柱**（每个有自己收窄的论题）时，
把它们组合成一个**工作区**超级仓，用一条 `researcher run` 从单一根目录统一推进，
再用 `researcher serve` 在本地 web 控制台里浏览。完整搭建见[工作区模式](#工作区模式多支柱)。

## 目录结构

```
<topic-repo>/
├── .researcher/
│   ├── project.yaml             # 结构化的"项目灵魂"
│   ├── thesis.md                # 工作假设（人类编辑；它是 spec）
│   └── state/
│       ├── seen.jsonl           # 去重账本（提交）
│       ├── watermark.json       # 上次运行的水位线（提交）
│       └── runs/<id>/           # 本地阶段日志（gitignore）
├── notes/
│   ├── 00_research_landscape.md # 活的综述，结构上 append-only
│   ├── 01_<slug>.md             # 单篇笔记（claims / weaknesses / …）
│   └── 02_<slug>.md
├── papers/                      # 下载的 PDF + papers/README.md 索引
├── references/                  # 可选：托住论题的产品 / 设计文档
├── report.md                    # 论题驱动的论据装置，每次运行都重新组织
└── README.md                    # 工作坊式的策展：论题摘要 + 论文表格
```

`thesis.md` 是 spec。`report.md` 是它的工作实现 —— 每个 section 都锚在
某条论题主张、设计目标或可证伪点上，**绝不**锚在"每篇论文讲了什么"上。
见 `methodology/06-writing.md`。

## 工作区模式（多支柱）

单一收窄的论题是一个主题的正确粒度。当一个更大的计划需要并行研究多个**支柱**
（每个支柱有自己收窄的论题、各自独立深耕）时，用一个 **super-repo**（超级仓）
通过 git submodule 把它们缝合起来，从单一根目录统一推进。

### 两份 spec，两种范围

- **research spec** = `thesis.md` —— 单个支柱收窄的主张；驱动该支柱的
  triage / read / synthesize。
- **anchor** = `CHARTER.md`（超级仓）—— 跨**所有**支柱共享的不变量。每次运行前
  把它的切片（共享核心 + 该支柱的摘录）写入支柱只读的 `.researcher/charter.md`。
  漂移会以 `## Charter tension` 浮现，供你**双向**裁决：是支柱漂了，还是
  CHARTER 本身该改。

一句话：**thesis 管单个支柱往哪里收窄；CHARTER 管支柱之间不互相漂移。**

### 超级仓结构

```
<super-repo>/
├── CHARTER.md                 # 共享 anchor：北极星 + 支柱图/不变量 + 各支柱摘录
├── researcher.workspace.yml   # 控制面板：topics + active/dormant
├── docs/                      # 人类维护的集成笔记（researcher 不读）
└── <pillar>/                  # 每个 = 一个独立 topic 仓（git submodule）
```

> `researcher` 只读超级仓的**两个**文件：`researcher.workspace.yml`（跑哪些支柱）
> 和 `CHARTER.md`（切片成各支柱的 anchor）。其余一切都给人看。

### 快速开始 B —— 立一个工作区

```sh
# 1. 建超级仓
mkdir my-research && cd my-research && git init
cp <researcher>/templates/CHARTER.md CHARTER.md   # 然后编辑：北极星、不变量、摘录

# 2. 以 submodule 加入一个支柱（每个支柱是独立 topic 仓）
git submodule add <pillar-repo-url> trace
( cd trace && researcher init && researcher onboard )

# 3. 在控制面板登记
cat > researcher.workspace.yml <<'YML'
version: 1
topics:
  - { path: trace, active: true }
YML

# 4. 从超级仓根目录推进所有 active 支柱
researcher run
```

每个 active 支柱推进一个 tick（先同步 charter）并在各自的 submodule 仓开自己的
PR。Dormant（`active: false`）支柱完全不碰。某个支柱失败不会中断其余 ——
错误会汇总在 summary 里。

### `researcher workspace sync` / `publish`

显式把 workspace 与 GitHub 对齐，**不**改 `run` 默认行为，也**不**依赖
`delivery.mode`（投递仍只管 package 是否 push+PR）。

```bash
# 默认：对 active topics 做 fetch + ff-only pull（有 origin 的）
researcher workspace sync
researcher workspace sync --pull --push-topics --pointers --library
researcher workspace sync --library
researcher workspace sync --all --dry-run

# 本地 pillar 晋升（manifest 必须显式 publish: true）
# 人工 TTY：先展示计划再确认
researcher workspace publish world-model --remote git@github.com:org/world-model.git

# CI/agent：仍须 allowlist，并显式确认
researcher workspace publish world-model \
  --remote git@github.com:org/world-model.git \
  --yes
```

Manifest 放行（默认关闭）：

```yaml
topics:
  - path: world-model
    active: true
    publish: true
```

- `--pull`：有 origin 则 ff；无 origin / 非 git → skipped 或 failed
- `--push-topics`：推送当前分支到 origin（不开 PR）
- `--pointers`：仅 bump 已是 submodule 的 gitlink，并在 super-repo 打一次 commit
- `--library`：把允许的 Library 账本与 `reads/*.md` commit 进超级仓（不开 PR、不 push）；不含 PDF
- `publish`：默认关闭；仅 `publish: true` 的 topic 可加 origin、push、写 `.gitmodules` + gitlink
- `--yes`：仅跳过人工确认，不能绕过 topic allowlist
- `--dry-run`：无写副作用；未授权时输出 `blocked: publish not enabled`
- 单 topic 失败不中止其余；存在 failed 时 exit 1

详见 `docs/design/130-workspace-sync.md`、`docs/design/173-library-workspace-sync.md`。

### `researcher serve [path]`

在工作区超级仓（含 `researcher.workspace.yml` 的目录）上启动本地 web 控制台。
只绑定 `127.0.0.1`、无鉴权。

```bash
researcher serve                 # 在当前超级仓上以 :4500 启动
researcher serve ../research -p 8080
```

主要界面（以 workspace 为中心）：

| 路由 | 作用 |
|---|---|
| `/` | Workspace Home：健康度、Needs attention、topic 预览、Library 快照 |
| `/topics` | Topic 卡片列表 + **New topic**（本地 scaffold 并登记到 workspace）；进入 `/t/:slug` 看 thesis / landscape / report / 笔记，**Complete setup**（AI 草案），并可触发 per-topic `run` |
| `/library` | 论文入库列表（筛选、Add paper） |
| `/library/p/:id` | 论文详情：机器 deep-read 产物 + **纸本本地 Notes**（Markdown、钉选/删除）；Deep read / **Topic link**（启发式 Suggest 只填表单；仅 **Link topic** 写盘） |

**双轨（Library vs Topic）：** Library 精读与 paper notes 是中立、可复用的证据与注意力；
Topic 侧仍是 thesis 驱动的综合。把论文 link 进 topic 是显式接合，notes 不会自动改写支柱。

Library 精读首屏是 **`## Essence`**（问题 / 做法 / 证据 / 边界），不再用摘要腔 Brief。
旧产物若仍是 `## Brief`，显示时落在同一槽位。详见 `docs/design/98-essence-replaces-brief.md`。

Notes 存在 `.researcher-workspace/library/notes.jsonl`，force 重跑机器精读不会清掉。
详见 `docs/design/89-paper-local-notes.md`。

`path` 必须指向**工作区超级仓**（含 `researcher.workspace.yml` 的目录），不是
`researcher` 工具自身的源码仓 —— 后者没有清单文件，会直接报错。

## 命令

| 命令 | 作用 |
|---|---|
| `researcher init` | 在仓库根目录搭出 `.researcher/` |
| `researcher onboard` | 交互式 TUI，草拟 `project.yaml` + `thesis.md` |
| `researcher add <arxiv-id\|url>` | 端到端深读一篇论文（4 阶段 pipeline） |
| `researcher run` | 自动 tick：discover + triage +（深读）+ synthesize + package |
| `researcher methodology install` | 把方法论文件装到 `~/.researcher/` |
| `researcher methodology show` | 打印当前已装的方法论 |
| `researcher methodology edit <name>` | 用 `$EDITOR` 打开某个方法论文件 |
| `researcher serve [path]` | 本地 web 控制台：Home、Library（精读 + paper notes）、Topics + run |
| `researcher workspace sync` | 超级仓：pull / push topics / bump pointers / commit Library（显式；与 delivery 正交） |
| `researcher workspace publish <path>` | 把已 allowlist 的本地 pillar 晋升为带 origin 的 submodule（非交互需 `--yes`） |
| `researcher version` | 打印版本 |

## 环境变量

- `RESEARCHER_MILKIE_BIN` —— 当 `milkie` 不在 `PATH` 上时指定路径。
- `RESEARCHER_MILKIE_AGENT` —— 要运行的 milkie agent id，默认 `researcher`。

投递方式（push + PR 还是只本地 commit）是 per-topic 的，通过 `.researcher/project.yaml`
的 `delivery.mode`（默认 `local`，或 `remote`）设置 —— 不再用环境变量。

## 方法论

七条纪律，以可移植的 markdown 形式活在本仓库的 `methodology/` 下：

1. `01-reading.md` —— 怎么读一篇论文（claims / 机制 / weaknesses）
2. `02-source.md` —— signal 从哪里来
3. `03-filtering.md` —— 用论题做 triage
4. `04-synthesis.md` —— 图状 landscape + supersedes / contradiction 关系
5. `05-verification.md` —— 可证伪性纪律
6. `06-writing.md` —— 工作坊式策展、论题驱动的 `report.md`
7. `07-cadence.md` —— 何时跑、何时停、何时改论题

`onboarding.md` 定义了 6 题的 intake。

`researcher methodology install` 把这些复制到 `~/.researcher/methodology/`，
让方法论包在多个主题之间共享。用 `researcher methodology edit <name>` 来改。
完整设计见 `docs/superpowers/specs/2026-04-26-researcher-cli-design.md`。

## 开发

```sh
npm test          # vitest，跑一次
npm run test:watch
npm run lint
npm run format
```

主题仓库的集成测试在 `tests/pipeline/` 下，用 `os.tmpdir()` 里的真 git
配合 stub 化的 agent 运行时跑。
