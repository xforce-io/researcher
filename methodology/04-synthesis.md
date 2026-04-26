# Synthesis Discipline

Synthesis is the step that updates `notes/00_research_landscape.md` (the living survey) when new notes arrive. This file defines what you may and may not change, and how.

## Where new papers go

The existing taxonomy in `landscape.md` is authoritative. It defines buckets — sections, subsections, categories. Place each new paper in the **most specific existing bucket** that fits.

- If the paper on sentinel-based observability fits under "§2.3 Dynamic Sampling Methods", put it there.
- Do not create a new bucket "§2.4 Sentinel-Based Methods" just because this paper uses sentinels. That reorganization changes the landscape's structure.

If no existing bucket fits, you have two options:

1. Place it in the closest parent bucket (e.g., "§2 Sampling Methods") with a note that it represents an emerging sub-cluster.
2. Propose a new bucket in the PR body under "Taxonomy proposal: [reason]".

**Do NOT unilaterally add, rename, or restructure taxonomy sections.** The PR reviewer decides whether the taxonomy should change.

## Relations are mandatory

Every newly added paper in landscape.md must declare at least one explicit relation to an existing paper already in `notes/`. Use the relation kinds from the reading discipline:

| Kind | Meaning |
|------|---------|
| `builds-on` | This paper directly extends the method or result of another. |
| `competes-with` | Solves the same problem with a different approach; performance claims overlap. |
| `extends` | Broadens the scope of another paper without replacing it. |
| `contradicts` | A claim in this paper is in direct conflict with a claim in an existing note. |
| `orthogonal` | Related domain, no overlapping claim — included for completeness. |

If you cannot find a relation to any existing note, stop and reconsider the inclusion decision. A paper with zero relations to the existing notes likely means: (a) it is off-topic and shouldn't have reached deep-read, or (b) it is genuinely first-of-kind, in which case say so explicitly and explain why it belongs despite the isolation.

Unrelated papers accumulate in the landscape and eventually degrade it into a flat list. Relations are what make it a survey.

## Contradiction detection

When a paper claim conflicts with an existing claim in landscape.md or in the working thesis (`thesis.md`), record it in `contradictions.md`. One section per contradiction, formatted as:

```markdown
## Contradiction: [short label]

**New claim:** "[exact claim from new paper]" [note-number: §section]
**Existing claim:** "[exact claim from existing note or thesis]" [note-number or "thesis.md"]
**Nature:** [factual conflict / scope disagreement / measurement inconsistency]
**Resolution options:**
- Option A: ...
- Option B: ...
```

Do **not** resolve the contradiction by editing landscape.md or thesis.md. The PR reviewer decides which claim to defer, supersede, or hold in tension. Your job is to surface it, not to arbitrate it.

Contradictions between papers in the same lab are less significant than contradictions between independent groups — note this in the "Nature" field.

## Citation hygiene

Every claim you add or modify in landscape.md must cite its source via `[N]`, where N is the note number (the NN prefix of the note file).

- Correct: "Signal sampling achieves 1.52× annotation efficiency over random baselines [1]."
- Incorrect: "Signal sampling achieves 1.52× annotation efficiency." (bare claim — who said this?)

If a claim appears in multiple notes, cite all of them: `[1, 3]`.

Do not cite the original paper's arXiv ID directly in landscape.md. Always go through the note. The note is the unit of evidence in this system.

## Diff style

Landscape edits must be surgical. Prefer the minimal change that correctly places the new material.

- **Do:** Add a single bullet under an existing section.
- **Do:** Update one sentence to extend a claim with new evidence.
- **Don't:** Rewrite a section because you think the new framing is better.
- **Don't:** Reorder bullets to match your preferred reading order.

If you believe the landscape needs structural editing beyond placing the new paper — a section is outdated, a claim has been superseded, the taxonomy has drifted from the actual notes — propose it in the PR body under "Suggested structural edits". The reviewer applies those if approved.

The landscape is a shared document with history. Unexplained edits make review hard. Any diff line that modifies existing content (not just appending) must be justified either inline with a brief phrase or in the PR body's "Why these changes" section.
