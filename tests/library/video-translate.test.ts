import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachChineseCues, parseJsonStringArray } from '../../src/library/video-translate.js';
import { searchCueIds } from '../../src/library/video.js';

describe('video Chinese cues', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a JSON string array of the expected length', () => {
    expect(parseJsonStringArray('["你好","世界"]', 2)).toEqual(['你好', '世界']);
    expect(parseJsonStringArray('here: ["a"]', 1)).toEqual(['a']);
    expect(() => parseJsonStringArray('["only"]', 2)).toThrow(/length/);
  });

  it('attaches zh from the translator and searches both languages', async () => {
    const cues = [
      { id: 0, start: 0, end: 1, text: 'Hello Benny' },
      { id: 1, start: 1, end: 2, text: '已经是中文' },
    ];
    const out = await attachChineseCues(cues, async (texts) => {
      expect(texts).toEqual(['Hello Benny']);
      return ['你好 Benny'];
    });
    expect(out[0].zh).toBe('你好 Benny');
    expect(out[1].zh).toBeUndefined();
    expect(searchCueIds(out, '你好')).toEqual([0]);
    expect(searchCueIds(out, '中文')).toEqual([1]);
  });

  it('skips translation when every line is already Chinese', async () => {
    const cues = [{ id: 0, start: 0, end: 1, text: '你好' }];
    const out = await attachChineseCues(cues, async () => {
      throw new Error('should not be called');
    });
    expect(out).toEqual(cues);
  });

  it('keeps English cues when the translator throws', async () => {
    const cues = [{ id: 0, start: 0, end: 1, text: 'Hello' }];
    const out = await attachChineseCues(cues, async () => {
      throw new Error('no key');
    });
    expect(out).toEqual(cues);
  });

  it('keeps partial zh when the stage budget elapses', async () => {
    vi.useFakeTimers();
    const cues = Array.from({ length: 41 }, (_, i) => ({
      id: i, start: i, end: i + 1, text: `line ${i}`,
    }));
    let first = true;
    const p = attachChineseCues(cues, async (texts) => {
      if (first) {
        first = false;
        return texts.map((t) => `zh:${t}`);
      }
      await new Promise(() => {});
      return texts;
    }, { budgetMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const out = await p;
    expect(out[0].zh).toBe('zh:line 0');
    expect(out[40].zh).toBeUndefined();
  });
});
