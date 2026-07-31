import { describe, it, expect } from 'vitest';
import { TriagedSchema, parseTriaged, parseTriagedOutput } from '../../src/config/triaged.js';

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

  it.each(['arxiv:', 'doi:', 'openreview:', 'urlhash:'])('rejects an ID without a %s payload', (id) => {
    const bad = structuredClone(valid);
    bad.candidates[0].id = id;
    expect(() => TriagedSchema.parse(bad)).toThrow();
  });

  it('canonicalizes an uppercase source namespace while preserving its payload', () => {
    const uppercase = structuredClone(valid);
    uppercase.candidates[0].id = 'ARXIV:2401.12345';
    expect(parseTriaged(JSON.stringify(uppercase)).candidates[0].id).toBe('arxiv:2401.12345');
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

describe('parseTriagedOutput', () => {
  it('accepts a pure JSON response unchanged', () => {
    expect(parseTriagedOutput(JSON.stringify(valid)).candidates[0].id).toBe('arxiv:2401.12345');
  });

  it('recovers JSON wrapped in narration prose (2026-07-31 production failure shape)', () => {
    const raw = `正在读取完整候选交接，随后给出分诊结果。\n\n${JSON.stringify(valid, null, 2)}\n\n以上为全部结果。`;
    expect(parseTriagedOutput(raw).candidates[0].decision).toBe('deep-read');
  });

  it('recovers JSON wrapped in a markdown fence', () => {
    const raw = `Here is the result:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(parseTriagedOutput(raw).search_summary).toBe(valid.search_summary);
  });

  it('surfaces the zod error when the response is valid JSON with a wrong schema', () => {
    const bad = structuredClone(valid);
    bad.candidates[0].decision = 'definitely-read' as never;
    expect(() => parseTriagedOutput(JSON.stringify(bad))).toThrow(/decision/);
  });

  it('throws the strict-parse error when no valid JSON can be recovered', () => {
    expect(() => parseTriagedOutput('正在读取完整候选交接')).toThrow(/triaged\.json is not valid JSON/);
  });
});
