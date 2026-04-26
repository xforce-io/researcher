# Verification Discipline

Verification runs after synthesis, before packaging. Its purpose: catch confident-but-wrong additions before they reach the PR.

## Cross-check requirement

Load-bearing claims in landscape.md must be verified against ≥2 independent sources before being promoted to `[high]` confidence.

A claim is **load-bearing** if it:
- Anchors or supports the working thesis directly, or
- Defines a category boundary (e.g., "Layer 1 = rule-based triage; Layer 2 = model-based evaluation"), or
- Is cited as evidence for a taxonomy decision.

Peripheral details (year, venue, author list) do not need cross-checking.

**Independence criterion.** Two sources are independent when they come from different labs and were produced without direct coordination. Two papers that cross-cite each other and share first authors are not independent. A paper + a blog post from the same group is not independent.

- Independent: Signals paper [1] + AgentSeer paper [6] both observing that rule-based detection degrades on complex multi-step tasks.
- Not independent: Signals paper [1] + its own ablation appendix.
- Not independent: two papers from DigitalOcean Holdings with overlapping author lists.

If cross-check sources are unavailable, the claim stays at `[med]` regardless of how confident the paper sounds.

## Confidence labels in landscape

Use the same three tiers defined in the reading discipline, applied consistently across all files:

| Label | Criterion |
|-------|-----------|
| `[high]` | Stated by the paper AND corroborated by at least one independent source (different lab, different dataset). |
| `[med]` | Stated by the paper; not directly corroborated. Reliable but single-sourced. |
| `[low]` | Your inference — neither stated by the paper nor corroborated. Do not add `[low]` claims to landscape without flagging them explicitly. |

Every quantitative result added to landscape carries `[med]` by default. Promote to `[high]` only when an independent replication exists in another note.

## Devil's-advocate pass (mandatory)

Before packaging the PR, generate the strongest plausible counter-position to:

**(a) The new paper's main claim.** Not a trivial objection — a position a reasonable expert in this field could actually hold.

- Weak devil's advocate: "The sample size of 300 is small." (The authors already acknowledged this.)
- Strong devil's advocate: "The 1.52× efficiency gain is measured on τ-bench, where user turns are LLM-generated and follow predictable patterns. On real users with non-linear frustration dynamics, the phrase-matching detectors may degrade to near-random performance, eliminating the claimed efficiency advantage entirely."

**(b) The working thesis given this new paper.** If the new paper is the strongest available challenge to the thesis, say so. If it's supporting evidence, identify what a skeptic would say about the quality of that support.

Both go into the PR body under "Devil's advocate". The PR reviewer reads this before deciding whether to approve the landscape update.

## What would change my mind

An explicit list of falsifiable conditions that, if observed, would require revision of the working thesis. Goes into the PR body.

Format each item as:
```
If we observed [specific empirical condition], the working thesis would need revision because [what it would contradict].
```

Examples:
- "If we observed that rule-based triage achieves <60% informativeness on real (non-simulated) user trajectories, the thesis claim that 'lightweight signals are sufficient for production triage' would need to be scoped down or replaced with a hybrid approach."
- "如果在中文/多语种 Agent 轨迹上，phrase-matching 的 Misalignment 检测精度低于随机基线，则'信号方法的语言无关性'这一隐含假设需要被明确否定。"

An empty "What would change my mind" list is a smell. It usually means the thesis is too vague to be falsifiable, or the researcher avoided engaging with the paper's challenges. Flag it and ask the human to sharpen the thesis.

## Anti-patterns

**Strawman devil's advocate.** "One could argue the paper doesn't cover every possible scenario." This is not a counter-position — it's a complaint. A devil's advocate must identify a specific way the claim could be wrong in a real deployment context.

**Citing Wikipedia, blog posts, or tech reports as cross-check sources.** Blog posts from the same lab count as zero. Wikipedia counts as zero. Cross-checks must be peer-reviewed papers or reproducible empirical results from independent groups.

**Skipping cross-check on load-bearing claims because the paper seems authoritative.** Authority is not a substitute for corroboration. A claim from a highly-cited DeepMind paper still stays at `[med]` until another independent group replicates it.

**Promoting `[low]` inferences to landscape without flagging.** Every `[low]` item in landscape must be visibly marked and noted in the PR body as an inference awaiting corroboration — not silently blended with `[med]` claims.
