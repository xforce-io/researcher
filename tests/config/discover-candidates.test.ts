import { describe, expect, it } from 'vitest';
import { parseDiscoverCandidates } from '../../src/config/discover-candidates.js';

const valid = {
  candidates: [
    {
      id: 'arxiv:2401.12345',
      title: 'A relevant paper',
      url: 'https://arxiv.org/abs/2401.12345',
      abstract: 'A concise summary of the paper.',
      source: 'arxiv',
    },
  ],
  search_summary: 'Searched the configured arXiv sources.',
};

describe('parseDiscoverCandidates', () => {
  it('accepts a valid candidate handoff artifact', () => {
    expect(parseDiscoverCandidates(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects malformed candidate entries', () => {
    expect(() => parseDiscoverCandidates('{"candidates":[{}]}')).toThrow();
  });

  it('canonicalizes an uppercase source namespace while preserving its payload', () => {
    const uppercase = structuredClone(valid);
    uppercase.candidates[0].id = 'ARXIV:2401.12345';
    expect(parseDiscoverCandidates(JSON.stringify(uppercase)).candidates[0].id).toBe('arxiv:2401.12345');
  });

  it.each(['arxiv:', 'doi:', 'openreview:', 'urlhash:'])('rejects an ID without a %s payload', (id) => {
    const bad = structuredClone(valid);
    bad.candidates[0].id = id;
    expect(() => parseDiscoverCandidates(JSON.stringify(bad))).toThrow();
  });
});
