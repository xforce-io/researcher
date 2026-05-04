import { describe, it, expect } from 'vitest';
import { classifyContradictions } from '../../src/pipeline/contradictions.js';

describe('classifyContradictions', () => {
  it('treats empty / whitespace-only as nothing', () => {
    expect(classifyContradictions('')).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
    expect(classifyContradictions('   \n\n   ')).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
  });

  it('treats the single word "none" (any case) as nothing', () => {
    expect(classifyContradictions('none')).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
    expect(classifyContradictions('NONE\n')).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
  });

  it('flags `## Contradiction:` headers as real contradictions', () => {
    const body = `# header\n\n## Contradiction: foo bar\n\nbody...\n`;
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: true,
      hasTaxonomyProposal: false,
    });
  });

  it('flags `## Contradiction (scope):` variant too', () => {
    const body = `## Contradiction (paper-internal): X vs Y\n\nbody`;
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: true,
      hasTaxonomyProposal: false,
    });
  });

  it('flags `## Proposed taxonomy extension` as a proposal, not a contradiction', () => {
    const body = `## Proposed taxonomy extension\n\nbucket §1.13...`;
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: true,
    });
  });

  it('flags both when both kinds appear in the same file', () => {
    const body = [
      '## Contradiction: foo',
      'body',
      '',
      '## Proposed taxonomy extension',
      'bucket §1.13',
    ].join('\n');
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: true,
      hasTaxonomyProposal: true,
    });
  });

  it('does not match contradiction-like text outside a header', () => {
    const body = 'This document discusses Contradiction X vs Y but uses no headers.';
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
  });

  it('does not match deeper-than-H2 contradiction headers', () => {
    // The synthesize prompt requires ## (H2) for top-level contradiction sections;
    // a ### sub-header inside another section is not a top-level claim.
    const body = '### Contradiction (sub-discussion): foo';
    expect(classifyContradictions(body)).toEqual({
      hasContradictions: false,
      hasTaxonomyProposal: false,
    });
  });
});
