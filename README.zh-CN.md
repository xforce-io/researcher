# researcher

> [English →](./README.md)

按主题划分的研究 CLI。把一个 git 仓库变成一本"活的"研究笔记：吸收论文、维护
工作论题、维护研究 landscape 文档与论题驱动的 `report.md`，每次更新都开一条 PR ——
让人通过 diff review 始终留在闭环里。

CLI 自身不调用任何 LLM。它把方法论和项目上下文拼成 prompt，交给一个无头的
agent 运行时（当前是 Claude Code，预留了 Codex 槽位）。所有持久化状态 ——
论题、笔记、landscape、report、已读集合 —— 都以纯文本文件、Git 版本化的方式
存在主题仓库里。

## 为什么是它

绝大多数"AI 文献综述"工具都在为"广度"做优化：列论文、聚类、做摘要。这个工具
是为"逐步打磨论题"做优化的。`.researcher/thesis.md` 里的工作论题就是 spec；
每读一篇论文都被强制要么强化它、要么细化它、要么反驳它；其余产物
（`report.md`、landscape、单篇笔记）的存在意义是让这份论题**可被挑战**，
而不是为了文献综述本身。

你通过审 PR diff 留在闭环里，而不是和某个 agent 不停聊。

## 当前状态

已实现：
- `init` —— 在仓库里搭好 `.researcher/`
- `onboard` —— 交互式 TUI，引导你写出 `project.yaml` + `thesis.md`
- `add <arxiv-id | arxiv-url>` —— 手动把一篇论文端到端深读完
- `run` —— 自动 tick：discover → triage →（挑一篇）深读 → synthesize → package
- `methodology install / show / edit` —— 管理可移植的方法论包

尚未接入：focused-instruction 模式（手动覆盖 triage 决策）。

## 安装

```sh
npm install
npm run build
npm link        # 暴露 `researcher` 命令
researcher methodology install   # 一次性，把方法论装到 ~/.researcher/methodology
```

依赖：
- `PATH` 上有 `claude` CLI（agent 运行时）。可用 `RESEARCHER_CLAUDE_BIN` 覆盖。
- 已认证的 `gh` CLI（`gh pr create` 用）。设置 `RESEARCHER_NO_REMOTE=1` 可
  跳过 push 和开 PR（适合纯本地的主题仓库）。
- `pdftotext`（poppler）做 PDF 抽取。缺失时会回退到 abstract。

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
| `researcher version` | 打印版本 |

## 环境变量

- `RESEARCHER_CLAUDE_BIN` —— 当 `claude` 不在 `PATH` 上时指定路径。
- `RESEARCHER_NO_REMOTE=1` —— 跳过 `git push` 和 `gh pr create`（纯本地模式）。

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
