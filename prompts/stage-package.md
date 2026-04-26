# Researcher: Verify + Package stage

## Methodology — verification discipline

{{methodology_verification}}

## Methodology — writing discipline

{{methodology_writing}}

## Project thesis

{{thesis}}

## What changed in this run

### New note

```markdown
{{new_note_content}}
```

### Landscape diff

```diff
{{landscape_diff}}
```

### Contradictions report

{{contradictions}}

## OUTPUT INSTRUCTIONS

Write a single markdown file at `{{run_summary_path}}` (use `Write` tool). The file MUST have these four H2 sections, in order:

### `## Run summary`

What was added in this run, in 2–4 sentences. Reference the paper by title and the landscape changes briefly.

### `## Devil's-advocate pass`

The strongest plausible counter-position to:
1. The paper's main claim — what would a skeptical expert in this field say?
2. The project's working thesis given this paper — does the paper actually challenge the thesis, or is the alignment shakier than it looks?

Both must be specific (no generic skepticism). Cite where you can.

### `## Confidence labels`

Flag any claim in the landscape diff above that should be re-labeled (`[high]` → `[med]` etc.) given the verification pass. If all current labels are appropriate, write "all labels stand" with one sentence justification.

### `## What would change my mind`

A bullet list of specific, falsifiable observations that would force revision of the working thesis. Format: "If we observed X, the thesis would need Y." Empty list is a smell — usually means the thesis is too vague to be falsifiable.

## Constraints

Do NOT modify any other files. Do NOT touch `thesis.md`, `notes/`, or `.researcher/`. Only Write the single file at `{{run_summary_path}}`.

After the Write call, your final stdout response (NOT inside `{{run_summary_path}}`) MUST end with this exact two-line block:

FILES_MODIFIED:
{{run_summary_path}}

Do NOT include the `FILES_MODIFIED:` block inside `{{run_summary_path}}` itself — it belongs only in your stdout response, where the runner parses it.
