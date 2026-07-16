import { describe, expect, it } from 'vitest';
import {
  hasPaperDiscoveryQueries,
  resolveRunSourceMode,
} from '../../src/commands/run-source-mode.js';

describe('resolveRunSourceMode (#77)', () => {
  it('selects feed when only x-inbox is present', () => {
    expect(resolveRunSourceMode([
      { kind: 'x-inbox', queries: undefined },
    ])).toBe('feed');
  });

  it('selects paper when only arxiv queries are present', () => {
    expect(resolveRunSourceMode([
      { kind: 'arxiv', queries: ['agent trace'] },
    ])).toBe('paper');
  });

  it('fails loudly when both x-inbox and paper queries are configured', () => {
    expect(() => resolveRunSourceMode([
      { kind: 'x-inbox' },
      { kind: 'arxiv', queries: ['agent systems'] },
    ])).toThrow(/conflicting sources|x-inbox|paper discovery|#77/i);
  });

  it('allows x-inbox alongside placeholder arxiv queries (no real discovery)', () => {
    expect(resolveRunSourceMode([
      { kind: 'x-inbox' },
      { kind: 'arxiv', queries: ['your topic keyword'] },
    ])).toBe('feed');
  });

  it('hasPaperDiscoveryQueries ignores empty and placeholder queries', () => {
    expect(hasPaperDiscoveryQueries([
      { kind: 'arxiv', queries: ['', 'your topic keyword'] },
    ])).toBe(false);
    expect(hasPaperDiscoveryQueries([
      { kind: 'arxiv', queries: ['real keyword'] },
    ])).toBe(true);
  });
});
