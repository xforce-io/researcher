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
