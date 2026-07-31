import { describe, expect, it } from 'vitest';
import { extractDiscoverCandidatesJson, parseDiscoverCandidates } from '../../src/config/discover-candidates.js';

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

describe('extractDiscoverCandidatesJson', () => {
  it('extracts a fenced json block from agent stdout', () => {
    const raw = `notes\n\`\`\`json\n${JSON.stringify(valid, null, 2)}\n\`\`\`\nbye`;
    expect(extractDiscoverCandidatesJson(raw)).toContain('"arxiv:2401.12345"');
  });

  it('extracts a bare JSON object from mixed stdout', () => {
    const raw = `done\n${JSON.stringify(valid)}\n`;
    expect(extractDiscoverCandidatesJson(raw)).toContain('"candidates"');
  });

  it('returns null when stdout has no valid candidates object', () => {
    expect(extractDiscoverCandidatesJson('no json here')).toBeNull();
    expect(extractDiscoverCandidatesJson('{"foo":1}')).toBeNull();
  });
});
