# 【workspace】显式 workspace sync 对齐 GitHub

- Issue: #130
- 状态: Approved
- 最后更新: 2026-08-01

## 1. 背景

Workspace 超级仓有两层 git：各 topic 子仓 + super-repo 的 submodule 指针。今天只有 topic 层的 `delivery.mode: remote`（挂在单次 `run`/package 末尾的 push + draft PR），没有显式的 workspace 级同步命令。

结果：

- 有 `origin` 的 pillar 默认仍可能是 local 投递，人要自己 push。
- 纯本地 pillar（未进 `.gitmodules`、无 remote）无法晋升为远程成员。
- super-repo 指针 bump 只能人肉。

`docs/design/9-workspace-run.md` 已将 pointer sync 标为未来显式步骤（possibly `researcher workspace sync`）。本设计兑现该步骤，并补齐 pull / push-topics / publish。

## 2. 名词解释

- **Topic delivery**：`.researcher/project.yaml` 的 `delivery.mode`；仅影响 package 是否 push+开 PR。
- **Workspace sync**：超级仓根的显式运维动作，对齐各 topic 与 super-repo 的 git 状态；**不**改 `delivery.mode`。
- **Publish**：把「本地 git 目录 + manifest 条目」晋升为「有 origin 的 submodule 成员」。
- **Pointer / gitlink**：super-repo 中记录的 submodule commit SHA。

## 3. 设计目标与非目标

- **目标**：
  - CLI：`researcher workspace sync` 与 `researcher workspace publish`
  - 可组合：`--pull` / `--push-topics` / `--pointers`；可 `--dry-run`；默认同 active topics，`--all` 含 dormant
  - 与 `delivery.mode` 正交
  - 单 topic 失败隔离；摘要可判定；exit code 反映是否存在 failed
  - publish 默认关闭；仅 manifest 中显式放行的 topic 可改变远端与 workspace 拓扑
- **非目标**：
  - 不改 `run` / package 默认自动 bump super-repo
  - 不做非 ff merge / rebase / force push
  - 不 `gh repo create`、不管理多 remote
  - 不在 `serve` 暴露 UI
  - push-topics **不开 PR**（PR 仍归 delivery remote 路径）

## 4. 能力与功能设计

### 4.1 UI / UX

N/A：无 Web 页面。CLI 人类可读摘要表 + 非零 exit 表示存在 failed。

用户主路径：

```text
cd <workspace-root>
researcher workspace sync --pull
researcher workspace sync --push-topics
researcher workspace sync --pointers
researcher workspace publish world-model --remote git@github.com:org/repo.git
researcher workspace sync --pull --push-topics --pointers --dry-run
```

### 4.2 Publish 门禁

`publish` 同时写 topic remote、推送远端、改写 super-repo index 并创建提交，按高危操作处理：

```yaml
topics:
  - path: world-model
    active: true
    publish: true
```

- `publish` 默认为 `false`；授权粒度仅到单个 topic，不提供 workspace 总开关。
- TTY 执行先展示脱敏计划并确认；非 TTY 默认拒绝，调用方必须显式传 `--yes`。
- `--yes` 只跳过人工确认，不绕过 manifest allowlist、仓库边界或 clean-index 校验；不提供 `--force`。
- `--dry-run` 始终无写副作用；未授权时仍可展示计划，但必须标记 `blocked: publish not enabled`。


## 5. 设计思路与折衷

候选：

1. **每次 workspace `run` 末自动 sync** — 实现省事，但污染 super-repo、与 local 探索冲突。
2. **仅文档 + 人肉 git** — 零代码，但与「一个根推进」不一致，且易漏 pointer。
3. **显式 `workspace sync` / `publish`（采纳）** — 运维意图清晰、可 dry-run、可测；与 delivery 正交。

放弃 1/2：自动副作用过大；纯文档无法验收。

`publish` 与 `sync --pointers` 拆开：前者改变拓扑（remote + submodule 登记），后者只 bump 已有 gitlink。避免 `sync` 隐式 `submodule add`。

`publish` 采用 topic allowlist + 执行确认双门禁。只用确认容易被 agent/CI 的 `--yes` 常态化绕过；只用配置又挡不住人工误触。双门禁将长期授权与单次意图分开，代价是一次 manifest 配置和一次执行确认。

## 6. 架构设计

### 6.1 逻辑分层

```mermaid
flowchart TB
  CLI["cli: workspace sync|publish"] --> CMD["commands/workspace.ts"]
  CMD --> SYNC["workspace/sync.ts"]
  CMD --> PUB["workspace/publish.ts"]
  SYNC --> MAN["workspace/manifest.ts"]
  SYNC --> CLASS["classify topic git shape"]
  SYNC --> GIT["git/ops.ts + git/workspace-ops.ts"]
  PUB --> MAN
  PUB --> GIT
  CLASS --> GIT
```

- `manifest`：谁在 workspace、active/dormant、哪些 topic 获准 publish
- `classify`：missing / not-git / local-only / remote / submodule，并确认 topic 是独立仓库而非 super-repo 普通子目录
- `git ops`：ff-pull、push 当前分支、读 origin、读 HEAD、stage gitlink、commit super-repo、submodule 登记
- sync/publish：**串行**；sync 收集 per-topic 结果，publish 执行授权、计划、确认和可恢复写入

### 6.2 核心业务流程

**sync**

1. 校验 cwd 有 `researcher.workspace.yml`，否则 exit 2 类用法错误
2. 解析 flags：未指定任何动作时默认 `--pull`（只读安全默认）
3. 选题：active；若 `--all` 则全部 manifest topics
4. 对每个 topic 分类后按启用的动作执行：
   - pull：有 origin 则 `fetch` + 当前分支 `pull --ff-only`；否则 skipped
   - push-topics：有 origin 则 `push -u origin HEAD`；否则 skipped
   - pointers：仅 submodule 且 gitlink≠HEAD 时 stage path；循环后若有 staged 则 super-repo 一次 commit
5. dry-run：只报告 will-*，不 exec 写操作
6. 任一 `failed` → process exit 1；纯 skipped/ok → 0

**publish `<path>`**

1. path 必须在 manifest，且该 topic 显式配置 `publish: true`
2. 目录必须位于 workspace 内并且是独立 git 仓；普通 super-repo 子目录不算 topic 仓
3. 若已是 submodule 或已有 origin → 明确错误（非静默）
4. 展示脱敏执行计划；TTY 要求确认，非 TTY 必须显式 `--yes`
5. 校验 super-repo index 无本次目标以外的 staged 内容，且 `.gitmodules` 无未提交修改
6. 新增 origin 后 push 当前分支，再登记 submodule；任一步失败时恢复本次本地 origin、`.gitmodules` 和 index 变更，保持同一命令可重试
7. 不修改 topic 的 `delivery.mode`

## 7. 模块设计

| 模块 | 职责 |
|---|---|
| `src/commands/workspace.ts` | CLI 参数、cwd 解析、exit code、打印 |
| `src/workspace/sync.ts` | sync 编排、结果类型、summary |
| `src/workspace/publish.ts` | publish 编排 |
| `src/workspace/topic-git.ts` | 分类 topic：missing/not-git/local-only/remote/submodule |
| `src/git/ops.ts` 或 `src/git/workspace-ops.ts` | 新增：hasOrigin、getRemoteUrl、fetch、pushHead、isSubmodulePath、stageGitlink、commitPointers、registerSubmodule |
| `tests/workspace/sync.test.ts` 等 | fixture + 行为断言 |

复用：`loadWorkspaceManifest` / `activeTopics`；既有 `pullFastForward` / `pushBranch` 可包一层「强制 remote=true」或抽无 gate 的底层实现，避免 sync 误走 delivery 语义。

## 8. API / CLI 设计

```text
researcher workspace sync [options]
  --pull              fetch + ff-only 当前分支（默认：若无任何动作 flag 则启用）
  --push-topics       push 当前分支到 origin
  --pointers          bump super-repo 中已有 submodule 的 gitlink 并 commit
  --all               包含 dormant topics（默认仅 active）
  --dry-run           不写：不 push / 不 commit / 不改 gitmodules
  --cwd <path>        可选，默认 process.cwd()

researcher workspace publish <path> --remote <git-url> [options]
  --remote <url>      必填 origin URL（调用方已建好空仓）
  --dry-run
  --cwd <path>
  --yes               非交互确认；不能绕过 topic publish allowlist
```

成功摘要示例（stdout）：

```text
workspace sync
  trace                   pull=ok      push=ok      kind=submodule
  decision                pull=skipped push=skipped kind=local-only (no origin)
  ghost                   pull=failed  reason=missing directory
pointers: committed 1 gitlink(s)  # 或 dry-run / no-op
```

Exit：

- `0`：无 failed（skipped 允许）
- `1`：执行失败
- `2`：用法/非 workspace 根/publish 未授权或未确认

## 9. 边界考虑

- **仓库边界**：topic 必须是位于 workspace 内的独立 git 仓或正规 submodule；普通 super-repo 子目录不得继承父仓的 HEAD、branch 或 origin
- **super-repo 前置**：pointers/publish 要求 super-repo 是 git 仓；自动提交不得包含用户预先 staged 的无关内容；publish 遇到已有 `.gitmodules` 未提交修改时拒绝执行
- **publish 授权**：manifest 中目标 topic 的 `publish: true` 是必要条件；`--yes`、环境变量和 `--dry-run` 均不能形成写授权
- **执行确认**：TTY 确认单次计划；非 TTY 仅 `--yes` 可确认。拒绝或缺确认时零写入
- **凭证**：remote URL 原样作为 git 参数但不进入 shell；stdout/stderr、计划和错误统一移除 URL userinfo，不打印 token
- **错误**：非 workspace、publish 缺 remote、path 不在 manifest、未授权、已有 origin、非 ff → 明确消息
- **失败恢复**：publish 任一步失败时恢复本次新增的 origin、`.gitmodules` 和 index 变更；远端已成功接收的 commit 无法回滚，但本地状态须允许幂等重试
- **submodule 登记**：目录已存在时不能直接 `git submodule add <url> <path>`。采用：
  1. 确保 topic 已 push 到 origin
  2. 写/更新 `.gitmodules` 段
  3. `git update-index --add --cacheinfo 160000 <sha> <path>`（或等价）写入 gitlink
  4. super-repo commit 仅包含 `.gitmodules` 与目标 gitlink（publish 自己的 commit message，与 pointers 分开）
- **并发**：不做；串行同 orchestrator
- **dirty tree**：pull/push 不自动 stash；git 失败则该 topic failed
- **detached HEAD**：push-topics failed（需具名分支）；pull 可对 detached 尝试 ff 当前 HEAD 的上游，若无上游则 skipped/failed 并说明

## 10. 迁移 / 兼容 / 回滚

- manifest topic 新增可选 `publish` 字段，缺省为 `false`；现有 workspace 无需迁移且默认不获得发布权限
- 不改变既有 `run` / `delivery.mode` 行为
- 回滚命令实现时保留默认拒绝语义；已成功 publish 的 submodule 保留为用户 git 状态

## 11. 测试计划

- **E2E / Integration**（`tests/workspace/sync.test.ts`、`publish.test.ts`）：
  1. 建临时 super-repo + bare remotes
  2. topic A：submodule + origin，远程快进 → pull ok
  3. topic B：local-only → pull/push skipped
  4. topic A 本地超前 → push-topics 后 bare 有新 tip
  5. 子仓前进后 `--pointers` 产生 1 个 super commit；`--dry-run` 不产生
  6. local-only topic 未授权 → publish exit 2，topic 与 super-repo 零副作用
  7. 仅目标 topic 配置 `publish: true`；TTY 确认或非 TTY `--yes` 后有 origin、`.gitmodules` 含 path、super 有 gitlink
  8. `--yes` 不能绕过 allowlist；未授权 dry-run 仅报告 blocked
  9. push/commit 故意失败后，本地状态可用同一命令重试；既有 staged 内容不进入自动提交，dirty `.gitmodules` 被拒绝
  10. remote 含 userinfo 时，stdout/stderr 不出现凭证
  11. 故意失败 topic + 成功 topic → sync 摘要隔离，exit 1
- **Unit**：
  - classify missing / 普通子目录 / local-only / remote / submodule
  - flag 默认（无动作 → pull）
  - publish allowlist、TTY/非 TTY 确认和 exit code
  - remote URL 脱敏
  - exit code 聚合（failed vs skipped）

## 12. 开放问题 / 决策记录

- 无动作 flag 时默认 `--pull`：只读安全，避免裸 `sync` 误 push。
- push 不开 PR：保持 delivery 为唯一自动 PR 入口。
- publish 不建 GitHub 仓：避免 `gh` 权限与 org 策略耦合。
- publish 默认关闭并按 topic 放行：避免一次配置扩大整个 workspace 的远端写权限。
- publish 使用 allowlist + 单次确认：长期授权与本次执行意图必须同时成立。

## 13. 关联

- Issue #130
- L1：issue comment「设计（概要）」
- 前作：`docs/design/9-workspace-run.md`
- 模块：`src/workspace/*`、`src/git/ops.ts`、`src/cli.ts`
