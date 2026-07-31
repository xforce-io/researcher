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
