# Filtering Discipline

Every candidate paper gets a triage decision before any deep reading. The decision is based on four scoring axes. Scoring happens from title, abstract, and available metadata only — do not read the full paper to make a triage decision.

## Scoring axes

**Relevance to RQs** — integer 0–3:

| Score | Meaning |
|-------|---------|
| 0 | No research question is addressed or implied. |
| 1 | Tangential: shares vocabulary or domain but doesn't address any RQ directly. |
| 2 | Clear match: addresses one RQ as a major topic even if not the primary contribution. |
| 3 | Direct hit: the paper's central contribution is an answer (full or partial) to a named RQ. |

**Thesis alignment** — categorical:

| Label | Meaning |
|-------|---------|
| `supports` | New evidence that the working thesis is correct. |
| `extends` | Adds a mechanism or scope the thesis doesn't currently cover, without contradicting it. |
| `challenges` | Claims that a core assertion of the thesis is wrong or needs significant revision. |
| `orthogonal` | No overlap with the thesis, but may still be relevant via RQs. |

`orthogonal` is not the same as irrelevant. A paper on training-time data selection can be orthogonal to a thesis about deployment-time triage while still hitting RQ3 on data efficiency.

**Novelty** — categorical, relative to existing `notes/`:

| Label | Meaning |
|-------|---------|
| `incremental` | Extends a method or result already in the notes by a modest amount. Still worth reading. |
| `substantial` | New method, new benchmark, or new finding not represented in any existing note. |
| `paradigm-shift` | Contradicts or fundamentally reframes something the notes treat as settled. |

**Citation gravity** — categorical:

| Label | Meaning |
|-------|---------|
| `low` | Unknown lab, zero or near-zero citations, no peer review. |
| `medium` | Established lab OR moderate citation count (>10 in 6 months) OR accepted at a top venue. |
| `high` | High citation velocity AND top-tier venue AND lab with a strong track record in this area. |

Citation gravity is a tie-breaker and a quality signal, not a relevance signal. A `low`-gravity paper at relevance 3 still gets deep-read.

## Decision thresholds (default)

**`deep-read`** when all three hold:
- relevance ≥ 2
- alignment is `supports`, `extends`, or `challenges` (not `orthogonal`)
- novelty ≥ `incremental`

**`skim`** when:
- relevance ≥ 1

A skimmed paper produces metadata + a single paragraph note. Do not produce a full reading-template note for skims.

**`reject`** when:
- relevance = 0

Record reason. Do not discard silently.

A `challenges` paper with relevance 2 is always deep-read — do not avoid contradicting evidence.

## Reason discipline

Every triage decision requires a one-sentence `why`. The format:

```
<RQ-id or "no RQ">: <alignment> — <one phrase naming the specific overlap or mismatch>
```

Examples:
- `RQ2: extends — uses sentinel sampling on the same trajectory class as RQ2's focus, adds topology-aware depth selection.`
- `RQ1: orthogonal — evaluates training-time rollout selection, not deployment-time triage; no RQ overlap on methods.`
- `no RQ: reject — paper is about video generation; no agent evaluation component.`

The reason is written into `seen.jsonl` alongside the canonical ID and decision. This allows the human reviewer to audit the filtering later without re-reading every abstract.

## Override convention

Projects can shift decision thresholds in `project.yaml` under a `filtering:` key (Plan 1 ships defaults only; Plan 2 reads overrides):

```yaml
filtering:
  deep_read_min_relevance: 3    # narrower: only direct hits
  skim_min_relevance: 2         # narrower: no tangentials
```

**Raising the relevance threshold makes the researcher narrower** — fewer papers reach deep-read. Use this for mature projects where the notes are dense and new papers rarely add much.

**Lowering the threshold makes the researcher broader** — more papers reach deep-read. Use this for early-stage projects where the notes are sparse and discovery value is high.

Never lower `deep_read_min_relevance` below 1. A relevance-0 paper is by definition off-topic; reading it produces noise in the landscape.
