# Researcher CLI — Design

**Date:** 2026-04-26
**Status:** Draft (pending user review)
**Author:** brainstorm session, Opus 4.7

## 1. Summary

A CLI tool that operates as a "live researcher" against a per-topic git repository. Each topic repo has an explicit *project soul* (research questions, scope, thesis, criteria). The researcher applies a fixed *methodology* (its own research style) to discover new material, read it, synthesize updates into a living survey/landscape document, and open a pull request for human review. The default mode is autonomous (cron-triggered); manual focused instructions and direct material feeds are also supported.

The contribution beyond generic deep-research tools is **stateful per-topic continuity**: the researcher remembers what has been seen, holds a working thesis, detects contradictions across runs, and surfaces every change as a reviewable git diff.

## 2. Goals & Non-goals

**Goals**

- A single researcher persona (methodology) that reads consistently across topics.
- Per-topic project state stored entirely in git, fully reviewable as PRs.
- Autonomous default mode (cron) + focused-instruction override + manual material feed — all sharing one pipeline.
- Runtime portability: MVP runs on Claude Code headless; future support for Codex via thin adapter.
- Methodology stored as portable markdown — single source of truth, not bound to any runtime.

**Non-goals**

- Not a multi-tenant SaaS. Single-user, local CLI.
- Not a generic deep-research wrapper for one-shot queries. Topic state is the point.
- Not a replacement for human judgment on thesis. Researcher reports contradictions; human decides whether thesis changes.
- Not a scheduler. cron / launchd / GitHub Actions handle scheduling externally.
- Not a UI / web app. CLI only. Optional CC slash-command plugin is post-MVP and out of scope here.

## 3. Two-layer architecture

| Layer | Scope | Storage | Reused across topics? |
|---|---|---|---|
| **Researcher** (methodology, persona) | how to do research | `~/.researcher/` global config | ✅ one set, shared |
| **Project** (topic, thesis, scope) | what is being researched | `<topic-repo>/.researcher/` | ❌ one per topic |

A topic repo is a normal git repo. Researcher writes commits on a feature branch and opens a PR. User reviews and merges.

## 4. Researcher methodology (the "soul")

Stored as plain markdown files in `~/.researcher/methodology/`. Loaded fresh on every run. Concatenated into the system prompt for the underlying agent runtime (CC for MVP).

Seven disciplines. The first four are **researcher-enforced** (project cannot opt out); the rest have researcher defaults that the project can override.

| # | Discipline | Enforcement | What it specifies |
|---|---|---|---|
| 1 | **Reading** | hard | Per-paper note skeleton: claims / assumptions / method / eval / weaknesses / relations |
| 2 | **Source** | default + project override | Search channels (arXiv, Semantic Scholar, OpenReview, GitHub, lab blogs), per-channel priority, dedup strategy |
| 3 | **Filtering** | default + project override | Relevance/priority scoring axes; deep-read / skim / reject thresholds |
| 4 | **Synthesis** | hard | How landscape gets updated: place new nodes, declare relations, dedupe, detect contradictions, citation hygiene |
| 5 | **Verification** | hard | Cross-check key claims against ≥2 sources; mark confidence; mandatory devil's-advocate pass before package |
| 6 | **Writing** | hard | PR title format; commit message conventions; tone (information-dense, no filler); diffs explain *why* not just *what* |
| 7 | **Cadence** | default + project override | Default run frequency; backoff when N consecutive runs find nothing meaningful |

File layout:

```
~/.researcher/
├── methodology/
│   ├── 01-reading.md
│   ├── 02-source.md
│   ├── 03-filtering.md
│   ├── 04-synthesis.md
│   ├── 05-verification.md
│   ├── 06-writing.md
│   └── 07-cadence.md
└── config.yaml          # global defaults (e.g. preferred LLM, gh auth, etc.)
```

Methodology files are version-controlled in *this* repo (the researcher's own repo) under `methodology/`. `~/.researcher/` is populated by `researcher methodology install` (or symlink during dev).

## 5. Project workspace layout

A topic repo gets a `.researcher/` directory:

```
<topic-repo>/
├── .researcher/
│   ├── project.yaml         # structured project soul
│   ├── thesis.md            # prose project soul
│   ├── state/
│   │   ├── seen.jsonl       # committed: dedup index across machines
│   │   ├── watermark.json   # committed: last-run time window
│   │   └── runs/            # gitignored: local run logs
│   └── .gitignore
├── README.md                # human-authored, researcher does not modify
├── papers/                  # researcher writes paper metadata; PDFs via gitignore
├── notes/
│   └── 00_research_landscape.md   # primary update target
└── ...
```

### 5.1 `project.yaml` (structured soul — hard constraints)

Researcher uses these for **machine-checkable filtering**.

```yaml
research_questions:
  - id: RQ1
    text: "How to triage agent trajectories without expensive LLM eval?"
  - id: RQ2
    text: "How to relabel failed trajectories into preference data?"
inclusion_criteria:
  - "Must address one of {RQ1..RQn}"
  - "Published or preprinted within the last 18 months unless seminal"
exclusion_criteria:
  - "Pure benchmark papers without methodological contribution"
sources:
  - kind: arxiv
    queries: ["agent trajectory", "trajectory triage", "..."]
    priority: high
  - kind: semantic_scholar
    seed_papers: ["<arxiv_id_of_signals_paper>"]
    follow: [citations, references]
paper_axes:
  - name: layer
    values: [infrastructure, triage, data_reconstruction, alignment, evaluation]
  - name: priority
    values: [P0, P1, P2]
cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
```

### 5.2 `thesis.md` (prose soul — soft constraints)

Free-form markdown with these sections:

- **Working thesis** — what the project currently believes; explicit and falsifiable.
- **Taste** — what counts as a good paper in this context (e.g., "favors lightweight signals over heavy LLM judgment").
- **Anti-patterns** — what the project intentionally rejects.
- **Examples** — pointers to existing notes that exemplify good/bad inclusion decisions.

Researcher uses this for **soft judgment**: e.g., when classifying a paper as `supports / extends / challenges / orthogonal` to the thesis, it grounds the call in `thesis.md` content.

### 5.3 State

- `seen.jsonl` — one line per encountered candidate (paper / link), with fields `{id, source, first_seen_run, decision, reason}`. Committed so dedup works across machines and CI runs. Reject decisions are recorded too.
- `watermark.json` — `{last_run_completed_at, last_run_window: {from, to}, last_run_id}`. Committed.
- `runs/<run_id>/` — local run logs and intermediate stage outputs. Gitignored.

## 6. Run pipeline

Six stages. Each stage's outputs land in `.researcher/state/runs/<run_id>/`. Each stage writes a `<stage>.start` and `<stage>.done` marker so a crashed run can resume.

| # | Stage | Inputs | Outputs | Methodology in play |
|---|---|---|---|---|
| 1 | **Bootstrap** | `~/.researcher/methodology/*` + `<topic>/.researcher/project.yaml` + `thesis.md` + last `watermark.json` | run context | all 7 loaded |
| 2 | **Discover** | `sources` config + time window or focused-instruction constraint | `candidates.jsonl` | source |
| 3 | **Triage** | candidates + RQs + criteria + thesis | `triage.md` (each candidate scored, decision: deep-read / skim / reject, with `why`) | filtering |
| 4 | **Read** | deep-read list → fetch PDF/HTML, parse | `notes/NN_<slug>.md` per reading template | reading |
| 5 | **Synthesize** | new notes + current `00_research_landscape.md` | landscape diff + `contradictions.md` | synthesis |
| 6 | **Verify + Package** | full diff | devil's-advocate pass; confidence labels; 2 commits + PR via `gh pr create` | verification + writing |

### 6.1 Three invocation modes — same pipeline

| Mode | CLI | Stage behavior |
|---|---|---|
| Autonomous (default) | `researcher run` | full 1→6, cron-triggered |
| Focused | `researcher run "look into AgentSeer follow-ups"` | full 1→6; instruction injected as additional constraint at stages 2 and 3 |
| Manual feed | `researcher add <arxiv_id\|pdf_path\|url>` | skip stage 2; triage at stage 3 is a confirmation pass; 4→6 normal |

### 6.2 Commit & PR shape

Two commits per PR:

- **C1** `research: <one-line summary>` — all new notes + landscape diff + any thesis-related edits
- **C2** `state: seen +N, watermark <timestamp>` — bookkeeping only

PR description holds:

- Run summary: candidates scanned, included, rejected (with reasons)
- Devil's-advocate pass: reverse-side critiques against new claims and against existing thesis
- Contradictions report: where new material conflicts with current thesis
- Run id (links to `runs/<run_id>/` for full local trace if user has it)

PR opens as **draft**. Researcher does not auto-promote to ready-for-review — user does.

### 6.3 Resume / failure

Each stage writes `.start` and `.done` markers. On startup, `researcher run` checks for an unfinished run:

- If found and within stale threshold (configurable, default 24h): refuses to start a fresh run; suggests `researcher resume`.
- If past threshold: marks run as abandoned, archives logs, starts fresh.

`researcher resume` re-enters at the first stage whose `.done` is missing. Stage outputs are designed to be deterministic functions of inputs + methodology, so resuming is safe.

## 7. CLI surface

```
researcher init                    # scaffold .researcher/ in current topic repo
researcher run                     # full autonomous pipeline
researcher run "<focused>"         # focused-instruction pipeline
researcher add <id|pdf|url>        # manual feed; skip discover
researcher status                  # last run, watermark, stuck stage
researcher resume                  # resume a stuck run
researcher dry-run                 # stages 1→5 without writing files or opening PR
researcher methodology show        # list active methodology files
researcher methodology edit <name> # open one for editing
researcher methodology install     # symlink/copy methodology files into ~/.researcher/
```

Explicit non-commands (YAGNI): no `daemon`, no standalone `search`, no in-CLI `review`.

## 8. Runtime adapter

### 8.1 MVP — Claude Code headless

`researcher run` orchestrates the 6 stages by invoking `claude` in headless mode (`-p` / non-interactive) at each stage. Each stage has a prompt template; the methodology files plus relevant project files are concatenated into the system prompt or piped via `--append-system-prompt`. Tool access (WebFetch, WebSearch, Read/Write/Edit, Bash for git/gh/pdftotext) is provided by CC out of the box.

The CLI itself does **no** LLM calls directly. It only orchestrates: reads files, builds prompts, spawns `claude`, parses output, manages state. Approx. 1500–2500 lines of TypeScript expected.

### 8.2 Future — Codex adapter

A second adapter that targets `codex` CLI. Same methodology files (markdown, portable) are written into the appropriate Codex location (`AGENTS.md` or instructions file) per Codex conventions; same stage prompts are sent. Stage outputs are parsed identically. Adapter selection via `~/.researcher/config.yaml: runtime: claude|codex` or `--runtime` flag.

This is **deferred**. MVP ships CC adapter only. Adapter interface designed from day 1 so adding Codex is additive, not refactoring.

### 8.3 Skills

Methodology files are **not** packaged as Claude Code skills. Skills are CC-specific; methodology must remain portable. A separate optional `researcher-cc` plugin (post-MVP, out of scope) may ship CC slash commands (e.g. `/researcher:add`) that shell out to the CLI; methodology stays markdown.

## 9. Distribution

- **Language**: TypeScript
- **Runtime**: Node 20+
- **Package manager**: npm
- **Distribution**: published as an npm package; `npx <pkg>` for trial, `npm i -g <pkg>` for permanent install
- **Dependencies**: `commander` (CLI), `execa` (subprocess for claude/git/gh), `simple-git` or shell-out, `zod` (config validation), `yaml`, `node:fs`. Avoid heavy frameworks.

Package name: TBD (`researcher` may be taken; consider scoped `@<handle>/researcher`). Resolved at first publish.

## 10. MVP scope cut

In MVP:

- ✅ Two-layer architecture (researcher + project)
- ✅ Methodology files (all 7 disciplines)
- ✅ `init / run / add / status / resume / dry-run / methodology *`
- ✅ Autonomous + focused + manual-feed modes
- ✅ 6-stage pipeline with checkpointing
- ✅ 2-commit PR with rich body
- ✅ CC adapter
- ✅ TS + npm

Deferred (post-MVP):

- ⏳ Codex adapter
- ⏳ `researcher-cc` slash-command plugin
- ⏳ Smart contradiction-resolution suggestions (MVP only flags contradictions; doesn't propose fixes)
- ⏳ Per-source rate limiting and quota management beyond crude defaults
- ⏳ Local LLM fallback for triage to save cost

## 11. Risks & open questions

- **CC headless stability for long runs.** A run can take 10–60 minutes depending on number of papers. CC headless mode's behavior under that duration (timeouts, context exhaustion, token cost) needs early validation. Mitigation: per-stage invocation (each stage is a separate `claude` call) limits per-call duration to a few minutes; checkpointing covers crashes.
- **Search source breadth vs. cost.** Aggressive arXiv + Semantic Scholar + Google Scholar scraping can be costly and rate-limited. MVP uses conservative defaults; project can opt in to more sources.
- **PR noise.** If autonomous runs find low-signal material weekly, PRs can pile up. Mitigation: cadence discipline's backoff rule (skip PR if no item passes triage).
- **Thesis drift.** Researcher should not silently update `thesis.md`. Decision: researcher only *reports* contradictions; never modifies `thesis.md` itself. Any thesis edit must be explicit human action.
- **Methodology calibration.** First few runs will likely produce PRs whose triage / synthesis decisions don't match user taste. Methodology files need iteration. The PR-review feedback loop is the calibration channel.
- **Dedup across reformatted IDs.** arXiv vs. proceedings vs. preprint URL — same paper, different IDs. `seen.jsonl` schema must include canonicalization (DOI when available, arxiv id, title-hash fallback).

## 12. Acceptance criteria for MVP

The MVP is complete when:

1. `researcher init` in `~/lab/research-agent-triage` scaffolds `.researcher/` correctly using existing `00_research_landscape.md` and notes as seed (assisted, not fully automatic, is acceptable).
2. `researcher add <arxiv_id>` for a previously unseen paper produces a PR with one new note in the reading template, a landscape update, contradictions report (if any), and devil's-advocate pass — all reviewable.
3. `researcher run` (autonomous) on the same repo, with sources configured, surfaces at least one new candidate, makes a triage decision with a recorded reason, and either opens a PR or skips with a logged reason.
4. A run that crashes mid-pipeline can be resumed via `researcher resume` without losing prior stages' work.
5. The same methodology files, unchanged, work for a second topic repo (smoke test of researcher/project separation).
