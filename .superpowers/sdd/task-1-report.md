# Task 1 Report

## Status

DONE

## Implementation

- Added required `WorkspaceTopic.publish: boolean` output to the Zod topic schema with a default of `false`.
- Extended `addTopicToManifest` to accept optional `publish` input and persist `publish: false` unless explicitly authorized.
- Replaced inherited work-tree detection with an independent-repository boundary check: `git rev-parse --show-toplevel` and the candidate directory are both resolved with `realpathSync` and must be equal.
- Made existing non-independent directories classify as `not-git` with reason `not an independent git repository`.
- Extended the workspace-sync manifest fixture for explicit publish authorization and added manifest-default and real-Git super-repo child-directory regression coverage.

## TDD Evidence

### RED

Command:

```sh
npx vitest run tests/workspace/sync.test.ts -t "publish permission|plain super-repo"
```

Output (exit 1):

```text
❯ tests/workspace/sync.test.ts (12 tests | 2 failed | 10 skipped) 356ms
  × defaults per-topic publish permission to false
    → expected { path: 'topic', active: true } to deeply equal { path: 'topic', active: true, publish: false }
  × classifyTopicGit > does not classify a plain super-repo directory as a topic repo
    → expected kind "local-only" to match kind "not-git" and reason "not an independent git repository"

Test Files  1 failed (1)
Tests       2 failed | 10 skipped (12)
```

Both tests failed for the intended missing behaviors before production changes.

### GREEN

Command:

```sh
npx vitest run tests/workspace/sync.test.ts -t "classify|publish permission|plain super-repo"
```

Output (exit 0):

```text
RUN  v3.2.4 /Users/xupeng/dev/github/researcher

Test Files  1 passed (1)
Tests       3 passed | 9 skipped (12)
Duration    2.45s (transform 60ms, setup 0ms, collect 136ms, tests 2.04s, environment 0ms, prepare 77ms)
```

This covers the existing missing/local-only/remote/submodule classifier cases plus the new plain super-repo directory fixture and manifest publish field.

Per the task constraint, no formatter, linter, TypeScript build, or project-wide test suite was run.

## Self-review

- The new classification fixture initializes and commits a real Git super-repository containing an ordinary child directory; it does not mock Git behavior.
- `classifyTopicGit` still checks `missing` before repository classification, and the existing classifier test confirms independent local repositories, remote repositories, and submodules retain their prior kinds.
- Both paths in the top-level comparison use `realpathSync`, so symlink spelling does not create a false repository boundary.
- Repository-wide type-usage search found `WorkspaceTopic` consumers only in `manifest.ts` and `sync.ts`; the only direct `WorkspaceManifest` construction affected by the required output field is `addTopicToManifest`, which now supplies `publish`.
- Changes are limited to `src/workspace/manifest.ts`, `src/workspace/topic-git.ts`, and `tests/workspace/sync.test.ts`; publish execution, CLI behavior, and product documentation were not modified.

## Implementation Commit

`00eb1614bad6b9402de95e88679c6805c7fbd855` (`fix: enforce workspace topic git boundaries`)
