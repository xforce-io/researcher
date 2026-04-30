# Researcher: Synthesize stage

## Methodology — synthesis discipline

{{methodology_synthesis}}

## Methodology — writing discipline (includes workshop curation)

{{methodology_writing}}

## Project thesis

{{thesis}}

## Current landscape (notes/00_research_landscape.md)

{{landscape_current}}

## Current README (`README.md`)

```markdown
{{readme_current}}
```

## Current papers index (`papers/README.md`, if any)

```markdown
{{papers_readme_current}}
```

## Project references (`references/` directory)

{{references_context}}

## Current report (`report.md`) — thesis-driven synthesis across all papers

```markdown
{{report_current}}
```

## New note to integrate

Filename: `notes/{{new_note_filename}}`

```markdown
{{new_note_content}}
```

## OUTPUT INSTRUCTIONS

Produce up to four artifacts (the third and fourth depend on what already exists):

1. **Updated `notes/00_research_landscape.md`** — use `Edit` (or `Write` if the file is brand new). Apply surgical changes per synthesis discipline:
   - Place the new paper into the most-specific existing taxonomy bucket.
   - Add ≥1 explicit relation to existing papers.
   - Cite via `[N]` referencing the new note.
   - Preserve the existing structure — narrow diffs, not rewrites.

2. **`{{contradictions_path}}`** — use `Write`. List any contradictions between the new paper and existing landscape claims or working thesis. If none, write the single word `none` as the file content.

3. **`README.md`** — maintain per the **workshop curation** section in the writing discipline. The minimum required mutation: ensure the paper table includes a row for the new note `{{new_note_filename}}` (with the right priority and read-status emoji), and update "Last Updated" if the README has such a field. Beyond that, follow the curation rules: preserve narrative paragraphs that still match the current thesis; rewrite them only if the thesis has shifted relative to what the existing README implies. Use `Edit` for surgical changes, `Write` only if the README is being effectively rebuilt.

4. **`report.md`** (repo root) — thesis-driven synthesis across *all* papers read so far. Update with every new note.

   **Required metadata header** (always present):

   ```
   # <topic title>: Research Report
   
   > **Version:** vN (N papers)
   > **Last Updated:** <today>
   > **Papers:** [01](notes/01_xxx.md), [02](notes/02_yyy.md), …
   > **Thesis:** [.researcher/thesis.md](.researcher/thesis.md)
   ```

   **Body structure — your judgment, not a formula.**
   The research questions exist as anchors, not as headings. Organize the body around the actual intellectual problems that have emerged from reading, not around the numbered RQs. Ask yourself: after reading these papers, what are the genuine tensions, open design choices, and actionable insights? Let those drive the sections. A good section title is a claim or a question worth debating, not an RQ label.

   If a `## Design Context` section exists in the thesis, or if `references/` contains product/design documents, the report body should map research findings to *specific design decisions in that context* — not just compare papers to each other. A section that says "paper X implies we should do Y in our component Z because of gap G" is more valuable than one that says "paper X achieves result R."

   Required fixed section at the end:

   ```
   ## 版本更新日志
   | 版本 | 日期 | 新增论文 | 关键变化 |
   |------|------|---------|---------|
   ```

   **Update rules:**
   - Increment version and "Last Updated"; add the new paper to the Papers list.
   - Append a new row to the version log.
   - Update body sections surgically — revise only where the new paper actually shifts the picture. Prefer targeted sentence rewrites over wholesale section rewrites.
   - If a new theme emerges that doesn't fit existing sections, add a new section (don't force it into an existing one).
   - If `{{report_current}}` is `(not yet created)`, write the full report from scratch.

5. **`papers/README.md`** — only if this file already exists. Sync its paper table the same way you sync the README's. If it does not exist, **do not create it**.

### What you MUST NOT change in the landscape

You may add new bullets, table rows, and reading-priority entries inside the existing structure. You MUST NOT:

- Rename or rewrite any existing H1/H2/H3 heading or any banner inside the ASCII layered diagram (e.g. `横切面 ─ 评估范式`).
- Reshape the layered ASCII stack (the `┌──┐` block) — its boxes, labels, and ordering are fixed.
- Introduce new top-level sections or new sub-buckets inside the layered stack.
- Change column or row headers in any table.

If the new paper does not fit into any existing bucket, do NOT extend the structure unilaterally. Instead, append a section to the contradictions file titled `## Proposed taxonomy extension` describing exactly what new bucket would be needed and why; the human will decide whether to accept the proposal in a later edit.

### Handling `supersedes` relations

If the new note's Relations section declares `supersedes <note_id>` (or 中文等价表达 like 取代/包含/弃用), the named paper is no longer load-bearing and must be demoted from the main narrative. Apply these surgical edits:

- **In `notes/00_research_landscape.md`**: append the inline tag `(superseded by [N])` to the existing bullet for the demoted paper, where `[N]` is the new paper. Do NOT delete the bullet (history matters), do NOT move it. The relation also gets recorded normally inside the new paper's entry.
- **In `report.md`**: remove the demoted paper's analysis from main body sections (§3 / §4 / similar). Append (or extend) an appendix section titled `## 附录: Superseded works` (or English `## Appendix: Superseded works`) with one row per demoted paper: `[N_old] <one-line title> — superseded by [N_new] (<one-line reason>)`. If a previous run already created this appendix, add a row; do not duplicate. Inside the main body, replace any prior load-bearing reference to the demoted paper with a single sentence acknowledging its supersede status (`(See appendix: superseded by [N_new]).`) — do NOT silently delete it.
- **In `README.md`**: change the demoted paper's row Status emoji to `📜` (archived). Keep the row in the table.
- **The note file itself stays untouched** — the supersede state lives in landscape + report + README, not in note frontmatter (the synthesize stage is forbidden from editing other notes).

If the new note's Relations declare nothing about supersedence, ignore this section.

### Other constraints

Do NOT modify `thesis.md`. Do NOT modify any file in `notes/` other than `00_research_landscape.md`. Do NOT modify `.researcher/state/`.

After your Write/Edit calls, your final stdout response (NOT inside any file you wrote) MUST end with a `FILES_MODIFIED:` block listing every file you changed in this stage. The first two lines are mandatory; the next two are present only when you actually edited those files:

FILES_MODIFIED:
notes/00_research_landscape.md
{{contradictions_path}}
README.md
report.md
papers/README.md
