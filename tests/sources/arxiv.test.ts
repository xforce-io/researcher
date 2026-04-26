import { describe, it, expect } from 'vitest';
import { canonicalizeArxivId, arxivAbsUrl, arxivPdfUrl } from '../../src/sources/arxiv.js';

describe('arxiv', () => {
  it('canonicalizes bare id', () => {
    expect(canonicalizeArxivId('2401.12345')).toBe('arxiv:2401.12345');
  });
  it('canonicalizes URL', () => {
    expect(canonicalizeArxivId('https://arxiv.org/abs/2401.12345v2')).toBe('arxiv:2401.12345');
  });
  it('rejects bogus input', () => {
    expect(() => canonicalizeArxivId('foo')).toThrow();
  });
  it('builds abs/pdf URLs', () => {
    expect(arxivAbsUrl('arxiv:2401.12345')).toBe('https://arxiv.org/abs/2401.12345');
    expect(arxivPdfUrl('arxiv:2401.12345')).toBe('https://arxiv.org/pdf/2401.12345');
  });
});
