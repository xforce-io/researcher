# Reading Discipline

Every paper note follows a fixed skeleton. This is not a style preference — synthesis (`notes/00_research_landscape.md`) is composed by scanning these sections programmatically. A note that buries the method inside a "summary" paragraph cannot be composed; it can only be summarized again, compounding signal loss.

## Reading template (mandatory)

每篇 note 以最小 YAML frontmatter 起头（`zone`/`pin`/`score`/`dwell`），由系统维护分区；人可手动设 `pin: true` 钉住不被归档。frontmatter 在 H1 之上，不参与按 `## ` 标题的综合扫描。

Every note in `notes/active/NN_<slug>.md` must open with a one-line **Frame** lede, then contain all six sections in this order:

### Frame (lede)

One sentence that orients a reader who has never seen the paper: **the problem it tackles → the approach it takes**. Write it as a Markdown blockquote directly under the note's H1 title (before the arXiv/Authors/Axes header block and `## Claims`). One sentence, hard cap — this is the only prose summary the skeleton allows.

It is a reader-facing lede, **not** a composable section: synthesis scans `## ` headings, so the Frame never enters `notes/00_research_landscape.md` and cannot dilute the claim-first signal. Its only job is to keep the topic page from opening cold on `## Claims`.

- Include: `> 大表海里选数据,向量检索召回噪声多;用 agent 逐步推理元数据做高精度选表。`
- Exclude: a problem / approach / method / eval / value multi-part brief — that duplicates Method / Eval / Claims and reintroduces the summary-paragraph signal loss this skeleton forbids.

### Claims

The paper's load-bearing assertions stated as facts: what the authors assert is true about the world. Write each claim as a standalone sentence. Do not interpret, do not hedge with "the authors believe" — that goes in Weaknesses or Relations.

- Include: "Signal sampling achieves 1.52× annotation efficiency over random sampling [1: §4.1]."
- Exclude: "The paper argues that their approach is better" (that's your opinion, not a claim).

### Assumptions

What the paper takes as given without justification. These are the conditions under which the claims hold. If the paper never states them, infer them from the experimental setup.

- Include: "Users are simulated LLMs, not real humans [1: §3.1]." This is an assumption the paper acknowledges but does not justify as representative.
- Exclude: standard field assumptions that every paper in this area shares — those clutter the section with noise.

### Method

The mechanism: what the paper actually does, step by step. For a systems paper this is the architecture; for an empirical paper this is the pipeline; for a theory paper this is the proof structure.

Keep it to the decision-relevant details: inputs, core computation, outputs. Do not copy the abstract.

### Eval

What was measured, against which baselines, on which data, with which metrics. A complete entry answers all four.

- Include: "Compared against random and heuristic (≥10-turn) sampling on τ-bench (airline + retail); metric = expert-rated informativeness (majority vote of 3 annotators)."
- Exclude: "Results were promising" — that belongs in Claims with a number.

### Weaknesses

Gaps you found through critical reading. Not the "Future Work" section — those are author-acknowledged limitations. Your job is to find limits the authors did not acknowledge or glossed over.

- Include: "No LLM-as-Judge upper bound is reported; the paper cannot show how much performance the rule-based approach sacrifices [1: §1]."
- Include: "检测器实现（阈值、phrase pattern）未公开，论文不可复现 [1: §3.2]。" (Reproducibility gap the authors did not call out as a limitation.)
- Exclude: "The paper only studies two domains (the authors mention this as future work)" — that is author-listed future work, not your critique.

### Relations

How this paper connects to others already in `notes/`. At least one explicit relation is required. Use the relation kinds defined in `04-synthesis.md`: `builds-on`, `competes-with`, `extends`, `contradicts`, `orthogonal`, `supersedes`.

Every relation gets a confidence label: `[high]`, `[med]`, or `[low]`.

- `[high]`: Both papers state the connection explicitly, or the overlap is definitional.
- `[med]`: Connection inferred from overlapping scope, compatible vocabulary, or cited shared baselines.
- `[low]`: Your synthesis — neither paper mentions the other and the connection is indirect.

Example:
```
- builds-on 04_agenttrace_structured_logging [high]: Signals uses AgentTrace's Operational and Contextual surfaces as data sources for Execution signals; Signals §2.1 explicitly cites this dependency.
- competes-with 07_agent_as_a_judge [med]: Both claim to replace human review; Signals via cheap rules, AgentAsJudge via an LLM — but they measure different things (sampling informativeness vs. judgment accuracy), so "competes-with" is the framing, not a claim of strict dominance.
```

## Quote discipline

Quote only when the exact phrasing is the evidence — when paraphrase would lose the claim's precision or when a term the paper coins is being introduced.

Max quote length: two sentences. Always cite with `[N: page or section]` where N is the note number.

- Use: `"signals are not quality scores" [1: §1]` when introducing the paper's stated design invariant.
- Do not use: a three-sentence block paraphrasing the abstract — paraphrase it yourself in one sentence instead.

## Confidence labels

Use `[high]` / `[med]` / `[low]` on every claim in **Relations** and on inferences you add to landscape.

| Label | Criterion |
|-------|-----------|
| `[high]` | Stated by the paper AND corroborated by at least one independent source (different lab, different dataset). |
| `[med]` | Stated by the paper; not directly corroborated. Treat as reliable but single-sourced. |
| `[low]` | Your inference from the paper — neither stated nor corroborated. Flag it and do not promote to landscape without a cross-check. |

## Anti-patterns

**Summarizing the abstract.** The abstract is already a summary. Extract individual claims from the body instead.

**Listing author-acknowledged future work as Weaknesses.** "Authors note multi-language support is left to future work" is not a weakness you found — it is a limitation they disclosed. A weakness is "the evaluation does not include a multilingual test, and the phrase patterns are English-only, yet the paper claims broad applicability [1: §5]."

**Omitting Relations.** A note with no Relations cannot be synthesized — it is an island. If you genuinely cannot find a relation to any existing note, the paper may be off-topic. Reconsider the filing decision.

**Vague confidence on Relations.** Writing `builds-on 03_tsr [med]` with no explanation is noise. Always include a one-sentence reason: what exactly overlaps and where.

**Copying method from abstract.** The abstract describes intent; the method section describes what was done. Read both and write the method from the body.
