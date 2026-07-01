import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listNotes, nextNoteNumber } from '../../src/state/note_index.js';

describe('note_index', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-idx-'));
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    mkdirSync(join(proj, 'notes/history'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# landscape');
    writeFileSync(join(proj, 'notes/active/07_foo.md'), '---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---\n# foo');
    writeFileSync(join(proj, 'notes/history/01_baz.md'), '---\nzone: history\npin: true\nscore: 0\ndwell: 5\n---\n# baz');
    writeFileSync(join(proj, 'notes/03_legacy.md'), '# legacy no fm'); // ignored until migrated
  });

  it('enumerates notes across zones, excluding 00_ and unmigrated flat notes', () => {
    const got = listNotes(proj).sort((a, b) => a.num - b.num);
    expect(got.map((n) => [n.num, n.zone, n.relPath])).toEqual([
      [1, 'history', 'notes/history/01_baz.md'],
      [7, 'active', 'notes/active/07_foo.md'],
    ]);
    expect(got.find((n) => n.num === 1)!.fm.pin).toBe(true);
  });

  it('nextNoteNumber is max+1', () => {
    expect(nextNoteNumber(proj)).toBe(8);
  });

  it('nextNoteNumber is 1 on an empty/missing notes dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'r-idx-empty-'));
    expect(nextNoteNumber(empty)).toBe(1);
  });
});
