# Design: workspace-aware `run` + CHARTER anchoring

> Issue: xforce-io/researcher#9 · Structure side: xforce-io/agent-harness-research#11
> Status: implemented on `feat/9-workspace-run`.

## Problem

The agent-harness research matrix is a **submodule super-repo** (`research-harness`)
over per-pillar topic repos. Without tool support, advancing research means `cd`-ing
into each submodule and running `researcher run` by hand. We want: from the super-repo
root, **one command advances every "actively researched" topic; the rest are untouched** —
and each pillar's research stays **anchored to a shared CHARTER** so independent submodules
don't drift apart.

## Design

A thin orchestration layer over the existing per-topic `run`. The real work still happens
inside each submodule's native pipeline (its own `main` / PR / seen-set). N clean topic repos
+ one thin orchestrator = zero git conflicts.

### 1. Workspace manifest — `researcher.workspace.yml`

Lives at the super-repo root; the single control panel.

```yaml
version: 1
topics:
  - { path: trace,    active: true }
  - { path: decision, active: false }
```

`path` = submodule directory; `active` defaults to `false`. Sub-repo URLs come from
`.gitmodules`, not duplicated here. Parsed/validated by `src/workspace/manifest.ts`
(zod, mirrors `config/project-yaml.ts`); duplicate paths and `version != 1` are rejected.

### 2. Detection (`researcher run`, no new command)

In `src/cli.ts`:
- cwd has `.researcher/` → **single-topic** tick (unchanged). A topic repo always wins.
- else cwd has `researcher.workspace.yml` → **workspace** orchestration.
- else → existing error.

### 3. Orchestration — `src/workspace/orchestrator.ts`

`runWorkspace({ cwd, adapter?, runTopic? })`:
- Load manifest; read `<cwd>/CHARTER.md` if present.
- For each **active** topic, **serially**:
  - validate the submodule dir + its `.researcher/` exist (else record an `error` result and continue);
  - sync the CHARTER slice into `<topic>/.researcher/charter.md` (best-effort);
  - run the topic via `runTopic` (default `runRun`), recording the `RunResult.outcome`.
- **One topic failing never aborts the rest** — errors are caught per topic and collected.
- Print a summary table; return `{ topics, dormant }`.
- `runTopic` is injectable for tests (DI); `dormant` topics are never iterated.

`runRun` now returns `RunResult { outcome, runId }` (`completed | no-candidate | thin-signal |
no-queries`) so the summary can classify each topic without parsing stdout.

### 4. CHARTER anchoring + drift (bidirectional, soft)

`CHARTER.md` (in the super-repo) = shared invariants core + one `### \`<pillar>\`` excerpt each.
Slicing contract (`src/workspace/charter.ts`): **shared core = everything before the first
`### ` heading; a pillar excerpt = the `### ` block whose heading contains `` `<path>` ``**.
So `### ` is reserved for per-pillar excerpts. A topic's synced slice = shared core + its own
excerpt, written with an `AUTO-SYNCED … do not edit here` header.

- **Core injection (benefits all topics, incl. standalone runs):** `bootstrap` loads
  `<researcherDir>/charter.md` into `ctx.charter`; `discover_triage` and `synthesize` inject it
  into their prompts (`{{charter}}`). A topic run inside a submodule is anchored even without
  the orchestrator. Missing charter → a neutral placeholder (back-compat for non-matrix repos).
- **Sync:** the orchestrator refreshes each active topic's `charter.md` before its tick. It is a
  **derived, gitignored artifact** (the `init` template ignores `charter.md`) — single source of
  truth is the super-repo `CHARTER.md`, so the topic copy is ephemeral and re-synced each tick,
  never committed into the topic repo. Existing topics need `charter.md` added to their
  `.researcher/.gitignore`.
- **Drift:** `synthesize` is told to also surface tensions *against the charter* into
  `contradictions.md` under `## Charter tension: <title>`. `classifyContradictions` detects it
  (`hasCharterTension`) and `run` prints a soft, **non-blocking** notice. It is **bidirectional**:
  may mean the pillar drifted, or the CHARTER itself needs updating — a human adjudicates.

## Surface area

New: `src/workspace/{manifest,charter,orchestrator}.ts` + `tests/workspace/*`.
Touched: `cli.ts` (detection), `commands/run.ts` (`RunResult`), `pipeline/context.ts` +
`bootstrap.ts` (charter load), `pipeline/discover_triage.ts` + `synthesize.ts` (+ prompt
templates) (charter injection), `pipeline/contradictions.ts` (charter-tension classification).

## Edge cases

- Submodule dir missing (not `git submodule update`-d) → `error`, continue.
- Active topic without `.researcher/` → `error`, continue.
- Detached-HEAD submodules: the existing `package.ts` `checkout main` handles it; a sub-repo
  with no local `main` fails that topic and the orchestrator continues.
- Serial only — no concurrency (matches "one by one"; keeps PR output readable).

## YAGNI (explicitly out of scope)

- No super-repo commit, no submodule-pointer bump, no super-repo PR (pointer sync stays a
  future explicit step, possibly `researcher workspace sync`).
- Charter sync only happens inside workspace run; no standalone `charter sync` command.
- Drift is surfaced only — no auto-reconcile, no version-stamp checking.

## Testing

`tests/workspace/manifest.test.ts` (parse/validate/active filter/dups),
`charter.test.ts` (slice shared core + excerpt, missing pillar, sync no-op without `.researcher/`),
`orchestrator.test.ts` (active-only in order, dormant untouched, charter synced, error isolation,
missing-dir handling — via injected `runTopic`). Plus charter-tension cases in
`tests/pipeline/contradictions.test.ts`. Full suite green (170).
