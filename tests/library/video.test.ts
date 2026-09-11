import { describe, expect, it } from 'vitest';
import {
  acceptVideoUpload,
  classifyAnalysis,
  currentCueAtTime,
  normalizeCues,
  searchCueIds,
  sha256Buffer,
  titleFromFilename,
  VIDEO_MAX_BYTES,
} from '../../src/library/video.js';
import { parseLibraryDocType, supportsDeepRead } from '../../src/library/doc-type.js';

describe('video domain', () => {
  it('parses video as a library type and excludes it from deep-read', () => {
    expect(parseLibraryDocType('video')).toBe('video');
    expect(supportsDeepRead('video')).toBe(false);
    expect(supportsDeepRead('note')).toBe(false);
    expect(supportsDeepRead('paper')).toBe(true);
    expect(() => parseLibraryDocType('novel')).toThrow(/docType/);
  });

  it('accepts mp4/webm pairs and rejects the rest', () => {
    expect(acceptVideoUpload({ filename: 'a.mp4', contentType: 'video/mp4', bytes: 12 })).toEqual({
      ok: true, contentType: 'video/mp4', ext: '.mp4',
    });
    expect(acceptVideoUpload({ filename: 'a.webm', contentType: 'video/webm; charset=binary', bytes: 12 }).ok).toBe(true);
    expect(acceptVideoUpload({ filename: 'a.mov', contentType: 'video/mp4', bytes: 12 }).ok).toBe(false);
    expect(acceptVideoUpload({ filename: 'a.mp4', contentType: 'video/webm', bytes: 12 }).ok).toBe(false);
    expect(acceptVideoUpload({ filename: 'a.mp4', contentType: 'video/mp4', bytes: 0 }).status).toBe(400);
    expect(acceptVideoUpload({ filename: 'a.mp4', contentType: 'video/mp4', bytes: VIDEO_MAX_BYTES + 1 }).status).toBe(413);
  });

  it('titles from filename and fingerprints bytes', () => {
    expect(titleFromFilename('/tmp/Talk One.MP4')).toBe('Talk One');
    expect(titleFromFilename(`${'汉'.repeat(210)}.mp4`).length).toBe(200);
    expect(sha256Buffer(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('normalizes cues and searches case-insensitively', () => {
    const cues = normalizeCues([
      { start: 1, end: 1, text: 'drop equal' },
      { start: 0, end: 2, text: '  Hello Benny  ' },
      { start: 2, end: 4, text: '' },
      { start: 5, end: 8, text: 'Trust the agent' },
    ]);
    expect(cues).toEqual([
      { id: 0, start: 0, end: 2, text: 'Hello Benny' },
      { id: 1, start: 5, end: 8, text: 'Trust the agent' },
    ]);
    expect(searchCueIds(cues, '')).toEqual([0, 1]);
    expect(searchCueIds(cues, 'benny')).toEqual([0]);
    expect(classifyAnalysis([])).toEqual({ noSpeech: true });
    expect(classifyAnalysis(cues)).toEqual({ noSpeech: false });
  });

  it('current cue uses visible [start, end) only', () => {
    const all = [
      { id: 0, start: 0, end: 2, text: 'a' },
      { id: 1, start: 2, end: 5, text: 'theme' },
      { id: 2, start: 1.5, end: 3, text: 'overlap' },
    ];
    expect(currentCueAtTime(all, 0)?.id).toBe(0);
    expect(currentCueAtTime(all, 1.9)?.id).toBe(2);
    expect(currentCueAtTime(all, 2)?.id).toBe(1);
    expect(currentCueAtTime(all, 5)).toBeNull();
    expect(currentCueAtTime(all, -1)).toBeNull();
    const visible = [all[1]];
    expect(currentCueAtTime(visible, 1.9)).toBeNull();
    expect(currentCueAtTime(visible, 2.5)?.id).toBe(1);
  });
});
