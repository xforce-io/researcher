import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listIntegratedNotes, listNotes, nextNoteNumber } from '../../src/state/note_index.js';

describe('note_index', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-idx-'));
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    mkdirSync(join(proj, 'notes/history'), { recursive: true });
    mkdirSync(join(proj, 'notes/pending'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# landscape');
    writeFileSync(join(proj, 'notes/active/07_foo.md'), '---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---\n# foo');
    writeFileSync(join(proj, 'notes/history/01_baz.md'), '---\nzone: history\npin: true\nscore: 0\ndwell: 5\n---\n# baz');
    writeFileSync(join(proj, 'notes/pending/09_pending.md'), '---\nzone: pending\ntags: []\npin: false\nscore: 0\ndwell: 0\n---\n# pending');
    writeFileSync(join(proj, 'notes/03_legacy.md'), '# legacy no fm');
  });

  it('enumerates all readable notes, excluding 00_', () => {
    const got = listNotes(proj).sort((a, b) => a.num - b.num);
    expect(got.map((n) => [n.num, n.zone, n.relPath])).toEqual([
      [1, 'history', 'notes/history/01_baz.md'],
      [3, 'active', 'notes/03_legacy.md'],
      [7, 'active', 'notes/active/07_foo.md'],
      [9, 'pending', 'notes/pending/09_pending.md'],
    ]);
    expect(got.find((n) => n.num === 1)!.fm.pin).toBe(true);
  });

  it('can enumerate only integrated notes for synthesis/rebalance', () => {
    const got = listIntegratedNotes(proj).sort((a, b) => a.num - b.num);
    expect(got.map((n) => [n.num, n.zone, n.relPath])).toEqual([
      [1, 'history', 'notes/history/01_baz.md'],
      [7, 'active', 'notes/active/07_foo.md'],
    ]);
  });

  it('nextNoteNumber is max+1', () => {
    expect(nextNoteNumber(proj)).toBe(10);
  });

  it('enumerates leftover unquoted paper: Title: … notes without throwing (#166)', () => {
    writeFileSync(
      join(proj, 'notes/14_autodata.md'),
      '---\n' +
        'paper: Autodata: an automatic data scientist to create high-quality data\n' +
        'year: 2026\n' +
        '---\n' +
        '# Autodata\n',
    );
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    writeFileSync(
      join(proj, 'notes/active/14_autodata.md'),
      '---\nzone: active\ntags: []\npin: false\nscore: 0\ndwell: 0\n---\n# Autodata\n',
    );
    expect(() => listNotes(proj)).not.toThrow();
    expect(nextNoteNumber(proj)).toBe(15);
    const leftover = listNotes(proj).find((n) => n.relPath === 'notes/14_autodata.md');
    expect(leftover).toBeDefined();
    expect(leftover!.fm).toMatchObject({ zone: 'active', pin: false });
  });

  it('nextNoteNumber is 1 on an empty/missing notes dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'r-idx-empty-'));
    expect(nextNoteNumber(empty)).toBe(1);
  });
});
