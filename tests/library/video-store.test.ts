import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newAnalysisId, newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { sha256FileSync } from '../../src/library/video.js';

function tinyMp4(path: string, payload = 'mp4-bytes'): void {
  writeFileSync(path, payload);
}

describe('video store', () => {
  it('publishes a video only after copy+fingerprint and survives moving the original (S1)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-vid-s1-'));
    const src = join(root, 'talk.mp4');
    tinyMp4(src);
    const lib = new PaperLibrary(root, { now: () => '2026-09-11T00:00:00.000Z' });
    const id = newDocumentId();
    const created = lib.createVideo({
      id,
      sourcePath: src,
      filename: 'talk.mp4',
      contentType: 'video/mp4',
      bytes: Buffer.byteLength('mp4-bytes'),
      mutationId: 'm1',
    });
    expect(created.docType).toBe('video');
    expect(created.media?.sha256).toBe(sha256FileSync(src));
    expect(lib.listDocuments()).toHaveLength(1);
    unlinkSync(src);
    expect(lib.videoMediaExists(created)).toBe(true);
    expect(existsSync(lib.videoMediaPath(created))).toBe(true);
    expect(lib.filterDocuments({ type: 'video', status: 'unlinked' })).toHaveLength(1);
    expect(lib.filterDocuments({ type: 'video', status: 'unread' })).toHaveLength(0);
    const again = lib.createVideo({
      id,
      sourcePath: lib.videoMediaPath(created),
      filename: 'talk.mp4',
      contentType: 'video/mp4',
      bytes: Buffer.byteLength('mp4-bytes'),
      mutationId: 'm1',
    });
    expect(again.revision).toBe(1);
    expect(lib.listDocuments()).toHaveLength(1);
  });

  it('rejects unsupported ingest without creating a document', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-vid-bad-'));
    const src = join(root, 'x.mov');
    writeFileSync(src, 'nope');
    const lib = new PaperLibrary(root, { now: () => '2026-09-11T00:00:00.000Z' });
    const id = newDocumentId();
    expect(() => lib.createVideo({
      id, sourcePath: src, filename: 'x.mov', contentType: 'video/mp4', bytes: 4, mutationId: 'm1',
    })).toThrow(/mp4|webm/i);
    expect(lib.listDocuments()).toHaveLength(0);
    expect(existsSync(join(root, '.researcher-workspace/library/documents', id, 'document.md'))).toBe(false);
  });

  it('keeps successful cues when a later analysis fails (S4)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-vid-s4-'));
    const src = join(root, 'a.mp4');
    tinyMp4(src);
    const lib = new PaperLibrary(root, { now: () => '2026-09-11T00:00:00.000Z' });
    const id = newDocumentId();
    lib.createVideo({
      id, sourcePath: src, filename: 'a.mp4', contentType: 'video/mp4', bytes: 9, mutationId: 'm1',
    });
    const okId = newAnalysisId();
    lib.writeVideoAnalysis({
      id: okId, documentId: id, status: 'done', createdAt: '2026-09-11T00:00:01.000Z',
      updatedAt: '2026-09-11T00:00:01.000Z',
      cues: [{ id: 0, start: 0, end: 1.2, text: 'hello' }],
    });
    const failId = newAnalysisId();
    lib.writeVideoAnalysis({
      id: failId, documentId: id, status: 'failed', createdAt: '2026-09-11T00:00:02.000Z',
      updatedAt: '2026-09-11T00:00:02.000Z', lastError: 'injected',
    });
    expect(lib.currentCues(id)?.cues[0].text).toBe('hello');
    expect(lib.videoListState(lib.getDocument(id)!)).toBe('failed');
    const emptyId = newAnalysisId();
    lib.writeVideoAnalysis({
      id: emptyId, documentId: id, status: 'done', createdAt: '2026-09-11T00:00:03.000Z',
      updatedAt: '2026-09-11T00:00:03.000Z', noSpeech: true, cues: [],
    });
    expect(lib.currentCues(id)).toEqual({ cues: [], noSpeech: true });
  });

  it('restores only the same fingerprint (S5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-vid-s5-'));
    const src = join(root, 'a.mp4');
    tinyMp4(src, 'same-bytes');
    const lib = new PaperLibrary(root, { now: () => '2026-09-11T00:00:00.000Z' });
    const id = newDocumentId();
    const doc = lib.createVideo({
      id, sourcePath: src, filename: 'a.mp4', contentType: 'video/mp4', bytes: 10, mutationId: 'm1',
    });
    unlinkSync(lib.videoMediaPath(doc));
    expect(lib.videoMediaExists(doc)).toBe(false);
    const other = join(root, 'other.mp4');
    tinyMp4(other, 'other-bytes');
    expect(() => lib.restoreVideoMedia({ id, sourcePath: other, bytes: 11 })).toThrow(/fingerprint/);
    expect(lib.videoMediaExists(doc)).toBe(false);
    lib.restoreVideoMedia({ id, sourcePath: src, bytes: 10 });
    expect(lib.videoMediaExists(doc)).toBe(true);
    expect(lib.listDocuments()).toHaveLength(1);
  });
});
