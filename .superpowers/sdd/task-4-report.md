# Task 4 report — Researcher #117 cross-repository verification

## Cross-repository test

Added `tests/integration/discover-milkie-cross-repo.test.ts`. The test is explicitly opt-in: it runs only when `RESEARCHER_CROSS_REPO_MILKIE_CLI` names an executable, built Milkie CLI. Otherwise the suite is skipped, so normal Researcher/CI test runs do not depend on an author-local Milkie checkout.

When enabled, it creates a temporary initialized Researcher topic, starts a local deterministic OpenAI-compatible HTTP provider, and invokes the supplied Milkie CLI through `MilkieAdapter`. The fake provider makes twelve sequential `run_command` requests. The eleventh writes valid `discover-candidates.json`; the twelfth is a no-op. A separate tool-free triage request returns valid `triaged.json` content. The test reads the real CLI JSONL traces from the temporary topic's `.milkie/runs/` directory and groups them by `agent.run.started.payload.agentId`.

Green assertions observed:

- collect provider requests: 13 (12 tool turns plus final completion)
- collect trace `tool.requested`: 12
- collect trace `TOOL_CALL_BUDGET_EXCEEDED` responses: 0
- triage provider requests: 1
- triage trace `tool.requested`: 0
- Researcher host wrote the run-local `triaged.json`

## TDD and portability evidence

Before the gate, hiding the built CLI and running without cross-repository environment variables failed the otherwise unconditional test at `expect(existsSync(MILKIE_BIN)).toBe(true)`. This proves the author-local default was a real CI portability defect, not a theoretical concern.

After adding the gate, the unset command succeeds with the integration test skipped:

```sh
env -u RESEARCHER_CROSS_REPO_MILKIE_CLI npx vitest run tests/integration/discover-milkie-cross-repo.test.ts
```

Observed: 1 test file skipped, 1 test skipped.

Red command (real CLI explicitly enabled):

```sh
RESEARCHER_CROSS_REPO_MILKIE_CLI=/Users/xupeng/dev/github/milkie/.worktrees/feat-117-discover-tool-budget/dist/cli/index.js \
RESEARCHER_CROSS_REPO_COLLECT_BUDGET=11 \
npx vitest run tests/integration/discover-milkie-cross-repo.test.ts
```

Observed expected failure: the twelfth collect call was recorded as one `TOOL_CALL_BUDGET_EXCEEDED` response, while the test requires zero. This demonstrates the test observes the runtime budget outcome rather than a mocked/in-process fixture.

Green command (real CLI explicitly enabled):

```sh
RESEARCHER_CROSS_REPO_MILKIE_CLI=/Users/xupeng/dev/github/milkie/.worktrees/feat-117-discover-tool-budget/dist/cli/index.js \
npx vitest run tests/integration/discover-milkie-cross-repo.test.ts
```

Observed: 1 test file passed, 1 test passed.

## Required full verification

Milkie, in `/Users/xupeng/dev/github/milkie/.worktrees/feat-117-discover-tool-budget`:

```sh
npm run build
npm test -- --runInBand
```

Observed: build passed; unit suites 6/6 with 89/89 tests; deterministic e2e suites 2/2 with 7/7 tests.

Researcher, without the opt-in CLI variable:

```sh
env -u RESEARCHER_CROSS_REPO_MILKIE_CLI npm test
```

Observed: 72/73 test files passed and 1/73 skipped; 484/485 tests passed and 1/485 skipped.

## Integration limitation

The actual cross-repository scenario requires a caller-provided, built, executable Milkie CLI. It performs no network access and uses no real model. This intentional opt-in boundary keeps the ordinary suite portable while preserving a deterministic real-runtime verification command.

## Commit

Researcher changes are committed as `feat: isolate discover triage context`. No push or PR was performed.
