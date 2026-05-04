import { describe, it, expect } from 'vitest';
import { canonicalizeAddInput } from '../../src/commands/add.js';

describe('canonicalizeAddInput', () => {
  it('routes arxiv-shape input to arxiv: prefix', () => {
    expect(canonicalizeAddInput('2401.12345')).toBe('arxiv:2401.12345');
    expect(canonicalizeAddInput('https://arxiv.org/abs/2401.12345v2')).toBe('arxiv:2401.12345');
  });
  it('routes http(s) URL input to url: prefix', () => {
    expect(canonicalizeAddInput('https://facebookresearch.github.io/RAM/blogs/autodata/'))
      .toBe('url:https://facebookresearch.github.io/RAM/blogs/autodata/');
  });
  it('throws on input that is neither arxiv nor http(s) URL', () => {
    expect(() => canonicalizeAddInput('ftp://example.com/x')).toThrow(/unrecognized input/);
    expect(() => canonicalizeAddInput('garbage')).toThrow(/unrecognized input/);
  });
});
