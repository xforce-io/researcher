# Task 2 report

## Implemented

- `RunDir.recordAgentFailure` now accepts the normalized failure properties from `InvokeResult`.
- Failure artifact headers retain `exitCode` and add `finishReason`, `errorCode`, and `errorMessage` only when their normalized source value exists.
- Existing stderr and 50-line stdout-tail sections remain below the summary header unchanged.
- Tests cover both enriched artifacts and legacy artifacts with no diagnostic header fields.

## TDD evidence

### Red

`npx vitest run tests/state/runs.test.ts tests/pipeline/runner.test.ts` exited `1`.

- `RunDir.recordAgentFailure > includes normalized diagnostics in the failure summary while preserving tails` failed as expected.
- The prior artifact contained `exitCode`, stderr, and stdout tail but lacked `finishReason: length`.

### Green

`npx vitest run tests/state/runs.test.ts tests/pipeline/runner.test.ts` exited `0`.

```text
Test Files  2 passed (2)
Tests       10 passed (10)
Duration    235ms
```

## Commit

`5ad0a24` — `fix: persist normalized failure diagnostics`

## Concerns

- Per the task constraint, verification was limited to the specified focused tests; no formatter, linter, typecheck, or project-wide suite was run.
