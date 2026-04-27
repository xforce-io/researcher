# researcher

Per-topic research CLI. Turns a git repo into a live research notebook: ingests
papers, maintains a working thesis and a research-landscape document, and opens
a PR for every update so the human stays in the loop via diff review.

The CLI itself does not call any LLM. It assembles methodology + project
context into prompts and shells out to a headless agent runtime (Claude Code
today; Codex slot reserved). All persistent state — thesis, notes, landscape,
seen-set — lives in the topic repo as plain files under git.

## Status

`init`, `onboard` (interactive TUI), `add <arxiv_id>`, and autonomous `run`
(discover + triage + read + synthesize + package) are implemented. Manual
focused-instruction mode is not yet wired.

## Install

```sh
npm install
npm run build
npm link        # exposes the `researcher` binary
researcher methodology install   # one-time, populates ~/.researcher/methodology
```

Requires:
- `claude` CLI on `PATH` (for the agent runtime). Override with
  `RESEARCHER_CLAUDE_BIN`.
- `gh` CLI authenticated (for `gh pr create`). Set `RESEARCHER_NO_REMOTE=1` to
  skip push + PR (useful for local-only topic repos).
- `pdftotext` (poppler) for PDF extraction. Falls back to abstract if missing.

## Quick start

In a fresh git repo for your research topic:

```sh
git init
researcher onboard
```

`onboard` walks you through 6 questions (2 required, 4 optional), uses
the agent runtime to rewrite your answers into `project.yaml` + `thesis.md`,
shows a diff for review, and creates the initial commit.

For power users who want to fill the templates manually:

```sh
git init
researcher init
# edit .researcher/project.yaml — research questions, sources, scope
# edit .researcher/thesis.md   — your working hypothesis
researcher add 2401.12345
```

Each `add` runs four stages — bootstrap → read → synthesize → package — then
creates a `researcher/<run-id>` branch with two commits (note + landscape, then
state updates) and opens a draft PR.

## Layout

```
<topic-repo>/
├── .researcher/
│   ├── project.yaml             # structured project soul
│   ├── thesis.md                # working hypothesis (human-edited)
│   └── state/
│       ├── seen.jsonl           # dedup ledger (committed)
│       ├── watermark.json       # last-run marker (committed)
│       └── runs/<id>/           # local-only stage logs (gitignored)
└── notes/
    ├── 00_research_landscape.md # living survey, append-only structure
    ├── 01_<slug>.md             # per-paper note (claims / weaknesses / …)
    └── 02_<slug>.md
```

## Commands

| Command | What it does |
|---|---|
| `researcher init` | Scaffold `.researcher/` at the repo root |
| `researcher methodology install` | Copy methodology files to `~/.researcher/` |
| `researcher methodology show` | Print currently installed methodology |
| `researcher methodology edit <name>` | Open a methodology file in `$EDITOR` |
| `researcher onboard` | Interactive TUI to scaffold a topic from scratch |
| `researcher add <arxiv-id>` | Run the 4-stage pipeline against a paper |
| `researcher version` | Print version |

## Methodology

Seven disciplines, lived as portable markdown under `methodology/` in this
repo. Installed into `~/.researcher/methodology/` so it's shared across topics.
See `docs/superpowers/specs/2026-04-26-researcher-cli-design.md` for design.

## Development

```sh
npm test          # vitest, single run
npm run test:watch
npm run lint
npm run format
```

Topic-repo integration tests live under `tests/pipeline/` and use real `git`
in `os.tmpdir()` plus stubbed agent runtimes.
