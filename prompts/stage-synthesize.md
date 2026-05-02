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

   **Hard cap on the README's Thesis section** (if the README has one, named `## Thesis` / `## 论题` / similar). It is a *summary* of `.researcher/thesis.md`, not a copy of it and not an accretion log:
   - **≤4 sentences total**, written as a single short paragraph or 2–4 short bullets. No multi-claim mega-paragraphs.
   - **Regenerated each run from `.researcher/thesis.md`, never appended to**. If you find the existing section already exceeds the cap, rewrite it to fit the cap — do not preserve length out of "surgical update" politeness.
   - Must end with a pointer to the full thesis (e.g. `See [.researcher/thesis.md](.researcher/thesis.md) for the full working thesis.`).
   - The depth and supporting evidence belong in `report.md` and `notes/00_research_landscape.md`, not in the README's Thesis block.

4. **`report.md`** (repo root) — `report.md` is `.researcher/thesis.md`'s **evidence and argument apparatus**. The thesis is the spec; the report is its working implementation. The report's job is to make the thesis's positioning, design decisions, and falsifiability points *legible and challengeable* in light of every paper read so far. It is **not** a per-paper notebook, **not** an academic survey, **not** a list of "what each paper says." Update it with every new note.

   **Required metadata header** (always present):

   ```
   # <topic title>: Research Report
   
   > **Version:** vN (N papers)
   > **Last Updated:** <today>
   > **Papers:** [01](notes/01_xxx.md), [02](notes/02_yyy.md), …
   > **Thesis:** [.researcher/thesis.md](.researcher/thesis.md)
   ```

   ### Step A — structural compliance check (BEFORE any edit)

   Before deciding whether to do a surgical update or a restructure, audit the existing `{{report_current}}` against this checklist. The checklist applies whenever `.researcher/thesis.md` has a `## Design Context` section OR `references/` contains product/design documents (i.e. the topic has a real design spec). If neither exists, this checklist is skipped and you may use a freer academic-axis structure.

   - [ ] **Spine matches thesis structure**: top-level sections derive from thesis's *Working thesis* claims, *Design Context* goals/components, and *可证伪点追踪* — not from academic axes ("调用前检索", "智能体内规划"), per-paper labels ("§N paper X", "MAST 失败的地图"), or numbered RQs.
   - [ ] **Section titles are claims or design questions**, not paper titles or topic taxonomy. "Goal 4 Composer：sandbox 还是 broadcast？" is the target shape; "Agent-as-a-Graph 的类型化召回" is not.
   - [ ] **Papers appear as evidence inside sections**, not as section topics. A given paper may appear in multiple sections, in one, or as a one-line falsifiability note.
   - [ ] **Each design-goal section answers three questions**: (i) what does the literature now say about this goal? (ii) what residual gap or tension remains? (iii) what should we do about it in our system?
   - [ ] **可证伪点追踪 is a body section, not an afterthought** — every entry in thesis's 可证伪点 table has a paragraph in the report tracking current evidence pro/con and the next observation that would resolve it.
   - [ ] **No "supplementary / backfill / 整合" sections that exist alongside an old non-compliant spine**. If you find such a section, that is a sign the previous run dodged a restructure — fix it now.
   - [ ] **Every paper in the Papers metadata is cited in the body** (`[1]`…`[N]`).

   Record the result of this audit. If **any** box fails, the report is **non-compliant** — proceed to Step B (restructure). If all boxes pass, proceed to Step C (surgical update).

   ### Step B — restructure (when non-compliant)

   When the audit fails, you MUST restructure the report. This is not optional and not a "judgment call" — additive supplementary sections are explicitly forbidden as a workaround.

   - Use `Write` to rebuild `report.md` from scratch, with the spine derived from `.researcher/thesis.md`. Recommended top-level structure:
     1. **Opening framing** (≤6 sentences): the topic's positioning and the central tension, drawn from thesis's Working thesis. Voice mirrors the thesis.
     2. **One section per design goal / open design decision** named in thesis's Design Context. Each section answers the three questions above.
     3. **Cross-cutting tensions** (only if real): conflicts between papers, conflicts between literature and thesis, conflicts between goals.
     4. **可证伪点追踪**: one paragraph per thesis falsifiability entry, with current evidence and next observation.
     5. **版本更新日志** (the fixed section below).
   - Preserve facts, numbers, and citations from the old report — but reorganize them. Do not lose information; do lose the old structure.
   - The restructure replaces the old body wholesale; do not keep parallel old academic-axis sections "for safety."

   ### Step C — surgical update (when compliant)

   If the audit passes, integrate the new paper surgically:
   - Increment version and "Last Updated"; add the new paper to the Papers list.
   - Append a new row to the version log.
   - Revise body sections only where the new paper actually shifts the picture. Prefer targeted sentence rewrites over wholesale section rewrites.
   - If a new theme genuinely emerges that doesn't fit any existing design-goal section, add a new design-goal-anchored section — but do not add an academic-axis section, and do not add a "supplementary integration" section as a way to avoid restructuring elsewhere.

   ### Step D — final self-check (before writing FILES_MODIFIED)

   - Re-run the Step A checklist against your output. If any box fails, you are not done — fix it before emitting FILES_MODIFIED.
   - Confirm every paper `[1]…[N]` from the Papers metadata is cited in the body.
   - Confirm no parallel old-spine sections survived the restructure.

   ### Bootstrapping

   - If `{{report_current}}` is `(not yet created)`, write the full report from scratch using the Step B structure.

   Required fixed section at the end:

   ```
   ## 版本更新日志
   | 版本 | 日期 | 新增论文 | 关键变化 |
   |------|------|---------|---------|
   ```

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
