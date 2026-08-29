import { describe, it, expect } from 'vitest';
import { parseNote, serializeNote, DEFAULT_FM } from '../../src/state/zone.js';

describe('note frontmatter', () => {
  it('treats a legacy note without frontmatter as active/unpinned', () => {
    const { fm, body } = parseNote('# Title\n\n## Claims\n- x');
    expect(fm).toEqual(DEFAULT_FM);
    expect(body).toBe('# Title\n\n## Claims\n- x');
  });

  it('parses an existing frontmatter block', () => {
    const src = '---\nzone: history\ntags:\n  - benchmark\npin: true\nscore: 0.4\ndwell: 3\n---\n# T\n\nbody';
    const { fm, body } = parseNote(src);
    expect(fm).toEqual({ zone: 'history', tags: ['benchmark'], pin: true, score: 0.4, dwell: 3 });
    expect(body).toBe('# T\n\nbody');
  });

  it('falls back to default fm when legacy paper: Title: … YAML is invalid (#166)', () => {
    const src =
      '---\n' +
      'paper: Autodata: an automatic data scientist to create high-quality data\n' +
      'authors: Meta FAIR\n' +
      'year: 2026\n' +
      '---\n' +
      '## Claims\n\n- x\n';
    const { fm, body } = parseNote(src);
    expect(fm).toEqual(DEFAULT_FM);
    expect(body).toContain('## Claims');
  });

  it('round-trips serialize(parse(x))', () => {
    const src = '---\nzone: pending\ntags: []\npin: false\nscore: 0\ndwell: 1\n---\n# T\n\nbody\n';
    const { fm, body } = parseNote(src);
    const out = serializeNote(fm, body);
    expect(parseNote(out).fm).toEqual(fm);
    expect(parseNote(out).body).toBe(body);
  });
});
