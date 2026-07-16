# 77 · Three high-severity code-review fixes

Issue: https://github.com/xforce-io/researcher/issues/77

## 1. Package stash recovery

`packageStage` branch dance: stash → checkout main → createBranch → stashDrop.

On failure after stash: restore `baseBranch` and `stash pop` (never drop until success).

Helper: `recoverPackageBranchDance` in `src/pipeline/package.ts`.

## 2. x-inbox vs paper exclusive modes

`resolveRunSourceMode` (`src/commands/run-source-mode.ts`):

| Config | Mode |
|--------|------|
| only x-inbox (or x-inbox + placeholder arxiv queries) | `feed` |
| paper discovery queries, no x-inbox | `paper` |
| **both x-inbox and real paper queries** | **throw** clear error |

No silent exclusive feed fork.

## 3. Markdown XSS

`sanitizeHtml` after every `marked` body path in `views.ts` (`markedHtml` / `markedInline`).
Strips script/style, event handlers, javascript: URLs, dangerous tags.
