# `researcher onboard` — Design

**Date:** 2026-04-27
**Status:** Draft (pending user review)
**Author:** brainstorm session, Opus 4.7

## 1. Summary

A new CLI command `researcher onboard` that takes a user from "I have an idea for a research topic" to "git repo is initialized, `project.yaml` and `thesis.md` are filled in, ready for `researcher add`". It runs as a one-shot interactive TUI: asks a small set of structured questions sourced from a new methodology document `~/.researcher/methodology/onboarding.md`, batch-rewrites the user's rough answers into properly formatted YAML and markdown via a single call to the agent runtime, presents a diff preview for confirmation, then writes the files and creates an initial commit.

Motivation: today the only entry point is `researcher init`, which scaffolds empty templates and leaves the user staring at a blank `project.yaml`. The "what is a good research question / what is taste / what should taste look like" knowledge is implicit. `onboard` makes that knowledge explicit and elicitable through guided dialog.

## 2. Goals & Non-goals

**Goals**

- One command, `researcher onboard`, takes a fresh directory to a fully initialized topic repo with a single initial commit.
- Interactive TUI experience (Ink-based) with multiple-choice + free-text questions, "skip" affordance for optional questions, and final diff review.
- Onboarding question script lives as a methodology document (`onboarding.md`), editable by the user, consistent with the existing seven-discipline methodology pattern.
- Reuses the existing agent runtime adapter (`claude` CLI in headless mode); no new LLM credentials or configuration.
- Fail-fast on any LLM failure — never half-write files, always preserve the user's raw answers in a recoverable dump.

**Non-goals**

- Not a re-onboarding flow. If `.researcher/` already contains user-edited content, the command refuses. Re-calibration is a future, separate command.
- Not adaptive dialog. Question script is static; LLM is used only for batch rewriting at the end. No probing follow-ups, no per-question LLM calls.
- Not a multi-session resumable wizard. Onboarding is one continuous session. Ctrl-C discards.
- Not a paper-discovery flow. The optional first-paper tail just calls `researcher add` with a user-supplied arxiv id; it does not search.

## 3. User journey

```
mkdir ~/dev/github/research-agent-decision
cd research-agent-decision
researcher onboard
```

1. **Pre-flight checks** (sync, fast, fail loud)
   - `claude` CLI resolvable on PATH (or `RESEARCHER_CLAUDE_BIN`)
   - `~/.researcher/methodology/onboarding.md` exists
   - Current directory is a git repo, OR the user accepts an inline `git init`
   - No existing `.researcher/` with user content (see §6 for the "all-templates" detection rule)

2. **Scaffold** (idempotent for the all-templates case)
   - Reuse `runInit`'s internal kernel to copy templates into `.researcher/`
   - At this point the repo is in the same state as if the user had run `researcher init`

3. **TUI session**
   - Load `onboarding.md`, parse into `Question[]`
   - Render questions one screen at a time; required questions cannot be skipped, optional questions default to a highlighted "skip for now"
   - User can navigate back to previous questions before submission
   - On final submit, collect `Answer[]` in memory

4. **Batch rewrite** (single LLM call)
   - Compose prompt: methodology body + style guide + raw answers + current template contents
   - Shell out to `claude` headless via existing adapter
   - Parse response into `{ projectYaml: string, thesisMd: string }`

5. **Diff review**
   - TUI shows two diffs side-by-side (template → rewritten) for `project.yaml` and `thesis.md`
   - Three actions: `[a] accept` / `[r] re-answer Q<n>` (jump back into TUI at that question) / `[x] abort`

6. **Commit**
   - Write files to disk
   - `git add .researcher/ notes/ .gitignore` (and any other scaffold files)
   - `git commit -m "researcher: onboard <topic-slug>"` (slug derived from Q1 answer)
   - On commit failure: leave files in working tree, print actionable error, exit non-zero. Files are never rolled back.

7. **Optional first-paper tail**
   - Prompt: `feed first arxiv id now? (paste id or press enter to skip)`
   - If provided, invoke `runAdd` programmatically with that id
   - This step is outside the onboarding methodology — it's a UX convenience, not part of the rewrite

## 4. The `onboarding.md` methodology document

Lives at `methodology/onboarding.md` in this repo, installed to `~/.researcher/methodology/onboarding.md` by `researcher methodology install`. Becomes the eighth discipline in the methodology set.

### 4.1 Schema

```markdown
---
version: 1
target_files:
  - project.yaml
  - thesis.md
---

# Onboarding Questions

## Q1 — topic_oneline
Required: true
Field: project.yaml > meta.topic_oneline
Question: "Describe your topic in one sentence — what is the artifact, who is the decision-maker, what's at stake?"
Note: also seeds the LLM rewrite of thesis.md's `## Working thesis` paragraph, alongside Q2 and Q5.
Style: declarative, concrete, name a domain.
Examples (good):
- "Decision-making policies inside LLM agents — when an agent should ask, plan, act, or escalate."
- "Trace-level observability signals for production AI agents."
Examples (bad):
- "AI agents." (too broad)
- "Decision agent stuff." (vague)

## Q2 — research_questions
Required: true
Field: project.yaml > research_questions[]
Question: "List 2-4 falsifiable research questions. Each should start with 'How' / 'When' / 'Whether'."
Min: 2
Max: 4
Style: each question must be answerable by reading papers; avoid yes/no questions about future predictions.
Examples (good):
- "How do current agent frameworks decide between asking the user vs acting autonomously?"
- "Whether decision-quality benchmarks correlate with deployment outcomes."
Examples (bad):
- "What is the future of AI?" (not falsifiable)
- "Is GPT-5 better at decisions?" (not literature-driven)

## Q3 — inclusion_criteria
Required: false
Field: project.yaml > inclusion_criteria[]
Question: "What must a paper have to be worth deep-reading?"
Style: concrete, observable signals.

## Q4 — exclusion_criteria
Required: false
Field: project.yaml > exclusion_criteria[]; thesis.md > `## Anti-patterns`
Question: "What kinds of papers do you intentionally reject?"
Style: name the failure mode, not the surface keyword.

## Q5 — taste
Required: false
Field: thesis.md > `## Taste`
Question: "List 3-5 preferences for what counts as a 'good' paper in this topic."
Min: 3
Max: 5
Style: each should be opinionated and falsifiable by a counter-example.

## Q6 — seed_keywords
Required: false
Field: project.yaml > sources[0].queries[]
Question: "What arXiv search keywords would surface the right papers?"
Style: 2-6 concrete phrases; avoid single common words.
```

### 4.2 Parser

`src/onboard/schema.ts` parses this with a small hand-written reader:
- YAML frontmatter via existing yaml dep
- Split body on H2 (`## Q<n> — <field_id>`)
- Within each block, a fixed set of keyed lines (`Required:`, `Field:`, `Question:`, `Style:`, `Min:`, `Max:`) plus `Examples (good):` / `Examples (bad):` lists
- Schema errors throw with file:line: `onboarding.md schema error at Q3 (line 42) — missing 'Field:' line`

No general markdown AST library. The format is constrained enough that regex + line-by-line is clear and easy to error-report.

## 5. Module layout

New code lives under `src/onboard/`:

| File | Purpose | Depends on |
|---|---|---|
| `src/onboard/schema.ts` | parse `onboarding.md` → `Question[]` | yaml |
| `src/onboard/state.ts` | `Answer[]` collection, "skipped" tracking, diff helpers | none |
| `src/onboard/rewrite.ts` | compose prompt, call adapter, parse response into `{projectYaml, thesisMd}` | `src/adapter/` |
| `src/onboard/tui.tsx` | Ink components: `<App>`, `<QuestionScreen>`, `<DiffReview>`, `<FinalConfirm>` | ink, react |
| `src/onboard/persist.ts` | write files + git commit + write `state/runs/onboard-<ts>/` log | execa, node:fs |
| `src/commands/onboard.ts` | command entrypoint, orchestrates pre-flight → scaffold → TUI → rewrite → persist | all of the above |

Refactoring required in existing code:
- `src/commands/init.ts` — extract a `scaffoldTopicRepo({ targetDir })` function from `runInit` so `onboard` can call it without going through the CLI surface. `runInit` itself becomes a thin wrapper around the kernel.
- `templates/project.yaml` — add an empty `meta:` section (with `topic_oneline:` placeholder) so Q1 has a defined home and the all-templates check (§6.2) sees a stable byte-level reference.

New dependencies (production): `ink`, `react`. Dev: `@types/react`, `ink-testing-library`. All MIT-licensed.

The CLI surface gains one new command:

```ts
program
  .command('onboard')
  .description('Interactive TUI to scaffold and fill in a new topic')
  .action(async () => {
    const { runOnboard } = await import('./commands/onboard.js');
    await runOnboard({ cwd: process.cwd() });
  });
```

## 6. Pre-flight & re-run rules

### 6.1 Detection

Before entering the TUI, `onboard` runs in this order:

1. Resolve `claude` binary; fail with `error: claude CLI not found; install it or set RESEARCHER_CLAUDE_BIN`.
2. Check `~/.researcher/methodology/onboarding.md` exists; fail with `error: onboarding methodology missing; run \`researcher methodology install\``.
3. Resolve git toplevel of cwd. If not a git repo, prompt `not a git repo; run \`git init\` here? [Y/n]`. On `Y` run `git init` in cwd. On `n` exit.
4. If `.researcher/` does not exist → proceed to scaffold.
5. If `.researcher/` exists → run the **all-templates check** (see 6.2).

### 6.2 All-templates check

Compares each scaffolded file against its packaged template byte-for-byte:

- `.researcher/project.yaml`
- `.researcher/thesis.md`
- `.researcher/.gitignore`
- `.researcher/state/seen.jsonl` (must be empty)

If every file matches the template exactly → treat as "scaffold from a previous aborted onboard"; proceed to TUI without re-scaffolding. If any file differs → refuse with `error: .researcher/ already contains user content; edit files manually or remove .researcher/ to re-onboard`.

This makes Ctrl-C safe: scaffolded files were never user-edited, so a subsequent `researcher onboard` picks up cleanly.

## 7. Failure handling

Strict fail-fast at every LLM-touching boundary.

| Failure | Behavior |
|---|---|
| `claude` returns non-zero / times out | dump raw answers to `/tmp/researcher-onboard-<ts>.json`, print error including dump path, exit 1 |
| Response is not parseable as expected (missing project.yaml block, missing thesis.md block) | same as above |
| Returned YAML fails to parse | same as above |
| User selects abort in diff review | exit 0, no files written |
| Ctrl-C in TUI | confirm `discard answers and exit? [y/N]`; on yes exit 0, no files written |
| Git commit fails (hooks, signing, etc.) | files remain in working tree, print error suggesting manual `git add . && git commit`, exit 1 |

Explicitly **not** supported:
- LLM retry-in-TUI (one shot only — re-run the command)
- Plain-template-substitution fallback (would defeat the purpose of LLM rewriting)
- File rollback on commit failure (user's content is never destroyed)

## 8. Persistence & logging

Every onboard run, success or failure, writes a per-run directory under `.researcher/state/runs/onboard-<timestamp>/` (gitignored, local-only, same convention as `add`):

| File | Contents |
|---|---|
| `answers.json` | every Question + Answer, including skip markers |
| `prompt.txt` | full prompt sent to `claude` |
| `response.txt` | raw response from `claude` (pre-parse) |
| `result.json` | `{ status: "ok" \| "rewrite_failed" \| "schema_invalid" \| "user_aborted", error?: string }` |

Purpose:
- Debug onboard's own prompt during early dogfooding iterations
- Provide raw material for iterating `onboarding.md` v2 after real-world topic onboarding
- Recover answers if commit fails or user aborts (manually copy from `answers.json`)

Not persisted: TUI mid-session state (no resume), git-derivable state (the onboard commit is its own marker).

## 9. Testing strategy

| Layer | Test type | Approach |
|---|---|---|
| `schema.ts` | unit | fixture `.md` files (valid + each error mode); assert parsed `Question[]` or thrown error message |
| `state.ts` | unit | answer collection, skip semantics, diff calculation |
| `rewrite.ts` | unit | inject fake adapter; assert prompt composition is correct; assert response parsing handles malformed input |
| `tui.tsx` | component | `ink-testing-library`; simulate keystrokes through Q1→Q6 + diff review; stub rewrite |
| `commands/onboard.ts` | integration | follow `tests/pipeline/` pattern: real `git` in `os.tmpdir()`, stubbed agent runtime, assert final repo state (file content + commit) |

End-to-end smoke test (post-implementation, manual): use `researcher onboard` to set up the user's actual `decision-agent` topic. The dogfood run is the acceptance test.

## 10. Open questions deferred to implementation

- Exact Ink layout (single-pane vs split-pane diff) — pick during implementation, low design risk.
- Whether to add a `--dry-run` flag that runs the full TUI but skips the commit. Optional addition; not in v1 unless the dogfood reveals a need.
- Whether `onboarding.md` should support i18n later. The methodology is markdown — users can fork their own translation.

## 11. Out of scope (future work)

- `researcher recalibrate`: re-run onboarding-style dialog against an existing topic to update thesis after substantial reading.
- Auto-suggesting seed keywords / first papers based on Q1+Q2 (would require search integration).
- Cross-topic methodology that adapts onboarding questions per-topic-type (e.g., systems-research vs ML-research templates).
- Schema versioning beyond v1 (deferred until v2 is needed).
