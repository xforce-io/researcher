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

   **Structure** (create from scratch if `{{report_current}}` is empty or marked `(not yet created)`; otherwise update surgically):

   ```
   # <topic title from thesis>: Research Report
   
   > **Version:** vN (N papers)
   > **Last Updated:** <today>
   > **Papers:** [01](notes/01_xxx.md), [02](notes/02_yyy.md), …
   > **Thesis:** [.researcher/thesis.md](.researcher/thesis.md)
   
   ---
   
   ## 当前判断
   [One paragraph: what we currently believe. Update every run.]
   
   ## 分 RQ 核心发现
   [One subsection per research question from thesis. Cite papers as [N].]
   
   ## 设计启发
   [Concrete implications for design/build work derived from the literature.]
   
   ## 未覆盖的问题
   [What remains unknown or contradicted.]
   
   ## 版本更新日志
   | 版本 | 日期 | 新增论文 | 关键变化 |
   |------|------|---------|---------|
   ```

   **Update rules:**
   - Increment version number and update "Last Updated" + "Papers" list.
   - Append a new row to the version log explaining what this paper changed.
   - Add the new paper's contribution to the relevant RQ subsections (cite as [N]).
   - Revise "当前判断" and "设计启发" only when the new paper meaningfully shifts the conclusion — otherwise leave them unchanged.
   - Do NOT rewrite sections wholesale; prefer targeted inserts and rewrites of individual sentences.

5. **`papers/README.md`** — only if this file already exists. Sync its paper table the same way you sync the README's. If it does not exist, **do not create it**.

### What you MUST NOT change in the landscape

You may add new bullets, table rows, and reading-priority entries inside the existing structure. You MUST NOT:

- Rename or rewrite any existing H1/H2/H3 heading or any banner inside the ASCII layered diagram (e.g. `横切面 ─ 评估范式`).
- Reshape the layered ASCII stack (the `┌──┐` block) — its boxes, labels, and ordering are fixed.
- Introduce new top-level sections or new sub-buckets inside the layered stack.
- Change column or row headers in any table.

If the new paper does not fit into any existing bucket, do NOT extend the structure unilaterally. Instead, append a section to the contradictions file titled `## Proposed taxonomy extension` describing exactly what new bucket would be needed and why; the human will decide whether to accept the proposal in a later edit.

### Other constraints

Do NOT modify `thesis.md`. Do NOT modify any file in `notes/` other than `00_research_landscape.md`. Do NOT modify `.researcher/state/`.

After your Write/Edit calls, your final stdout response (NOT inside any file you wrote) MUST end with a `FILES_MODIFIED:` block listing every file you changed in this stage. The first two lines are mandatory; the next two are present only when you actually edited those files:

FILES_MODIFIED:
notes/00_research_landscape.md
{{contradictions_path}}
README.md
report.md
papers/README.md
