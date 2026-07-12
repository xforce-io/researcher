# 91 · Topics 页加号卡新建 topic（轻量 scaffold）

Issue: https://github.com/xforce-io/researcher/issues/91  
Branch: `feat/91-add-topic-card`

## Goal

让 workspace Web Console 的 Topics 网格能**新增研究支柱**，而不是只读投影 `researcher.workspace.yml`。

原则：网格里展示的一等对象，网格里就应该能新增。

MVP 完成「占位 + 登记」；完整 thesis 塑造仍走 CLI `researcher onboard` / 手改文件。

## Non-goals

- Web 完整 interactive onboard
- remote git submodule / GitHub 建仓
- 删除 topic、dormant 切换
- 自动改 `CHARTER.md`
- 创建时填 sources / RQ / delivery

## User flow

```
GET /topics
  └─ 网格末尾 [ + New topic ]
        ↓
   modal: path* + one-line*
        ↓ POST /topics
   createWorkspaceTopic(...)
        ↓ 303
   /t/<path>  with Needs setup
```

## Path rules

- Relative to workspace root; also `topics[].path`
- 1–3 segments; each `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`; total length ≤ 64
- Reject `..`, absolute, leading/trailing `/`, existing disk path, duplicate manifest path

## Create kernel

`src/workspace/create-topic.ts` → `createWorkspaceTopic({ root, path, oneline })`:

1. Validate path / oneline
2. Load manifest; reject duplicates
3. `mkdir` topic dir
4. `git init -b main` (topic packaging needs its own git root)
5. `scaffoldTopicRepo`
6. Write `meta.topic_oneline`
7. Initial commit `researcher: scaffold <path>`
8. `addTopicToManifest` last (`active: true`)

On mid-flight failure: remove the new directory if we created it; leave manifest unchanged.

## HTTP / UI

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/topics` | form `path`, `oneline` → create; 303 `/t/:slug` |

- Topics grid: dashed `card-new` at end + modal (Add paper pattern)
- Card/detail: `needsSetup` when available, 0 notes, never run, thesis still template
- Do not disable Run; show setup notice + CLI onboard hint

## Onboard bridge

Writing `topic_oneline` would make `isAllTemplates()` false. Add `isOnboardable()` that allows **only** `meta.topic_oneline` to differ from the template. `researcher onboard` preflight uses `isOnboardable`.

## End-to-end test plan

1. `researcher serve` on a workspace
2. `/topics` shows trailing `+ New topic`
3. Create `probe-topic` with one-line
4. Assert disk skeleton, manifest entry, card, `/t/probe-topic` Needs setup
5. Duplicate path fails
6. `cd probe-topic && researcher onboard` is not refused solely for oneline drift

Unit/integration tests cover path validation, create kernel, manifest write, onboardable check, server POST, and view markup separately from the above user path.
