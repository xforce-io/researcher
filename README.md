# researcher

> [中文版 →](./README.zh-CN.md)

Per-topic research CLI. Turns a git repo into a live research notebook: ingests
papers, maintains a working thesis, a research-landscape document, and a
thesis-driven report — and opens a PR for every update so the human stays in
the loop via diff review.

A single topic is the atom. Several can be composed into a multi-pillar
**workspace** — a super-repo advanced from one root and browsable via
`researcher serve` — see [Workspace mode](#workspace-mode-multi-pillar).

The CLI itself does not call any LLM. It assembles methodology + project
context into prompts and shells out to a headless milkie agent runtime. All persistent state — thesis, notes, landscape,
report, seen-set — lives in the topic repo as plain files under git.

## Why

Most "AI literature review" tools optimize for breadth: list papers, cluster
them, summarize them. This tool optimizes for a *sharpening thesis*. The
working thesis in `.researcher/thesis.md` is the spec; every paper read is
forced to either reinforce, refine, or contradict it; and the apparatus
(`report.md`, the landscape, per-paper notes) exists to make that thesis
challengeable, not to summarize the literature for its own sake.

Each tick surfaces any contradictions the new paper raises against your
thesis or prior notes — that report is typically where the actual thinking
happens, not the per-paper summary. The loop closes because the thesis is
read into every triage prompt: as the thesis sharpens, what gets deep-read
next round shifts with it.

You stay in the loop by reviewing diffs in PRs, not by chatting with an agent.

## Examples

Two topic repos the author currently maintains with this tool — both public,
so their `report.md` is the most direct way to see what the pipeline actually
produces:

- **[research-agent-triage](https://github.com/xforce-io/research-agent-triage/blob/main/report.md)** — production agent trace triage
- **[research-agent-decision](https://github.com/xforce-io/research-agent-decision/blob/main/report.md)** — decision-agent layer for KWeaver

…and the **workspace** that stitches pillars like these together, advanced from
one root (see [Workspace mode](#workspace-mode-multi-pillar)):

- **[research-harness](https://github.com/xforce-io/research-harness)** — multi-pillar super-repo (trace / decision / data)

## Status

Implemented:
- `init` — scaffold `.researcher/`
- `onboard` — interactive TUI to draft `project.yaml` + `thesis.md`
- `add <arxiv-id | arxiv-url | http(s)-url>` — manually deep-read one paper or web source end-to-end
- `run` — autonomous tick: discover → triage → (deep-read pick) → synthesize → package; workspace-aware (at a super-repo root, advances every active pillar)
- `methodology install / show / edit` — manage the portable methodology bundle
- `serve [path]` — local web console over a workspace super-repo
- `papers trending | search | show | read` — heat-ranked digest / lookup / Library deep-read into the default workspace (`skills/papers/SKILL.md`)

Not yet wired: focused-instruction mode (manual override of triage decisions).

## Install

```sh
npm install
npm run build
npm link        # exposes the `researcher` binary
researcher methodology install   # one-time, populates ~/.researcher/methodology
```

Requires:
- `milkie` CLI on `PATH` (the agent runtime). Override with `RESEARCHER_MILKIE_BIN`.
- `gh` CLI authenticated — only needed when a topic sets `delivery.mode: remote`
  (for `git push` + `gh pr create`). Topics default to local (commit only), so a
  local-only repo needs neither a remote nor `gh`.
- `pdftotext` (poppler) for PDF extraction. Falls back to abstract if missing.
- Optional: `pwc` CLI on `PATH` ([pwc-cli](https://github.com/huggingface/pwc-cli)) — host-side discover seed via `pwc search --json`. Without it, discover collect behaves as before.

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

### Scaling up to a workspace

One topic is the atom. When a program needs several **pillars** researched in
parallel — each its own thesis — compose them into a **workspace** super-repo and
advance them all from one root with a single `researcher run`, then browse them
in a local web console with `researcher serve`. See
[Workspace mode](#workspace-mode-multi-pillar) for the full setup.

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

### File contract — who writes, who reads

A topic repo has exactly two consumers: **you** (the human) and the **research
agent** (headless claude invoked by each run). Knowing which file each touches
removes most confusion:

| File | Written by | Read by | In agent prompt? | Git |
|---|---|---|---|---|
| `.researcher/thesis.md` | you | research agent | ✅ the *research spec* | tracked |
| `.researcher/project.yaml` | you (onboard drafts) | CLI + research agent | ✅ | tracked |
| `.researcher/charter.md` | machine (AUTO-SYNCED) | research agent | ✅ anchor — **do not edit** | tracked |
| `notes/00_research_landscape.md` | research agent | you (review) | — | tracked |
| `notes/NN_<slug>.md`, `report.md`, `papers/README.md` | research agent | you (review) | partial re-feed | tracked |
| `.researcher/state/{seen.jsonl,watermark.json}` | machine | CLI | — | tracked |
| `.researcher/state/runs/<id>/` | machine | you (diagnosis) | — | gitignored |

Rule of thumb: **you write the spec (thesis) and review PRs; the research agent
writes the evidence (notes / report / landscape); the machine writes state.**
`charter.md` exists only in workspace mode (below).

## Workspace mode (multi-pillar)

A single narrow thesis is the right unit for one topic. When a larger program
needs several **pillars** researched in parallel — each its own narrow thesis,
deep-dived independently — a **super-repo** stitches them together with git
submodules and advances them from one root.

### Two specs, two scopes

- **research spec** = `thesis.md` — one pillar's narrow claim; drives that
  pillar's triage / read / synthesize.
- **anchor** = `CHARTER.md` (super-repo) — the invariants shared across *all*
  pillars. Before each run its slice (shared core + this pillar's excerpt) is
  written into the pillar's read-only `.researcher/charter.md`. Drift surfaces
  as a `## Charter tension` for you to adjudicate — **bidirectionally**: the
  pillar drifted, or the CHARTER itself should change.

In one line: **thesis governs where one pillar sharpens; CHARTER governs that
the pillars don't drift into each other.**

### Super-repo layout

```
<super-repo>/
├── CHARTER.md                 # shared anchor: north star + pillar map/invariants + per-pillar excerpts
├── researcher.workspace.yml   # control panel: topics + active/dormant
├── docs/                      # human-maintained integration notes (NOT read by researcher)
└── <pillar>/                  # each = a standalone topic repo (git submodule)
```

> `researcher` reads only **two** super-repo files: `researcher.workspace.yml`
> (which pillars to run) and `CHARTER.md` (sliced into each pillar as its
> anchor). Everything else under the super-repo is for humans.

### CHARTER.md slicing contract

`charter.md` is produced by slicing `CHARTER.md`, so its structure is a contract:

- **shared core** = everything before the first `### ` heading (north star +
  invariants — every pillar receives this).
- **per-pillar excerpt** = the `### ` block whose heading contains the
  backtick-wrapped pillar path (e.g. `` ### `trace` ``), up to the next `##`/`###`.
- therefore `### ` is **reserved** for per-pillar excerpts inside `CHARTER.md`.

Start from [`templates/CHARTER.md`](templates/CHARTER.md). A pillar's synced
anchor = shared core + its own excerpt; it is overwritten every run and must
not be hand-edited.

### Quickstart B — stand up a workspace

```sh
# 1. create the super-repo
mkdir my-research && cd my-research && git init
cp <researcher>/templates/CHARTER.md CHARTER.md   # then edit: north star, invariants, excerpts

# 2. add a pillar as a submodule (each pillar is its own topic repo)
git submodule add <pillar-repo-url> trace
( cd trace && researcher init && researcher onboard )

# 3. register it in the control panel
cat > researcher.workspace.yml <<'YML'
version: 1
topics:
  - { path: trace, active: true }
YML

# 4. advance all active pillars from the super-repo root
researcher run
```

Each active pillar advances one tick (charter synced first) and opens its own
PR in its own submodule repo. Dormant pillars (`active: false`) are untouched.
A pillar failing does not abort the rest — errors are collected in the summary.

### `researcher workspace sync` / `publish`

Explicitly align a workspace with GitHub. Does **not** change `run` defaults and
does **not** depend on `delivery.mode` (delivery still only gates package
push+PR).

```bash
# default: fetch + ff-only pull on active topics that have origin
researcher workspace sync
researcher workspace sync --pull --push-topics --pointers --library
researcher workspace sync --library
researcher workspace sync --all --dry-run

# promote a local pillar (manifest must set publish: true)
# human TTY: prints a plan, then confirms
researcher workspace publish world-model --remote git@github.com:org/world-model.git

# CI/agent: still needs the topic allowlist, plus explicit confirmation
researcher workspace publish world-model \
  --remote git@github.com:org/world-model.git \
  --yes
```

Manifest allowlist (default is deny):

```yaml
topics:
  - path: world-model
    active: true
    publish: true
```

- `--pull` — ff when origin exists; skip/fail otherwise
- `--push-topics` — push current branch to origin (no PR)
- `--pointers` — bump gitlinks only for existing submodules; one super-repo commit
- `--library` — commit allowlisted Library ledgers and `reads/*.md` in the super-repo (no PR, no push); PDFs excluded
- `publish` — default off; only topics with `publish: true` may add origin, push, write `.gitmodules` + gitlink
- `--yes` — non-interactive confirmation only; never bypasses the topic allowlist
- `--dry-run` — no writes; unauthorized topics report `blocked: publish not enabled`
- one topic failing does not abort the rest; exit 1 if any failed

See `docs/design/130-workspace-sync.md` and `docs/design/173-library-workspace-sync.md`.


## Commands

| Command | What it does |
|---|---|
| `researcher init` | Scaffold `.researcher/` at the repo root |
| `researcher onboard` | Interactive TUI to draft `project.yaml` + `thesis.md` |
| `researcher add <arxiv-id\|url>` | Deep-read one paper end-to-end (4-stage pipeline) |
| `researcher run` | In a topic repo: autonomous tick (discover + triage + deep-read + synthesize + package). **At a super-repo root: advances every active pillar** (see Workspace mode) |
| `researcher methodology install` | Copy methodology files to `~/.researcher/` |
| `researcher methodology show` | Print currently installed methodology |
| `researcher methodology edit <name>` | Open a methodology file in `$EDITOR` |
| `researcher serve [path]` | Local web console: workspace home, Library (deep-read + paper notes), topics + run |
| `researcher workspace sync` | Super-repo: pull / push topics / bump pointers / commit Library (explicit; orthogonal to delivery) |
| `researcher workspace publish <path>` | Promote an allowlisted local pillar to a submodule with origin (`--yes` for non-interactive) |
| `researcher version` | Print version |

### `researcher serve [path]`

Start a local web console over a workspace super-repo (a directory with
`researcher.workspace.yml`). Binds `127.0.0.1` only; no auth.

```bash
researcher serve                 # serves the current super-repo on :4500
researcher serve ../research -p 8080
```

Surfaces (workspace-first):

| Route | Role |
|---|---|
| `/` | Workspace Home — health, needs-attention, topic preview, library snapshot |
| `/topics` | Topic card grid + **New topic** (local scaffold + workspace register); open `/t/:slug` for thesis / landscape / report / notes, **Complete setup** (AI draft), and per-topic `run` with live logs |
| `/library` | Paper intake list (filters, add paper) |
| `/library/p/:id` | Paper detail — machine deep-read artifact + **paper-local human notes** (Markdown, pin/delete); deep-read / **Topic link** (heuristic Suggest fills the form; only **Link topic** writes) |

**Dual-track (Library vs Topic):** Library deep-reads and paper notes are neutral,
portable evidence and attention. Topic work remains thesis-driven synthesis.
Linking a paper into a topic is an explicit join step — notes on a paper do not
automatically rewrite a pillar.

Library deep-read first screen is **`## Essence`** (问题 / 做法 / 证据 / 边界) —
not a compressed abstract-style Brief. Older artifacts that still have `## Brief`
render in the same slot. See `docs/design/98-essence-replaces-brief.md`.

Paper notes live in `.researcher-workspace/library/notes.jsonl` and survive force
re-read of the machine artifact. See `docs/design/89-paper-local-notes.md`.

`path` must point at a [workspace super-repo](#workspace-mode-multi-pillar) (a
directory holding `researcher.workspace.yml`) — not the `researcher` tool's own
source checkout, which has no manifest and errors out.

## Environment

- `RESEARCHER_MILKIE_BIN` — path to `milkie` if not on `PATH`.
- `RESEARCHER_MILKIE_AGENT` — milkie agent id to run. Defaults to `researcher`.

Delivery (push + PR vs. local commit only) is per-topic, set via `delivery.mode`
in `.researcher/project.yaml` (`local` default, or `remote`) — not an env var.

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
