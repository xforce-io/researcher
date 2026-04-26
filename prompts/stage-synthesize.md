# Researcher: Synthesize stage

## Methodology — synthesis discipline

{{methodology_synthesis}}

## Methodology — writing discipline

{{methodology_writing}}

## Project thesis

{{thesis}}

## Current landscape (notes/00_research_landscape.md)

{{landscape_current}}

## New note to integrate

Filename: `notes/{{new_note_filename}}`

```markdown
{{new_note_content}}
```

## OUTPUT INSTRUCTIONS

Produce two artifacts:

1. **Updated `notes/00_research_landscape.md`** — use `Edit` (or `Write` if the file is brand new). Apply surgical changes per synthesis discipline:
   - Place the new paper into the most-specific existing taxonomy bucket.
   - Add ≥1 explicit relation to existing papers.
   - Cite via `[N]` referencing the new note.
   - Preserve the existing structure — narrow diffs, not rewrites.

2. **`{{contradictions_path}}`** — use `Write`. List any contradictions between the new paper and existing landscape claims or working thesis. If none, write the single word `none` as the file content.

### What you MUST NOT change in the landscape

You may add new bullets, table rows, and reading-priority entries inside the existing structure. You MUST NOT:

- Rename or rewrite any existing H1/H2/H3 heading or any banner inside the ASCII layered diagram (e.g. `横切面 ─ 评估范式`).
- Reshape the layered ASCII stack (the `┌──┐` block) — its boxes, labels, and ordering are fixed.
- Introduce new top-level sections or new sub-buckets inside the layered stack.
- Change column or row headers in any table.

If the new paper does not fit into any existing bucket, do NOT extend the structure unilaterally. Instead, append a section to the contradictions file titled `## Proposed taxonomy extension` describing exactly what new bucket would be needed and why; the human will decide whether to accept the proposal in a later edit.

### Other constraints

Do NOT modify `thesis.md`. Do NOT modify any file in `notes/` other than `00_research_landscape.md`. Do NOT modify `README.md`.

After your Write/Edit calls, your final stdout response (NOT inside any file you wrote) MUST end with this exact block:

FILES_MODIFIED:
notes/00_research_landscape.md
{{contradictions_path}}
