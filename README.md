# researcher

> [中文版 →](./README.zh-CN.md)

Per-topic research CLI. Turns a git repo into a live research notebook: ingests
papers, maintains a working thesis, a research-landscape document, and a
thesis-driven report — and opens a PR for every update so the human stays in
the loop via diff review.

The CLI itself does not call any LLM. It assembles methodology + project
context into prompts and shells out to a headless agent runtime (Claude Code
today; Codex slot reserved). All persistent state — thesis, notes, landscape,
report, seen-set — lives in the topic repo as plain files under git.

## Why

Most "AI literature review" tools optimize for breadth: list papers, cluster
them, summarize them. This tool optimizes for a *sharpening thesis*. The
working thesis in `.researcher/thesis.md` is the spec; every paper read is
forced to either reinforce, refine, or contradict it; and the apparatus
(`report.md`, the landscape, per-paper notes) exists to make that thesis
challengeable, not to summarize the literature for its own sake.

You stay in the loop by reviewing diffs in PRs, not by chatting with an agent.

## Status

Implemented:
- `init` — scaffold `.researcher/`
- `onboard` — interactive TUI to draft `project.yaml` + `thesis.md`
- `add <arxiv-id | arxiv-url>` — manually deep-read one paper end-to-end
- `run` — autonomous tick: discover → triage → (deep-read pick) → synthesize → package
- `methodology install / show / edit` — manage the portable methodology bundle

Not yet wired: focused-instruction mode (manual override of triage decisions).

## Install

```sh
npm install
npm run build
npm link        # exposes the `researcher` binary
researcher methodology install   # one-time, populates ~/.researcher/methodology
```

Requires:
- `claude` CLI on `PATH` (the agent runtime). Override with `RESEARCHER_CLAUDE_BIN`.
- `gh` CLI authenticated (for `gh pr create`). Set `RESEARCHER_NO_REMOTE=1` to
  skip push + PR (useful for local-only topic repos).
- `pdftotext` (poppler) for PDF extraction. Falls back to abstract if missing.

## Quick start

In a fresh git repo for your research topic:

```sh
git init
researcher onboard      # 6-question TUI → drafts project.yaml + thesis.md
researcher run          # autonomous tick: discover, triage, deep-read one, synthesize, PR
```

`onboard` asks 6 questions (2 required, 4 optional), uses the agent runtime to
rewrite your answers into `.researcher/project.yaml` + `.researcher/thesis.md`,
shows a diff for review, and creates the initial commit.

`run` is the primary autonomous loop. Each tick:
1. discovers candidate papers from `project.yaml` sources,
2. triages them against the current thesis,
3. picks at most one for deep-reading,
4. produces / updates the per-paper note, the landscape, and `report.md`,
5. commits to a `researcher/<run-id>` branch and opens a draft PR.

For power users who prefer to wire things by hand:

```sh
git init
researcher init                      # scaffold .researcher/ from templates
# edit .researcher/project.yaml      — research questions, sources, scope
# edit .researcher/thesis.md         — your working hypothesis
researcher add 2401.12345            # or: researcher add https://arxiv.org/abs/2401.12345
```

`add` runs four stages — bootstrap → read → synthesize → package — then
creates a `researcher/<run-id>` branch with two commits (note + landscape, then
state updates) and opens a draft PR.

## Layout

```
<topic-repo>/
├── .researcher/
│   ├── project.yaml             # structured project soul
│   ├── thesis.md                # working hypothesis (human-edited; the spec)
│   └── state/
│       ├── seen.jsonl           # dedup ledger (committed)
│       ├── watermark.json       # last-run marker (committed)
│       └── runs/<id>/           # local-only stage logs (gitignored)
├── notes/
│   ├── 00_research_landscape.md # living survey, append-only structure
│   ├── 01_<slug>.md             # per-paper note (claims / weaknesses / …)
│   └── 02_<slug>.md
├── papers/                      # downloaded PDFs + papers/README.md index
├── references/                  # optional: product / design docs that ground the thesis
├── report.md                    # thesis-driven evidence apparatus, regenerated each run
└── README.md                    # workshop curation: thesis summary + paper table
```

`thesis.md` is the spec. `report.md` is its working implementation — every
section anchors to a thesis claim, design goal, or falsifiability point, never
to "what each paper says." See `methodology/06-writing.md` for the discipline.

## Commands

| Command | What it does |
|---|---|
| `researcher init` | Scaffold `.researcher/` at the repo root |
| `researcher onboard` | Interactive TUI to draft `project.yaml` + `thesis.md` |
| `researcher add <arxiv-id\|url>` | Deep-read one paper end-to-end (4-stage pipeline) |
| `researcher run` | Autonomous tick: discover + triage + (deep-read) + synthesize + package |
| `researcher methodology install` | Copy methodology files to `~/.researcher/` |
| `researcher methodology show` | Print currently installed methodology |
| `researcher methodology edit <name>` | Open a methodology file in `$EDITOR` |
| `researcher version` | Print version |

## Environment

- `RESEARCHER_CLAUDE_BIN` — path to `claude` if not on `PATH`.
- `RESEARCHER_NO_REMOTE=1` — skip `git push` and `gh pr create` (local-only mode).

## Methodology

Seven disciplines, lived as portable markdown under `methodology/` in this
repo:

1. `01-reading.md` — how to read a paper (claims / mechanisms / weaknesses)
2. `02-source.md` — where signal comes from
3. `03-filtering.md` — triage against the thesis
4. `04-synthesis.md` — graph-shaped landscape + supersedes/contradiction relations
5. `05-verification.md` — falsifiability discipline
6. `06-writing.md` — workshop curation, thesis-driven `report.md`
7. `07-cadence.md` — when to run, when to step away, when to revise the thesis

`onboarding.md` defines the 6-question intake.

`researcher methodology install` copies these to `~/.researcher/methodology/`
so the bundle is shared across topics. Edit them with `researcher methodology
edit <name>`. See `docs/superpowers/specs/2026-04-26-researcher-cli-design.md`
for the full design.

## Development

```sh
npm test          # vitest, single run
npm run test:watch
npm run lint
npm run format
```

Topic-repo integration tests live under `tests/pipeline/` and use real `git`
in `os.tmpdir()` plus stubbed agent runtimes.
