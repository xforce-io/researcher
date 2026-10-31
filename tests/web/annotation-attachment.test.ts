import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { ATTACHMENT_MAX_BYTES } from '../../src/library/attachment.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';
import { runLibraryCommentAttach, runLibraryShow } from '../../src/commands/library.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('annotation attachments HTTP/CLI', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  let base: string;
  let paperId: string;
  let noteId: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-att-http-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    const lib = new PaperLibrary(root, { now: () => '2026-10-30T00:00:00.000Z' });
    const source = normalizePaperInput('2401.22401');
    paperId = paperIdForSource(source);
    lib.upsertPaper({
      id: paperId,
      canonicalSource: source,
      sources: [source],
      identifiers: { arxiv: '2401.22401' },
      tags: [],
    });
    noteId = newDocumentId();
    lib.createNote({ id: noteId, title: 'n', body: 'standalone', mutationId: 'n1' });
    server = await startServer({ root, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  async function attach(documentId: string, buf: Buffer, name: string, type: string, mutationId: string, caption?: string) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type }), name);
    form.append('mutationId', mutationId);
    if (caption !== undefined) form.append('caption', caption);
    return fetch(`${base}/library/documents/${documentId}/annotations/attachments`, { method: 'POST', body: form });
  }

  it('creates a PDF attachment, lists it, and downloads matching bytes', async () => {
    const pdf = Buffer.from('%PDF-att-1');
    const created = await attach(paperId, pdf, 'clip.pdf', 'application/pdf', 'http-m1', 'see pdf');
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const listed = await fetch(`${base}/library/documents/${paperId}/annotations`);
    expect(listed.status).toBe(200);
    const rows = await listed.json() as Array<{ id: string; attachment?: { filename: string; sha256: string; bytes: number } }>;
    const row = rows.find((r) => r.id === id);
    expect(row?.attachment).toEqual(expect.objectContaining({
      filename: 'clip.pdf',
      bytes: pdf.length,
      sha256: sha256(pdf),
    }));
    expect(row?.attachment).not.toHaveProperty('storedName');
    const file = await fetch(`${base}/library/documents/${paperId}/annotations/${id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('application/pdf');
    const got = Buffer.from(await file.arrayBuffer());
    expect(got.equals(pdf)).toBe(true);
    const html = await (await fetch(`${base}/library/documents/${paperId}`)).text();
    expect(html).toContain('clip.pdf');
    expect(html).toContain('添加附件');
  });

  it('keeps JSON text POST working and rejects exe without writing files', async () => {
    const before = new PaperLibrary(root).listNotes(paperId).length;
    const text = await fetch(`${base}/library/documents/${paperId}/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'still text' }),
    });
    expect(text.status).toBe(201);
    const exe = await attach(paperId, Buffer.from('MZ'), 'bad.exe', 'application/octet-stream', 'exe-1');
    expect(exe.status).toBe(400);
    const body = await exe.json() as { code: string };
    expect(body.code).toBe('unsupported_type');
    expect(new PaperLibrary(root).listNotes(paperId)).toHaveLength(before + 1);
  });

  it('rejects oversize files and JSON on the attachment route', async () => {
    const json = await fetch(`${base}/library/documents/${paperId}/annotations/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'a.pdf' }),
    });
    expect(json.status).toBe(415);
    const huge = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 1);
    const res = await attach(paperId, huge, 'big.pdf', 'application/pdf', 'huge-1');
    expect(res.status).toBe(413);
    const payload = await res.json() as { code: string };
    expect(payload.code).toBe('payload_too_large');
  });

  it('allows annotations on note documents and reports missing files', async () => {
    const notes = await fetch(`${base}/library/documents/${noteId}/annotations`);
    expect(notes.status).toBe(200);
    const pdf = Buffer.from('%PDF-note');
    const created = await attach(noteId, pdf, 'n.pdf', 'application/pdf', 'note-att');
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const page = await (await fetch(`${base}/library/documents/${noteId}`)).text();
    expect(page).toContain('id="annotations"');
    expect(page).toContain('n.pdf');
    const lib = new PaperLibrary(root);
    const note = lib.getNote(id)!;
    unlinkSync(lib.attachmentPath(note)!);
    const missing = await fetch(`${base}/library/documents/${noteId}/annotations/${id}/file`);
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual(expect.objectContaining({ code: 'attachment_missing' }));
    const missingPage = await (await fetch(`${base}/library/documents/${noteId}`)).text();
    expect(missingPage).toContain('>下载</a>');
    expect(missingPage).toContain('data-annotation-file');
    expect(missingPage).toMatch(/data-file-missing role="alert">文件缺失/);
  });

  it('CLI attach then show lists filename bytes sha256 and path', () => {
    const file = join(root, 'cli.pdf');
    writeFileSync(file, '%PDF-cli');
    const out: string[] = [];
    const attached = runLibraryCommentAttach({
      cwd: root,
      documentId: paperId,
      file,
      caption: 'from cli',
      write: (s) => out.push(s),
    });
    expect(out.join('')).toContain(attached.id);
    const show: string[] = [];
    runLibraryShow({ cwd: root, documentId: paperId, write: (s) => show.push(s) });
    const text = show.join('');
    expect(text).toContain('cli.pdf');
    expect(text).toContain(sha256(Buffer.from('%PDF-cli')));
    expect(text).toContain(attached.path);
    const jsonLines: string[] = [];
    runLibraryShow({ cwd: root, documentId: paperId, json: true, write: (s) => jsonLines.push(s) });
    const parsed = JSON.parse(jsonLines.join('')) as { id: string; annotations: Array<{ attachment?: { filename: string } }> };
    expect(parsed.id).toBe(paperId);
    expect(parsed.annotations.some((a) => a.attachment?.filename === 'cli.pdf')).toBe(true);
  });
});
