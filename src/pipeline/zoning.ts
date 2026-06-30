import type { NoteEntry } from '../state/note_index.js';
import type { Zone } from '../state/zone.js';

/** Count [N] citations of note `num` across a corpus. Matches [N], [N:..], [N,..]
 *  but not a longer number ([12] is not a hit for 1).
 *  Known limitation: only matches num in LEADING position — [1, 3] counts 1 but [3, 1] does not. */
export function countCitations(num: number, corpus: string): number {
  const re = new RegExp(`\\[\\s*${num}(?=[\\],:\\s])`, 'g');
  return (corpus.match(re) ?? []).length;
}

/** Composite score in [0,1]: 60% citation heat, 40% recency (higher note number = newer). */
export function scoreNote(heat: number, num: number, maxHeat: number, maxNum: number): number {
  const h = maxHeat > 0 ? heat / maxHeat : 0;
  const r = maxNum > 0 ? num / maxNum : 0;
  return 0.6 * h + 0.4 * r;
}

export interface Assignment {
  num: number;
  from: Zone;
  to: Zone;
  moved: boolean;
}

export function assignZones(
  notes: NoteEntry[],
  scores: Map<number, number>,
  cfg: { active_max: number; buffer_max: number; min_dwell: number },
): Assignment[] {
  const pinnedActive = notes.filter((n) => n.fm.pin && n.fm.zone === 'active').length;
  const pinnedBuffer = notes.filter((n) => n.fm.pin && n.fm.zone === 'buffer').length;
  const activeSlots = Math.max(0, cfg.active_max - pinnedActive);
  const bufferSlots = Math.max(0, cfg.buffer_max - pinnedBuffer);

  const unpinned = notes
    .filter((n) => !n.fm.pin)
    .sort((a, b) => {
      const d = (scores.get(b.num) ?? 0) - (scores.get(a.num) ?? 0);
      return d !== 0 ? d : b.num - a.num; // tie: newer first
    });

  const target = new Map<number, Zone>();
  unpinned.forEach((n, i) => {
    const t: Zone = i < activeSlots ? 'active' : i < activeSlots + bufferSlots ? 'buffer' : 'history';
    target.set(n.num, t);
  });

  return notes.map((n) => {
    const from = n.fm.zone;
    const to = n.fm.pin ? from : target.get(n.num)!;
    const moved = !n.fm.pin && to !== from && n.fm.dwell >= cfg.min_dwell;
    return { num: n.num, from, to: moved ? to : from, moved };
  });
}
