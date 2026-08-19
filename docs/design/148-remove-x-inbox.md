# 【run】移除 x-inbox / feed 管道

- Issue: #148
- 状态: Approved
- 最后更新: 2026-08-19

## 1. 背景

researcher 在 #21 挂上 `kind: x-inbox` 第二条自主路径，服务 `research-invest` 的 X 关注流。#23 只去 Twitter 词，没有把这条路径从引擎拿掉。引擎身份是论文/URL/Library 深读；feed 盯盘不属于本仓。

## 2. 名词解释

- **feed / x-inbox**：消费 repo 外 digest、跑 `feed-synthesize` / `feed-enrich` / `feedPackage` 的第二条 `run` 分叉。
- **干净切断**：删除专用模块；`project.yaml` schema 不再认识 `x-inbox` / `inbox_dir` / `enrich`。无兼容层。

## 3. 设计目标与非目标

- **目标**：researcher 只走 paper/url/library；旧 yaml 写 `x-inbox` 时 `loadProjectYaml` 失败。
- **非目标**：不改另外两个仓；不把 digest 改名为通用 inbox；不迁移 `seen.jsonl` 的 `xfeed:` 行；不重写历史 plan。

## 4. 能力与功能设计

用户不再能把 topic 配成 feed 模式。`researcher run` 只有 paper 路径。

### 4.1 UI / UX

Web `sourceSummary` / soul-ready 不再展示 inbox。无新页面。

## 5. 设计思路与折衷

- 选择干净切断：schema 拒收 + 删模块。
- 放弃运行期报错（留死代码）。
- 放弃抽独立包。
- 历史 docs/plan 不强制重写；`docs/design/23-decouple-x-inbox.md` 标 Superseded。

## 6. 架构设计

### 6.1 逻辑分层

删除后 `run` 只剩：bootstrap → soul →（library-linked | discover）→ read/libraryTopicRead → rebalance → synthesize → package。

### 6.2 核心业务流程

`loadProjectYaml` 若 kind 含 `x-inbox` → `ProjectYamlError`。不再有 `resolveRunSourceMode`。

## 7. 模块设计

**删除：** `src/sources/inbox.ts`；`src/pipeline/feed_synthesize.ts`、`feed_enrich.ts`、`package_feed.ts`；`src/commands/run-source-mode.ts`；`prompts/stage-feed-synthesize.md`、`stage-feed-enrich.md`；对应测试。

**剥离：** `run.ts`、`project-yaml.ts`、`context.ts`、`runs.ts`、`package.ts`、`soul-ready.ts`、`discovery.ts`、`discover_seed.ts`、`templates/project.yaml`、README。

## 8. API / CLI 设计

- `project.yaml` `sources[].kind` 枚举去掉 `x-inbox`；去掉 `inbox_dir`、`enrich`。
- 无 `researcher feed` 子命令。
- 失败：zod → `ProjectYamlError`。

## 9. 边界考虑

- `research-invest` 下次 run 会在加载 yaml 失败：预期。
- `seen.jsonl` 的 `xfeed:` 当未知历史行。
- 无并发/权限变化。

## 10. 迁移 / 兼容 / 回滚

无数据迁移。回滚 = revert 本变更。不提供 shim。

## 11. 测试计划

- **E2E**：现有 paper `run` stub 测试仍过；plan 无 feed 阶段。
- **Integration / Unit**：`loadProjectYaml` 拒收 x-inbox；soul-ready / discover_seed 去掉 x-inbox fixture；删除 `run_feed` / `inbox` / `feed_synthesize` / `run-source-mode` 测试文件。

## 12. 开放问题 / 决策记录

- 2026-08-19：整条 pipeline 删除，不是改名。
- 2026-08-19：schema 拒收，不是 run 时拒绝。
- 2026-08-19：另外两仓不动。

## 13. 关联

- Issue: https://github.com/xforce-io/researcher/issues/148
- 概要：https://github.com/xforce-io/researcher/issues/148#issuecomment-5337462228
- 取代：#21 / #23 / #27 / #77 的 feed 产品面
