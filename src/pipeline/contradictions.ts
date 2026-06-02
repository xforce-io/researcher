// Classifier for the synthesize stage's contradictions.md output.
//
// The synthesize prompt produces one file that may contain two kinds of
// reviewer-needed content:
//   - Real epistemic contradictions, marked with `## Contradiction: <title>`
//     (or `## Contradiction (<scope>): <title>`) headers. These may force
//     thesis updates.
//   - Taxonomy / landscape extension proposals, marked with the single
//     `## Proposed taxonomy extension` header. These are structural decisions
//     about landscape buckets, not epistemic conflicts; they do NOT force
//     thesis updates.
//
// The runner emits different messages for each kind so the user can route
// attention correctly without warning fatigue from non-actionable findings.

export interface ContradictionsReport {
  hasContradictions: boolean;
  hasTaxonomyProposal: boolean;
  /** Soft, human-adjudicated tension against a super-repo CHARTER invariant. */
  hasCharterTension: boolean;
}

export function classifyContradictions(body: string): ContradictionsReport {
  const trimmed = body.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return { hasContradictions: false, hasTaxonomyProposal: false, hasCharterTension: false };
  }
  return {
    hasContradictions: /^## Contradiction\b/m.test(trimmed),
    hasTaxonomyProposal: /^## Proposed taxonomy extension\b/m.test(trimmed),
    hasCharterTension: /^## Charter tension\b/m.test(trimmed),
  };
}
