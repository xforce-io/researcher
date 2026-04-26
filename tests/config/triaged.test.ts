import { describe, it, expect } from 'vitest';
import { TriagedSchema, parseTriaged } from '../../src/config/triaged.js';

const valid = {
  candidates: [
    {
      id: 'arxiv:2401.12345',
      title: 'Some Paper',
      url: 'https://arxiv.org/abs/2401.12345',
      source: 'arxiv',
      decision: 'deep-read',
      axes: { relevance: 3, alignment: 'extends', novelty: 'substantial', gravity: 'medium' },
      reason: 'RQ1: extends — covers RQ1 directly with new topology probes',
    },
  ],
  search_summary: 'ran 3 searches, surveyed 12 candidates, stopped at 1 deep-read pick',
};

describe('TriagedSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(() => TriagedSchema.parse(valid)).not.toThrow();
  });

  it('accepts an empty candidates list (autonomous tick with nothing worth reading)', () => {
    expect(() => TriagedSchema.parse({ candidates: [], search_summary: 'no hits' })).not.toThrow();
  });

  it('rejects relevance outside 0..3', () => {
    const bad = structuredClone(valid);
    bad.candidates[0].axes.relevance = 7;
    expect(() => TriagedSchema.parse(bad)).toThrow();
  });

  it('rejects unknown decision', () => {
    const bad = structuredClone(valid);
    bad.candidates[0].decision = 'definitely-read' as never;
    expect(() => TriagedSchema.parse(bad)).toThrow();
  });

  it('rejects id without canonical namespace prefix', () => {
    const bad = structuredClone(valid);
    bad.candidates[0].id = '2401.12345';
    expect(() => TriagedSchema.parse(bad)).toThrow();
  });

  it('parseTriaged reads a JSON file and returns typed value', () => {
    const out = parseTriaged(JSON.stringify(valid));
    expect(out.candidates[0].decision).toBe('deep-read');
    expect(out.candidates[0].axes.relevance).toBe(3);
  });

  it('parseTriaged surfaces a clear error on malformed JSON', () => {
    expect(() => parseTriaged('not json {')).toThrow(/json|parse/i);
  });
});
