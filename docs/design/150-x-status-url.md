# 【url】X status / Article 能深读出正文

- Issue: #150
- 状态: Approved
- 最后更新: 2026-08-19

## 1. 背景

X status 被 `canonicalizeUrl` 收成 `url:`，`url-fetch` 对页面 GET + HTML 抽正文。X 是 JS 壳，正文空。X Article 的 tweet.text 几乎是 t.co。feeds ingest 已随 #148 作废。

## 2. 名词解释

- **status URL**：`https://x.com/{handle}/status/{id}`（twitter.com / mobile 同等）。
- **X Article**：挂在 status 上的长文；正文在 `article.title` + `article.content.blocks[]`。

## 3. 设计目标与非目标

- **目标**：`fetchUrlMaterial` 对 status URL 用公开接口拿到非空 text；Article 折进 text；仍是 `SourceKind: url`。
- **非目标**：feeds/ingest、Playwright、新 kind、Medium/Substack、媒体 SLA。

## 4. 能力与功能设计

`library add` / `add` / Library 深读贴 status URL，与其它 URL 同一入口。

### 4.1 UI / UX

N/A — 无新页面。

## 5. 设计思路与折衷

- 选择：`src/sources/x-status.ts`，`fetchUrlMaterial` 先分发。先 fxtwitter，失败 syndication。
- 放弃：堆进 url-fetch；新 `SourceKind: x`。

## 6. 架构设计

### 6.1 逻辑分层

`fetchUrlMaterial` → `parseXStatusUrl` 命中则 `fetchXStatusMaterial`，否则现有 HTTP/GitHub。

### 6.2 核心业务流程

parse id → GET fxtwitter → 映射；失败则 syndication。Article：`# title` + nonempty blocks。都空则抛错、不写 cache。

## 7. 模块设计

`x-status.ts` 不依赖 Playwright / inbox。`doc-type` 对 status URL 推断 `blog`。

## 8. API / CLI 设计

无新 CLI。失败抛错，与其它 url fetch 相同，`readUrlSource` 可走 fetchInstruction。

## 9. 边界考虑

非正式接口；私密/删除当失败。超时 ~15s。不读 X 登录态。

## 10. 迁移 / 兼容 / 回滚

无存量迁移。回滚删模块与 dispatch。

## 11. 测试计划

- **E2E**：N/A（CI 不打真 X）。本地可用样例 URL 手跑。
- **Unit**：parse 变体；普通推；Article；空失败；`fetchUrlMaterial` mock 不 GET x.com HTML；失败不写 cache。

## 12. 开放问题 / 决策记录

- 2026-08-19：只补 X；模块独立；kind 仍是 url。

## 13. 关联

- Issue: https://github.com/xforce-io/researcher/issues/150
- 概要：https://github.com/xforce-io/researcher/issues/150#issuecomment-5339140757
