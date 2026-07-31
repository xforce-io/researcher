# Task 3 report — Discover context split

## Implementation

- Split Discover into `researcher-collect` (run-local `discover-candidates.json`) and tool-free `researcher-triage` (pure text JSON).
- Host validates and caps collection input at 30 candidates, writes `triaged.json`, and preserves Seen/deep-read selection behavior.
- A valid existing candidates artifact skips collection. A corrupt artifact is recollected.
- Length recovery invokes only `researcher-triage`, once, with no tool instructions.

## Red/green evidence

- **Red:** `npx vitest run tests/pipeline/discover_triage.test.ts` initially failed: the requested orchestration assertion received `[undefined]` instead of `['researcher-collect', 'researcher-triage']`; length-recovery expected three stage calls but old orchestration made two.
- **Green:** `npx vitest run tests/pipeline/discover_triage.test.ts` passed: 1 file, 7 tests, 0 failures (2026-07-31).

## Concern

The host validates the collection artifact and triage response schema, while the tool-free triage contract and prompt enforce that it may only score supplied candidates. It does not additionally compare every triaged ID against the collection artifact; adding that defense would alter existing triaged-output tolerance and was not part of Task 3's specified host-validation contract.

## Review follow-up

- `discoverTriage` now runs the existing idempotent `scaffoldMilkieRuntime` migration before collection. It preserves custom managed files and only adds missing collect/triage contracts and registry IDs; an autonomous `researcher run` regression covers a legacy registry.
- Triage now receives a dedicated safe system prompt with only handoff/JSON constraints. It no longer receives the filesystem-oriented general preamble.
- Candidate and triage schemas now reject empty namespace payloads and enforce namespace-specific canonical payload shapes.
- **Follow-up red:** legacy contracts were absent after discovery, triage received the general preamble, and `arxiv:`/`doi:`/`openreview:`/`urlhash:` parsed as valid IDs.
- **Follow-up green:** `npx vitest run tests/pipeline/discover_triage.test.ts tests/adapter/milkie.test.ts tests/config/discover-candidates.test.ts tests/config/triaged.test.ts tests/commands/init.test.ts tests/commands/onboard.test.ts tests/onboard/persist.test.ts` passed 7 files / 40 tests; `npx vitest run tests/commands/run.test.ts` passed 1 file / 7 tests.

## Namespace canonicalization follow-up

- **Red:** Uppercase `ARXIV:2401.12345` passed the case-insensitive schema but remained uppercase, while deep-read dispatch checks the lowercase `arxiv:` prefix.
- **Fix:** Both handoff schemas lowercase only the namespace after validation; the identifier payload remains unchanged.
- **Green:** `npx vitest run tests/config/discover-candidates.test.ts tests/config/triaged.test.ts` passed 2 files / 19 tests.

## Final orchestration boundaries

- **Red:** The host capped raw candidates before canonical-ID deduplication, a parseable `length` response still made a recovery call, and managed migration files vanished during a deep-read package branch dance.
- **Fix:** The host now deduplicates canonical IDs before capping; it parses the initial triage text before deciding whether `length` needs recovery; package snapshots and commits only the managed migration manifest/contracts so they survive stash/drop and branch creation.
- **Green:** `npx vitest run tests/pipeline/discover_triage.test.ts tests/commands/run.test.ts` passed 2 files / 18 tests, including duplicate-boundary, parseable-length, and deep-read persistence regressions.
# Task 3 report

## Implemented

- Added Discover regression coverage for a terminal adapter failure: `discoverTriage` rejects with `discover stage agent exited 1`, invokes the adapter once, and creates `discover.err`.
- Confirmed the existing initial `assertAgentOk` guard stops execution before the missing-output recovery path; no production change was needed beyond the completed Task 1/2 contract work.
- Updated Issue #116 design status to `Implemented`.

## TDD evidence

### Red

After adding the regression, I temporarily removed Discover's initial failure guard and ran:

`npx vitest run tests/pipeline/discover_triage.test.ts`

It exited `1` as expected:

```text
expected 2 to be 1
Expected: 1
Received: 2
```

The terminal-error adapter was invoked again by recovery, proving the test observes the fail-fast boundary. The initial guard was then restored unchanged.

### Green / focused

`npx vitest run tests/pipeline/discover_triage.test.ts` exited `0`:

```text
Test Files  1 passed (1)
Tests       7 passed (7)
Duration    655ms
```

### Full suite

`npm test` exited `0`:

```text
Test Files  71 passed (71)
Tests       468 passed (468)
Duration    7.90s
```

## Commit

`0c20ff5` — `fix: surface Milkie terminal errors`

## Concerns

- No unresolved concerns. This regression begins at the normalized adapter exit-code contract; Milkie terminal-status normalization and failure-artifact diagnostic content are covered by Tasks 1 and 2.
- No push or PR was performed.

# Task 3 report — Grok CLI provider activation (#120)

## External operational changes

- Created `/Users/xupeng/.researcher/config.yaml` with `runtime: grok-cli`, binary `/Users/xupeng/.grok/bin/grok`, and model `grok-4.5`. It is local operational configuration and was not committed; no credentials were recorded.
- In `/Users/xupeng/dev/github/research-harness/agentic-model-training/agents/researcher.md`, restored the sole Milkie fallback model line to `glm-latest`. No other external-project file was modified or committed.

## Red / green evidence

- **Red (Tasks 1–2):** Before implementation, the focused config/factory tests rejected `runtime: grok-cli` and lacked `createAgentRuntime`; the adapter test could not load `GrokCliAdapter`. The production-routing test's fake Grok binary was not invoked and its failure case bypassed the configured runtime. These failures are recorded in `.superpowers/sdd/task-1-report.md` and `task-2-report.md`.
- **Green:** `npm test` exited 0 after activation: 75 test files / 501 tests passed; the pre-existing opt-in `tests/integration/discover-milkie-cross-repo.test.ts` was skipped (1 file / 1 test) because its enabling environment variable was absent.

## Build and real compiled factory probe

- `npm run build` exited 0 and refreshed `dist/`.
- The required `RESEARCHER_HOME=/Users/xupeng/.researcher node --input-type=module -e ...` compiled-factory probe exited 0 in 16.48s. Its own exit assertion requires `createAgentRuntime()` to return a zero-exit runtime result with output exactly `GROK_PROVIDER_OK`; therefore the compiled factory selected and completed the configured real Grok CLI path.

## Controlled documents and commit

- Marked `docs/design/120-grok-cli-provider.md` as `Implemented` after the green verification.
- `ba79045` — `docs: record Grok CLI runtime design`

## Concern

- No unresolved concern. The Grok selection is intentionally machine-local via `/Users/xupeng/.researcher/config.yaml`; a host without the authenticated binary must configure its own local runtime before using this provider.

## Final review follow-up — Grok CLI NUL argv

### Red

`npm test -- tests/adapter/grok-cli.test.ts` failed after adding the prompt-NUL regression: the adapter returned `Grok CLI could not be started.` with exit code `1`, because Node rejected the NUL-containing argv before the fake Grok CLI ran.

### Green / focused

`npm test -- tests/adapter/grok-cli.test.ts` passed: 1 file / 5 tests. The fake Grok CLI received a combined prompt with NUL removed from both system and user sections and returned `ok`.

### Commit and files

- Commit: `fix: sanitize Grok CLI argv prompts` (this commit).
- Files: `src/adapter/grok-cli.ts`, `tests/adapter/grok-cli.test.ts`, `.superpowers/sdd/task-3-report.md`.

### Concern

- No unresolved concern. This deliberately removes only NUL (the value unsupported by Node argv); all other prompt text is preserved.

## Final review follow-up — Grok CLI model NUL argv

### Red

`npm test -- tests/adapter/grok-cli.test.ts` failed after adding the model-NUL regression: the adapter returned `Grok CLI could not be started.` with exit code `1`, so the fake CLI did not execute. Node rejected the NUL-containing model argv value before process startup.

### Green / focused

`npm test -- tests/adapter/grok-cli.test.ts` passed: 1 file / 6 tests. The fake Grok CLI executed and received `grok-4.5` for configured `model: 'grok\0-4.5'`.

### Change

- Applied the existing `stripNul` rule to the model immediately before it is added to the argv array.

### Concern

- No unresolved concern. Only NUL is removed, preserving all other model text and the existing process-error contract.
