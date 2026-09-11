import { describe, expect, it } from 'vitest';
import {
  currentCueInVisible,
  cycleHitIndex,
  visibleCues,
} from '../../src/web/static/video-workbench.js';

const cues = [
  { id: 0, start: 0, end: 2, text: 'Hello Benny' },
  { id: 1, start: 2, end: 5, text: 'theme of trust' },
  { id: 2, start: 1.5, end: 3, text: 'overlap' },
  { id: 3, start: 8, end: 10, text: 'after a gap' },
];

describe('shipped video-workbench visible set and current cue', () => {
  it('filters case-insensitively and keeps [start, end) current-cue among visible only', () => {
    expect(visibleCues(cues, '').map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(visibleCues(cues, 'TRUST').map((c) => c.id)).toEqual([1]);
    expect(visibleCues(
      [{ id: 0, start: 0, end: 1, text: 'Hello', zh: '你好' }],
      '你好',
    ).map((c) => c.id)).toEqual([0]);
    const vis = visibleCues(cues, '');
    expect(currentCueInVisible(vis, 0)?.id).toBe(0);
    expect(currentCueInVisible(vis, 1.9)?.id).toBe(2);
    expect(currentCueInVisible(vis, 2)?.id).toBe(1);
    expect(currentCueInVisible(vis, 6)).toBeNull();
    expect(currentCueInVisible(vis, 12)).toBeNull();
    const onlyTheme = visibleCues(cues, 'theme');
    expect(currentCueInVisible(onlyTheme, 1.9)).toBeNull();
    expect(currentCueInVisible(onlyTheme, 2.5)?.id).toBe(1);
  });

  it('cycles prev/next through hit ids', () => {
    const hits = [0, 3];
    expect(cycleHitIndex(hits, -1, 1)).toBe(0);
    expect(cycleHitIndex(hits, 0, 1)).toBe(1);
    expect(cycleHitIndex(hits, 1, 1)).toBe(0);
    expect(cycleHitIndex(hits, 0, -1)).toBe(1);
    expect(cycleHitIndex([], 0, 1)).toBe(-1);
  });
});
