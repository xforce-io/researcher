# Task 4 report — Publish 确认、CLI 接线与失败恢复

## Status
DONE

## Summary
Implemented local publish transaction boundaries (clean-index / clean-`.gitmodules` gates, push-failure rollback of origin + `.gitmodules` + index), injectable `WorkspacePublishCliRuntime` with TTY confirm / `--yes`, plan formatting via `displayRemote` only, and CLI error credential redaction.

## Changes
- `src/git/workspace-ops.ts`
  - `GitmodulesSnapshot`, `snapshotGitmodules`, `restoreGitmodules`
  - `assertGitmodulesClean` (missing file = clean; dirty worktree/index rejects)
  - `removeOriginIfMatches` (only removes origin when URL still equals this plan’s remote)
- `src/workspace/publish.ts`
  - `executeWorkspacePublish` now: authorize → `assertNoStagedChanges` → `assertGitmodulesClean` → snapshot → `addOrigin` / `pushHead` / `registerExistingAsSubmodule`
  - On failure: `git reset -- .gitmodules <path>` → restore snapshot → `removeOriginIfMatches`
- `src/commands/workspace.ts`
  - `WorkspacePublishCliRuntime`, `processPublishRuntime` (readline `[y/N]`, only `y`/`yes`)
  - `formatPublishPlan` uses `plan.displayRemote` only
  - `runWorkspacePublishCli(path, opts, runtime?)`: plan out → dry-run blocked line → auth → non-TTY requires `--yes` → confirm → execute
  - catch writes sanitized stderr via runtime and sets exit code
- `src/cli.ts`
  - `.option('--yes', 'confirm non-interactive publish; does not bypass manifest permission')` passed through
- `tests/workspace/sync.test.ts`
  - unauthorized execute, push-fail restore + retry, dirty index, dirty tracked `.gitmodules`
- `tests/workspace/publish-cli.test.ts` (new)
  - blocked dry-run, non-interactive without `--yes`, TTY confirm true/false, `--yes` success, credential redaction

## Tests
Command:
```sh
npx vitest run tests/workspace/sync.test.ts tests/workspace/publish-cli.test.ts -t "publish|dirty index|requires --yes|blocked dry-run|TTY confirmation"
```

Result: **PASS** — 2 files, 23 passed, 9 skipped.

## Commit
`feat: gate and recover workspace publish` (see git log after commit)

## Concerns / notes
- `--yes` only skips confirmation; manifest `publish: false` still blocks execution (exit 2). Dry-run unauthorized still exit 0 with `blocked: publish not enabled`.
- Rollback is best-effort around the original error; concurrent origin URL changes are preserved by `removeOriginIfMatches`.
- No Task 5 docs or full-suite/lint runs (per brief).
