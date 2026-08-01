# Task 2 Report — workspace publish gate

## Status

完成：只读 publish plan、逐 topic publish 授权、remote 显示脱敏、workspace 越界 path 拒绝、旧 publish API clean cutover。

## Implementation

- 新增 `sanitizeRemoteForDisplay(remote)`：
  - 清除标准 URL 的 username/password。
  - 清除 scp-like remote 的 userinfo。
  - 保持无 pathname URL 不被 `URL#toString()` 增加尾 `/`。
- 将 `publishWorkspaceTopic` clean cutover 为：
  - `prepareWorkspacePublish(opts)`：只读校验 manifest/path/repository/origin/branch/HEAD，返回授权状态、blocked reason、HEAD/branch、原始 Git remote 与脱敏显示值。
  - `executeWorkspacePublish(plan)`：第一条运行时检查拒绝未授权 plan，抛出 exit code 2，随后才可能执行任何 Git 写操作。
- existing origin 错误仅显示脱敏 remote。
- 机械迁移 `src/commands/workspace.ts` 和既有 publish tests；未保留旧导出或兼容 shim。
- 未实现 TTY、`--yes`、rollback/事务恢复或 pointer 行为。

## TDD evidence

### RED 1 — 新接口/模块尚不存在

Command:

```text
npx vitest run tests/workspace/sync.test.ts -t "blocked plan|redacts remote|outside the workspace"
```

Output:

```text
FAIL  tests/workspace/sync.test.ts
Error: Cannot find module '../../src/workspace/remote-display.js'
Test Files  1 failed (1)
```

### GREEN 1 — policy/path/redaction/authorization gate

```text
Test Files  1 passed (1)
Tests  7 passed | 12 skipped (19)
Duration  3.06s
```

### RED 2 — URL display stability

增加无 pathname URL 精确契约后：

```text
FAIL workspace publish policy > redacts remote userinfo from https://token@example.com
Expected: "https://example.com"
Received: "https://example.com/"
Test Files  1 failed (1)
```

### Final GREEN

Command:

```text
npx vitest run tests/workspace/sync.test.ts -t "blocked plan|redacts remote|outside the workspace"
```

Output:

```text
RUN  v3.2.4 /Users/xupeng/dev/github/researcher
Test Files  1 passed (1)
Tests  8 passed | 12 skipped (20)
Duration  2.91s
```

按 brief 约束未运行 formatter、lint 或项目全量测试。

## Self-check

- [x] `prepareWorkspacePublish` 不执行 Git 写操作。
- [x] path 拒绝 NUL、POSIX/Windows absolute path、`..` segment，并通过 `resolve` + `relative` 二次确认 workspace containment。
- [x] path 必须精确存在于 manifest。
- [x] 复用独立 topic repository classification；拒绝 missing/not-git/submodule/existing origin/detached HEAD/no HEAD。
- [x] `publish: false` 生成 `authorized: false` 和 `blockedReason: 'publish not enabled'`，prepare 不抛授权错误。
- [x] `executeWorkspacePublish` 的首条运行时检查拒绝未授权 plan，exitCode 为 2；定向测试确认 origin 和 `.gitmodules` 均未写入。
- [x] 原始 remote 仅传入 Git 操作；plan/CLI/error 的显示路径使用脱敏值。
- [x] existing origin 错误不包含 userinfo。
- [x] `publishWorkspaceTopic` 在 `src`/`tests` 无调用或导出残留。
- [x] command 与既有 tests 已迁移到 prepare/execute。
- [x] 未加入 Task 4 范围的 TTY、`--yes`、rollback 或 pointer。

## Commit

`4b13a93436be52565a32475a800e6d5a6654ef45` — `feat: require per-topic publish authorization`

## Concerns

无已知阻塞。按任务约束仅执行 brief 指定的定向 policy 测试，未执行全量回归。
