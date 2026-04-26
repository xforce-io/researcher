# Source Discipline

## Default sources

These five sources are active on every project unless `project.yaml: sources` overrides them (see Override convention below).

| Source | Role |
|--------|------|
| **arXiv** | Primary paper feed. Tracks preprints before peer review. Primary categories: `cs.LG`, `cs.AI`, `cs.CL`; project narrows via keyword queries. |
| **Semantic Scholar** | Citation graph traversal. Used to find papers that cite a seed and papers that a seed cites — both directions, limited depth. Discovers related work that never appeared in arXiv queries. |
| **OpenReview** | In-progress papers with reviewer commentary. Useful when a paper has been submitted but not yet accepted; reviewer critiques are pre-packaged Weaknesses. |
| **GitHub** | Releases of named tools and code drops associated with papers. Tracks when a paper's method becomes reproducible — changes the reliability of claims. |
| **Lab/group blogs** | Single-author posts and org posts (e.g., DeepMind blog, Berkeley BAIR). Often anticipate a paper by months or distill it with context the paper omits. Treat as `[med]`-confidence secondary source, never primary. |

## Per-source query strategy

`project.yaml: sources[].queries` is an array of query strings. Here is how each maps to actual retrieval:

**arXiv.** Each query string is matched against title and abstract text. Use specific noun phrases over broad terms — `"trajectory triage agent"` over `"agent evaluation"`. The researcher runs queries on the daily listing for the configured categories and also on the full-text search API for historical coverage.

**Semantic Scholar.** Queries here are seed paper IDs (arXiv IDs or DOIs), not keyword strings. The researcher follows forward citations (papers that cite the seed) and backward references (papers the seed cites) up to depth 2. Depth 1 is always read; depth 2 is filtered at triage before deep-reading. Example entry in `project.yaml`:
```yaml
sources:
  - kind: semantic_scholar
    queries:
      - "arxiv:2604.00356"   # Signals paper — follow its citation graph
    depth: 2
```

**OpenReview.** Queries are venue identifiers or paper titles. The researcher fetches the submission and attaches reviewer scores and critiques to the candidate metadata — these are surfaced during the Read stage as pre-filled Weaknesses candidates.

**GitHub.** Queries are repository URLs or search strings like `"agent triage signals site:github.com"`. Tracked on release events. A new release triggers a candidate entry with the codebase as primary evidence, not a paper.

**Lab/group blogs.** Queried via RSS or site-specific crawls. Candidates from blogs are always `skim`-tier by default (never auto-promoted to `deep-read`) unless the project explicitly configures `blog_depth: deep`.

## Dedup strategy

Every candidate gets a canonical ID before any further processing. The precedence rule is:

```
DOI > arXiv ID > OpenReview ID > URL-hash
```

Always prefix with source namespace:

- `arxiv:2401.00001`
- `doi:10.1234/example.2024`
- `openreview:abc123XYZ`
- `urlhash:sha256-prefix-8chars` (fallback when nothing else is available)

Title-hash is not a canonical ID — titles change between preprint and published version. Use it only as a collision-detection heuristic, never as the primary key.

When a candidate arrives from two sources (e.g., arXiv preprint and Semantic Scholar citation), merge the records under the DOI if available, else the arXiv ID. The `seen.jsonl` keyed on canonical ID is the dedup ledger — if the ID is in `seen.jsonl`, skip without reprocessing.

## Override convention

When `project.yaml: sources` is present, it **replaces** the defaults entirely. The researcher does not silently union project sources with defaults.

- If the project sets `sources: [{kind: arxiv, queries: [...]}]`, only arXiv is active. Semantic Scholar is off.
- If the project wants to add a source on top of defaults, it must list all five defaults explicitly plus the new one.

This is intentional: projects with narrow scope should not inherit a broad crawl they didn't ask for. A project studying a single tool does not want the full Semantic Scholar citation graph firing every week.
