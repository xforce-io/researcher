import { describe, it, expect } from 'vitest';
import { countCitations, scoreNote, assignZones } from '../../src/pipeline/zoning.js';
import type { NoteEntry } from '../../src/state/note_index.js';
import type { Zone } from '../../src/state/zone.js';

function note(num: number, zone: Zone, dwell: number, pin = false): NoteEntry {
  return {
    num, filename: `${num}_x.md`, zone,
    relPath: `notes/${zone}/${num}_x.md`, absPath: '/x',
    fm: { zone, pin, score: 0, dwell },
  };
}

describe('countCitations', () => {
  it('counts [N], [N, ..], [N: ..] but not [NN] superstrings', () => {
    const corpus = 'see [1] and [1: §2] and [1, 3] and [12] and [21]';
    expect(countCitations(1, corpus)).toBe(3);
    expect(countCitations(12, corpus)).toBe(1);
  });
});

describe('assignZones', () => {
  const cfg = { active_max: 2, buffer_max: 2, min_dwell: 2 };

  it('fills active then buffer then history by score desc', () => {
    const notes = [note(1,'active',5), note(2,'active',5), note(3,'active',5), note(4,'active',5), note(5,'active',5)];
    const scores = new Map([[1,0.9],[2,0.8],[3,0.7],[4,0.6],[5,0.5]]);
    const a = assignZones(notes, scores, cfg);
    const to = (n: number) => a.find((x) => x.num === n)!.to;
    expect([to(1),to(2)]).toEqual(['active','active']);
    expect([to(3),to(4)]).toEqual(['buffer','buffer']);
    expect(to(5)).toBe('history');
  });

  it('respects hysteresis: a note below min_dwell does not move', () => {
    const notes = [note(1,'active',0), note(2,'active',5), note(3,'active',5)]; // note1 just arrived
    const scores = new Map([[1,0.1],[2,0.9],[3,0.8]]); // note1 should drop to buffer by score
    const a = assignZones(notes, scores, { active_max: 2, buffer_max: 2, min_dwell: 2 });
    expect(a.find((x) => x.num === 1)!.moved).toBe(false); // dwell 0 < 2 → stays
    expect(a.find((x) => x.num === 1)!.to).toBe('active');
  });

  it('never moves a pinned note', () => {
    const notes = [note(1,'history',9,true), note(2,'active',9), note(3,'active',9)];
    const scores = new Map([[1,0.99],[2,0.5],[3,0.4]]);
    const a = assignZones(notes, scores, { active_max: 2, buffer_max: 2, min_dwell: 0 });
    const e1 = a.find((x) => x.num === 1)!;
    expect(e1.moved).toBe(false);
    expect(e1.to).toBe('history');
  });
});
