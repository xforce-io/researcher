import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { sha256FileSync } from '../../src/library/video.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

function seedPaper(root: string): string {
  const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
  const source = normalizePaperInput('2401.22400');
  const id = paperIdForSource(source);
  lib.upsertPaper({
    id,
    canonicalSource: source,
    sources: [source],
    identifiers: { arxiv: '2401.22400' },
    tags: [],
  });
  return id;
}

describe('attachment store', () => {
  it('keeps legacy text jsonl rows valid and still requires body', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-att-text-'));
    const id = seedPaper(root);
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    lib.upsertNote({ id: 'note_old', paperId: id, body: 'plain', kind: 'note', pinned: false });
    const row = JSON.parse(readFileSync(join(root, '.researcher-workspace/library/annotations.jsonl'), 'utf8').trim()) as {
      attachment?: unknown;
    };
    expect(row.attachment).toBeUndefined();
    expect(lib.listNotes(id)[0]).toEqual(expect.objectContaining({ id: 'note_old', body: 'plain' }));
    expect(lib.listNotes(id)[0].attachment).toBeUndefined();
    expect(() => lib.upsertNote({ id: 'note_empty', paperId: id, body: '  ', kind: 'note', pinned: false })).toThrow(/body is required/);
  });

  it('writes one file per annotation and deletes the directory with the row', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-att-store-'));
    const id = seedPaper(root);
    const src = join(root, 'clip.pdf');
    writeFileSync(src, '%PDF-fixture');
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    const note = lib.attachNote({
      documentId: id,
      sourcePath: src,
      filename: 'clip.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.byteLength('%PDF-fixture'),
      caption: '',
      mutationId: 'm-att-1',
    });
    expect(note.body).toBe('');
    expect(note.attachment?.filename).toBe('clip.pdf');
    expect(note.attachment?.sha256).toBe(sha256FileSync(src));
    const path = lib.attachmentPath(note)!;
    expect(path).toContain(`/attachments/${note.id}/`);
    expect(path).not.toContain('/assets/');
    expect(existsSync(path)).toBe(true);
    expect(lib.attachmentExists(note)).toBe(true);

    const again = lib.attachNote({
      documentId: id,
      sourcePath: src,
      filename: 'clip.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.byteLength('%PDF-fixture'),
      caption: '',
      mutationId: 'm-att-1',
    });
    expect(again.id).toBe(note.id);
    expect(lib.listNotes(id)).toHaveLength(1);

    writeFileSync(src, '%PDF-other');
    expect(() => lib.attachNote({
      documentId: id,
      sourcePath: src,
      filename: 'clip.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.byteLength('%PDF-other'),
      caption: 'changed',
      mutationId: 'm-att-1',
    })).toThrow(/mutationId conflict/);
    expect(lib.listNotes(id)).toHaveLength(1);

    lib.deleteNote(note.id);
    expect(lib.listNotes(id)).toEqual([]);
    expect(existsSync(join(root, '.researcher-workspace/library/documents', id, 'attachments', note.id))).toBe(false);
  });

  it('cascades attachment files when the document is deleted', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-att-del-'));
    const id = seedPaper(root);
    const src = join(root, 'n.md');
    writeFileSync(src, '# hi');
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    const note = lib.attachNote({
      documentId: id,
      sourcePath: src,
      filename: 'n.md',
      contentType: 'text/markdown',
      bytes: 4,
      mutationId: 'm2',
    });
    const path = lib.attachmentPath(note)!;
    expect(existsSync(path)).toBe(true);
    lib.deletePaper(id);
    expect(lib.listNotes(id)).toEqual([]);
    expect(existsSync(join(root, '.researcher-workspace/library/documents', id))).toBe(false);
  });

  it('allows attachments on note and video documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-att-any-'));
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    const noteId = newDocumentId();
    lib.createNote({ id: noteId, title: 'n', body: 'hello', mutationId: 'n1' });
    const src = join(root, 'p.txt');
    writeFileSync(src, 'hello-file');
    const attached = lib.attachNote({
      documentId: noteId,
      sourcePath: src,
      filename: 'p.txt',
      contentType: 'text/plain',
      bytes: 10,
      mutationId: 'a1',
    });
    expect(attached.paperId).toBe(noteId);
    expect(lib.attachmentExists(attached)).toBe(true);
  });

  it('keeps metadata when the bytes are removed', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-att-miss-'));
    const id = seedPaper(root);
    const src = join(root, 'gone.pdf');
    writeFileSync(src, '%PDF-x');
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    const note = lib.attachNote({
      documentId: id,
      sourcePath: src,
      filename: 'gone.pdf',
      contentType: 'application/pdf',
      bytes: 6,
      mutationId: 'gone',
    });
    unlinkSync(lib.attachmentPath(note)!);
    expect(lib.getNote(note.id)?.attachment?.filename).toBe('gone.pdf');
    expect(lib.attachmentExists(note)).toBe(false);
  });
});
