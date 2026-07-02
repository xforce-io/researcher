import { describe, it, expect } from 'vitest';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

describe('paper identity', () => {
  it('canonicalizes arxiv inputs and strips version suffixes', () => {
    const source = normalizePaperInput('https://arxiv.org/abs/2401.12345v2');
    expect(source).toEqual({ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' });
    expect(paperIdForSource(source)).toBe('paper_arxiv_2401_12345');
  });

  it('canonicalizes http URLs into deterministic paper ids', () => {
    const a = normalizePaperInput('https://example.com/paper#section');
    const b = normalizePaperInput('https://example.com/paper');
    expect(a).toEqual({ kind: 'url', id: 'url:https://example.com/paper', url: 'https://example.com/paper' });
    expect(paperIdForSource(a)).toBe(paperIdForSource(b));
    expect(paperIdForSource(a)).toMatch(/^paper_url_[a-f0-9]{16}$/);
  });
});
