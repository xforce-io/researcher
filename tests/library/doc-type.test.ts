import { describe, expect, it } from 'vitest';
import { defaultDocTypeForSource, parseDocType } from '../../src/library/doc-type.js';

describe('parseDocType', () => {
  it('accepts known types', () => {
    expect(parseDocType('paper')).toBe('paper');
    expect(parseDocType('design-doc')).toBe('design-doc');
    expect(parseDocType('spec')).toBe('spec');
    expect(parseDocType('blog')).toBe('blog');
    expect(parseDocType('api-doc')).toBe('api-doc');
    expect(parseDocType('other')).toBe('other');
  });

  it('rejects unknown types', () => {
    expect(() => parseDocType('novel')).toThrow(/docType|type/i);
  });
});

describe('defaultDocTypeForSource', () => {
  it('maps arxiv to paper', () => {
    expect(defaultDocTypeForSource({ kind: 'arxiv', id: 'arxiv:2401.1', url: 'https://arxiv.org/abs/2401.1' })).toBe('paper');
  });

  it('heuristics for common URL shapes', () => {
    expect(defaultDocTypeForSource({
      kind: 'url', id: 'url:https://example.com/blog/foo', url: 'https://example.com/blog/foo',
    })).toBe('blog');
    expect(defaultDocTypeForSource({
      kind: 'url',
      id: 'url:https://x.com/vasuman/status/2085806422072418632',
      url: 'https://x.com/vasuman/status/2085806422072418632',
    })).toBe('blog');
    expect(defaultDocTypeForSource({
      kind: 'url', id: 'url:https://example.com/adr/003-cache', url: 'https://example.com/adr/003-cache',
    })).toBe('design-doc');
    expect(defaultDocTypeForSource({
      kind: 'url', id: 'url:https://www.rfc-editor.org/rfc/rfc9110', url: 'https://www.rfc-editor.org/rfc/rfc9110',
    })).toBe('spec');
    expect(defaultDocTypeForSource({
      kind: 'url', id: 'url:https://example.com/docs/api/v1', url: 'https://example.com/docs/api/v1',
    })).toBe('api-doc');
  });

  it('falls back to other for plain URLs', () => {
    expect(defaultDocTypeForSource({
      kind: 'url', id: 'url:https://example.com/about', url: 'https://example.com/about',
    })).toBe('other');
  });
});
