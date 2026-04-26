# Cadence Discipline

## Default interval

In autonomous mode, the researcher runs every 7 days. This default is read from `project.yaml: cadence.default_interval_days`. A project can override it:

```yaml
cadence:
  default_interval_days: 14   # slower: stable field, low paper volume
```

Manual invocations (`researcher run`, `researcher add`) ignore the interval entirely and execute immediately. Cadence rules apply only to scheduled autonomous runs.

A 7-day interval is chosen to match the arXiv weekly listing rhythm and to avoid redundant runs in fields where new relevant papers appear at most a few times per week. For fast-moving fields (e.g., LLM scaling, code generation), set `default_interval_days: 3`.

## Backoff

After N consecutive autonomous runs that produce no PR — because all candidates were filtered at triage, or no new candidates were discovered — skip the next scheduled run.

N is `project.yaml: cadence.backoff_after_empty_runs`. Default: 3.

```yaml
cadence:
  backoff_after_empty_runs: 3
```

**Reset rule:** the backoff counter resets to 0 immediately after any run that produces a PR, regardless of how many empty runs preceded it.

**Doubling rule:** each successive empty run beyond N doubles the skip count. After 3 empty runs → skip 1 interval. After 4 empty runs → skip 2 intervals. After 5 → skip 4. Cap at 8 skipped intervals to prevent indefinite suspension.

The backoff log is written to `.researcher/state/runs.jsonl` alongside the run record. A human can inspect it to understand why the researcher went quiet.

**Do not backoff after `researcher run` or `researcher add`.** Backoff applies only to the autonomous schedule. A manual run always executes and does not increment the empty-run counter.

## Plan 1 status note

Autonomous scheduling is implemented in Plan 2. In Plan 1, only `add` mode is live: `researcher add <arxiv-id>` triggers a single-paper pipeline run immediately. Cadence rules do not fire in Plan 1 because there is no scheduler.

This file is authored in Plan 1 so that:
1. The methodology is complete and consistent before the scheduler is wired.
2. Plan 2 can import these rules directly without revisiting the methodology layer.

When Plan 2 implements the scheduler, it reads `cadence.default_interval_days` and `cadence.backoff_after_empty_runs` from `project.yaml` and applies the rules described here. No methodology change should be needed at that point.

If you are running in Plan 1 mode and this file is loaded into your context, cadence rules are informational only. Do not attempt to schedule future runs or manage the backoff counter — those primitives do not exist yet.
