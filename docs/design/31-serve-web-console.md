# Design: `researcher serve` — workspace topics 只读 Web Console

> Issue: xforce-io/researcher#31
> Status: 已实现并合并(#32)。后续演进:run 进度 popover(#33)、dashboard/话题页视觉打磨与若干修复(#36)—— 细节见各自 issue/PR,本文仅记 v1 设计。

## Problem

researcher 目前是纯 CLI,所有交互通过 git / PR / markdown 文件进行。审一个 workspace
超级仓(含 `researcher.workspace.yml`)下多个 topic 的研究产物,只能逐个 `cd` 进去看
markdown、`researcher run` 也要逐个手敲。希望像 `kairo serve <root>` 那样,对一个
workspace 超级仓起一个本地 Web Console:一处**展示**所有 topic 的产物,并能在 UI 里
**触发 run**。

参照物 kairo:`kairo serve <root>` → FastAPI + Jinja2 + HTMX,扫 root 下含
`constitution.yaml` 的子目录作为 workspace,dashboard 列出,可查看产物文档、触发
`kairo step`(后台任务 + SSE 实时日志)。本设计取其心智,但落到 researcher 的 TS 栈、
workspace-only 发现模型,以及 v1 只读 + 触发 run 的范围。

## Scope (v1)

- **只读展示** + **触发 run**。不编辑、不增删 sources/topics。
- 仅 **workspace 模式**:`serve` 指向含 `researcher.workspace.yml` 的超级仓,按其声明的
  topics(active/dormant)展示。不支持单 topic 直指、不自动扫子目录。

后续阶段(非本期):编辑 thesis/project.yaml、管理 sources/topics、新建 topic。

## Design

一层薄薄的 SSR Web 层,叠在现有 CLI 之上。真正的研究推进仍由各 submodule 的
`researcher run` 完成 —— Web 只读聚合产物、并以子进程方式触发 run。

### 1. CLI 子命令 `researcher serve`

`src/cli.ts` 新增:

```
researcher serve [--port 4500] [path]
```

- `path` 默认 cwd;必须含 `researcher.workspace.yml`,否则报错退出。
- 绑 `127.0.0.1`(本地工具,无鉴权)。
- 懒加载 `./web/server.js`,与现有子命令一致(`await import`)。

### 2. 技术选型

- 全在 researcher 仓内,TS,**服务端渲染**。
- HTTP 用 Node 内置 `http`,**不引入 web 框架**。
- **零模板引擎**:页面就几张,`views.ts` 用手写的 HTML 字符串函数。
- 唯一新增运行时依赖:**`marked`**(零依赖、极小,markdown → HTML)。
- 前端无框架:SSR 出完整 HTML,局部交互用极少原生 JS(`fetch` + `EventSource`),
  零额外前端资源(不引 HTMX)。

### 3. 模块布局 — 新增 `src/web/`

| 文件 | 职责 | 依赖 |
|------|------|------|
| `server.ts` | 起 http server、路由分发、静态资源 | `http`、`discovery`、`views`、`tasks` |
| `discovery.ts` | 读 manifest + 各 topic `.researcher/` 与产物 → 视图模型 | `workspace/manifest`、`config`、`paths` |
| `views.ts` | 纯函数:视图模型 → HTML 片段 | `marked` |
| `tasks.ts` | per-topic 串行 run 任务注册表(子进程 + 日志缓冲 + SSE) | `execa` |
| `static/app.css` | 朴素纸墨风样式(贴近 kairo) | — |

复用现有 `loadWorkspaceManifest`、`resolveProjectResearcherDir`、`loadProjectYaml`,
不重写任何解析。

### 4. 发现与视图模型(`discovery.ts`)

从 `path` 读 manifest,对每个 topic(active 与 dormant 都列,dormant 标灰)聚合:

- `.researcher/project.yaml` — `meta.topic_oneline`、`language`、`sources`、`research_questions`
- `.researcher/thesis.md`
- `notes/00_research_landscape.md`、`report.md`、`notes/NN_*.md` 列表
- `papers/` PDF 清单
- `.researcher/state/seen.jsonl` — decision / reason 表(只读解析)
- `.researcher/state/watermark.json` — 上次运行时间 / 窗口 / run id

缺文件即对应字段为空,不报错(topic 可能尚未 run 过)。`slug` = manifest 里的
topic `path`(URL 编码)。submodule 目录缺失或无 `.researcher/` 的 topic,标记为
unavailable 并在卡片上提示(对齐 orchestrator 的同类判定)。

### 5. 路由(SSR,只读)

| 方法 | 路由 | 功能 |
|------|------|------|
| GET | `/` | Dashboard:topics 卡片网格(简介、active 状态、笔记数、上次 run、最近 decision 数) |
| GET | `/t/{slug}` | Topic 详情:左栏文档树 + 中栏选中文档渲染 + 右栏元数据 |
| GET | `/t/{slug}/doc?path=…` | 渲染单个文档(markdown → HTML) |
| GET | `/t/{slug}/paper?id=…` | 内联打开 `papers/` 下的 PDF |
| GET | `/static/app.css` | 样式 |

**路径安全**:`doc`/`paper` 的相对路径经白名单守卫 —— resolve 后必须落在该 topic
目录内、且仅允许 `doc` 取 `.md`、`paper` 取 `papers/` 下 `.pdf`;越界 / 不存在 → 404。
客户端无法指定任意路径。

### 6. 触发 run(唯一写操作)

| 方法 | 路由 | 功能 |
|------|------|------|
| POST | `/t/{slug}/run` | 在 topic 目录子进程跑 `researcher run`,返回 `taskId`;同 topic 已在跑 → 409 忙 |
| GET | `/t/{slug}/run/{taskId}/stream` | SSE 实时推 stdout(环形缓冲最近 ~2000 行);进程结束推终态事件 |

`tasks.ts` 维护 per-slug 串行的 `TaskRegistry`:

- 子进程跑当前 CLI 二进制的 `run`(`execa(process.execPath, [cliEntry, 'run'], { cwd: topicDir })`)。
- **不在 Web 进程内直接调 `runRun`**:子进程天然吃到 `.researcher/state/.lock`、隔离
  重型 `ClaudeCodeAdapter`、子进程崩溃不拖垮 server。
- stdout 行缓冲(环形,上限 ~2000 行)供 SSE 续传;进程退出后保留终态供前端拉取。
- 任务仅存活于 server 进程内,不持久化历史。

### 7. 前端形态

- 无框架。SSR 出完整 HTML。
- 局部交互用极少原生 JS:点文档树切换 reader(`fetch` `/t/{slug}/doc` 注入中栏)、
  点「Run」`POST` 后用 `EventSource` 订阅 SSE 把日志追加进日志区。
- markdown 服务端 `marked` 渲染;`app.css` 负责排版与纸墨风。

## Non-goals

- 不编辑 thesis / project.yaml;不增删 sources / topics;不新建 topic。
- 不做鉴权、多用户、任务历史持久化、远程访问。
- 不支持单 topic 直指或自动扫子目录(仅 workspace 模式)。

## Testing

- `discovery.ts`:造临时 workspace fixture(manifest + 两个 topic,一含全套产物、一空),
  断言聚合的视图模型字段与 dormant/unavailable 标记。
- `views.ts`:纯函数,断言关键 HTML 结构与 markdown 渲染、HTML 转义。
- 路径白名单守卫:越界路径 / 非 `.md` / 不存在 → 拒绝。
- `tasks.ts`:注入假子进程 runner,测 per-topic 串行、忙判定(409)、日志环形缓冲与
  SSE 续传;不实跑真 `run`。

## Module boundaries

- `discovery` 只读、无副作用,产出纯数据视图模型。
- `views` 纯函数,输入视图模型输出 HTML,无 IO。
- `tasks` 唯一有副作用(起子进程)的单元,接口为 `start(slug) → taskId`、
  `subscribe(taskId)`、`isBusy(slug)`,可注入 runner 以便测试。
- `server` 仅做路由编排与 HTTP 细节,薄。
