import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';

describe('standalone notes (S1–S3)', () => {
  it('creates an untitled note without paper, topic, or source and reopens it', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-note-s1-'));
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const id = newDocumentId();
    const created = lib.createNote({
      id,
      title: '',
      body: 'hello from a standalone note\n',
      mutationId: 'm1',
    });
    expect(created.docType).toBe('note');
    expect(created.title).toBe('');
    expect(created.body).toBe('hello from a standalone note\n');
    expect(created.canonicalSource).toBeUndefined();
    expect(lib.listDocuments()).toHaveLength(1);
    expect(lib.filterDocuments({ status: 'unlinked' }).map((d) => d.id)).toEqual([id]);
    const reopened = lib.getDocument(id);
    expect(reopened?.body).toBe('hello from a standalone note\n');
    expect(existsSync(join(root, '.researcher-workspace/library/documents', id, 'document.md'))).toBe(true);
  });

  it('edits a note and keeps a single identity after a new store instance (S2)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-note-s2-'));
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const id = newDocumentId();
    lib.createNote({ id, title: '', body: 'v1 body', mutationId: 'm1' });
    const updated = lib.updateNote({ id, title: 'T', body: 'v2 body', expectedRevision: 1, mutationId: 'm2' });
    expect(updated.revision).toBe(2);
    expect(updated.body).toBe('v2 body');
    const reloaded = new PaperLibrary(root);
    expect(reloaded.listDocuments()).toHaveLength(1);
    expect(reloaded.getDocument(id)?.body).toBe('v2 body');
    expect(reloaded.getDocument(id)?.id).toBe(id);
  });

  it('rejects blank body and does not duplicate on identical mutation retry (S3)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-note-s3-'));
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const id = newDocumentId();
    expect(() => lib.createNote({ id, title: '', body: '   ', mutationId: 'm1' })).toThrow(/non-empty/);
    expect(lib.listDocuments()).toHaveLength(0);
    lib.createNote({ id, title: '', body: 'ok', mutationId: 'm1' });
    const again = lib.updateNote({ id, title: '', body: 'ok', expectedRevision: 1, mutationId: 'm1' });
    expect(again.revision).toBe(1);
    expect(lib.listDocuments()).toHaveLength(1);
  });

  it('keeps the saved file when a write fails (S3 disk failure)', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-note-s3f-'));
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const id = newDocumentId();
    lib.createNote({ id, title: '', body: 'saved', mutationId: 'm1' });
    const dir = join(root, '.researcher-workspace/library/documents', id);
    chmodSync(dir, 0o555);
    try {
      expect(() => lib.updateNote({ id, title: '', body: 'new', expectedRevision: 1, mutationId: 'm2' })).toThrow();
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readFileSync(join(dir, 'document.md'), 'utf8')).toContain('saved');
    expect(lib.getDocument(id)?.body).toBe('saved');
  });
});

describe('peer documents and force read (S4–S5 store)', () => {
  it('lists paper/blog/note as peers and force-read does not add documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-note-s45-'));
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const paperSource = normalizePaperInput('2401.12345');
    const blogSource = normalizePaperInput('https://example.com/blog/post');
    lib.upsertPaper({
      id: paperIdForSource(paperSource),
      canonicalSource: paperSource,
      sources: [paperSource],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
      docType: 'paper',
    });
    lib.upsertPaper({
      id: paperIdForSource(blogSource),
      canonicalSource: blogSource,
      sources: [blogSource],
      identifiers: { url: 'https://example.com/blog/post' },
      tags: [],
      docType: 'blog',
    });
    const noteId = newDocumentId();
    lib.createNote({ id: noteId, title: '', body: 'n', mutationId: 'm1' });
    lib.upsertNote({ id: 'ann1', paperId: paperIdForSource(paperSource), body: 'human annotation', kind: 'note', pinned: false });
    const paperId = paperIdForSource(paperSource);
    lib.upsertRead({
      id: 'read_old',
      paperId,
      status: 'read',
      artifactPath: `.researcher-workspace/library/documents/${paperId}/reads/read_old.md`,
    });
    const before = lib.listDocuments().length;
    lib.upsertRead({ id: 'read_force', paperId, status: 'read' });
    expect(lib.listDocuments()).toHaveLength(before);
    expect(lib.filterDocuments({ type: 'paper' })).toHaveLength(1);
    expect(lib.filterDocuments({ type: 'blog' })).toHaveLength(1);
    expect(lib.filterDocuments({ type: 'note' })).toHaveLength(1);
    expect(lib.filterDocuments({ status: 'unlinked' })).toHaveLength(3);
    expect(lib.listNotes(paperId)[0].body).toBe('human annotation');
    expect(lib.getDocument(noteId)?.body).toBe('n');
    expect(lib.listReads(paperId)).toHaveLength(2);
  });
});
