# Writing Discipline

## Voice

Information-dense. Cut every sentence that doesn't add a claim, a number, or a relation.

- Cut: "This paper presents an interesting approach to agent trajectory evaluation."
- Keep: "Signals achieves 82% informativeness on τ-bench, vs. 54% random baseline [1: §4.1]."

Use present tense for paper content ("The paper measures..." → "The method measures..."). The paper is a permanent artifact; describe it in the present.

Make direct claims. Do not hedge with "it seems that" or "one might argue" when you have the evidence in front of you. Save hedges for genuinely uncertain inferences, and mark them `[low]`.

Language: use whatever language the project's existing notes use. If `notes/01_*.md` is in Chinese, write new notes in Chinese. If the corpus mixes Chinese and English (e.g., technical terms in English, narrative in Chinese), match that mix. Do not introduce a new language without reason. Default to English when the corpus has no established language.

Do not use emoji in notes or landscape unless they are already in use throughout the project.

## Note filename

Pattern: `NN_short_slug.md` where:
- `NN` = next zero-padded integer in `notes/` (e.g., if `08_tide_trace_diagnostics.md` exists, next is `09`)
- `short_slug` = paper title lowercased, ASCII, underscores, max 6 words

Good slugs:
- `signals_trajectory_triage` (from "Signals: Trajectory Sampling and Triage...")
- `agent_seer_vulnerabilities` (from "AgentSeer: Detecting Agentic Vulnerabilities...")
- `breaking_observability_tax` (from "Breaking the Observability Tax...")

Bad slugs:
- `signals_trajectory_sampling_and_triage_for_agentic_interactions` (too long, title verbatim)
- `paper9` (no information)
- `new-signals-2024` (dashes, year noise)

When two papers would produce the same slug, append the first author's last name: `agent_eval_chen`, `agent_eval_rombaut`.

## PR title

Format: `research: <one-line summary, max 70 chars>`

The summary names what was added and what changed in the landscape — not what the paper says.

Good:
- `research: add note on Signals + landscape update for triage layer`
- `research: add AgentHER note + contradiction logged vs thesis §2`
- `research: skim 3 papers, deep-read TSR, extend §3.1 rollout sampling`

Bad:
- `research: new paper` (no content)
- `research: added a very interesting paper about agent trajectory triage that uses signals` (over 70 chars, filler)
- `update landscape` (missing `research:` prefix)

## Commit messages

The PR contains exactly two commits.

**C1** — the research content:
```
research: add note on <slug> + landscape update
```

If multiple papers were deep-read in one run:
```
research: add notes on <slug1>, <slug2> + landscape update
```

**C2** — the state update:
```
state: seen +<N>, watermark <ISO-date>
```

Where N = count of candidates processed (deep-read + skim + reject) in this run, and ISO-date = the watermark timestamp being advanced.

Example: `state: seen +12, watermark 2026-04-26`

C2 must be the last commit in the PR. The state commit is mechanical; it should not carry research content.

## Workshop curation

A topic repo is **the researcher's workshop on that topic**. The researcher
owns its surface — every file in the repo except `.researcher/thesis.md`. The
human edits `thesis.md` to redirect the researcher's stance; the researcher
keeps everything else coherent with that stance.

The two workshop-facing files that need active maintenance after every
deep-read:

**`README.md`** — the workshop's front door.

It must answer four questions for a first-time visitor in this order:
1. What is this topic, in one paragraph (derived from the working thesis).
2. What's the current set of read papers (a table with #, title, layer/axis,
   priority, read status).
3. What does the researcher currently believe (a 2–4 sentence thesis summary,
   linking to `.researcher/thesis.md` for the full statement).
4. Where to look for depth (`notes/00_research_landscape.md` for the synthesis,
   `papers/README.md` for the source index, `.researcher/` for project soul).

The paper table MUST be in sync with `notes/` — if a `09_<slug>.md` exists,
the table has a row for it. "Last Updated" gets today's date when the README
is touched in this run.

If `README.md` already has narrative paragraphs that are still consistent
with the current thesis, preserve them — do not churn prose for cosmetic
reasons. If the thesis has shifted (you'll know because the working thesis
text differs from what the existing README implies), rewrite the narrative
paragraphs to match.

**`papers/README.md`** (only if it exists in the repo).

The source-index counterpart to `notes/`. Maintain its paper table the same
way: every paper that has a note in `notes/` must have a row here. Don't
invent the structure if the file doesn't exist; only maintain what's there.

## What you do NOT touch

- `.researcher/thesis.md` — the human's voice. Read it, cite it, propose
  contradictions to it in `contradictions.md`. Do not edit it.
- `.researcher/state/seen.jsonl`, `state/watermark.json` — the runner writes
  these. The agent never edits state ledgers directly.

Everything else in the repo — `notes/`, `papers/` (except PDFs in the
`.gitignore`), `README.md`, additional markdown the project might add — is
yours to maintain. Default to surgical updates; rewrite when the thesis
shift demands it.

## Diffs explain why

Every substantive edit to landscape.md — meaning any change to existing text, not just appending a new bullet — must be justified. Two acceptable forms:

**Inline:** append a brief phrase in square brackets on the same line.
```markdown
- Signal sampling achieves 1.52× efficiency [1] [updated: prior figure was from abstract; §4.1 gives the corrected value]
```

**PR body:** list the edit in "Why these changes" with a sentence of rationale.

Unexplained edits to existing landscape content will be flagged in review. If you can't explain why you changed something, don't change it — propose it in the PR body instead.
