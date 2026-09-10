import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { newDocumentId, PaperLibrary } from '../../src/library/store.js';
import { normalizePaperInput, paperIdForSource } from '../../src/library/identity.js';
import { runLibraryList } from '../../src/commands/library.js';

describe('library documents HTTP/CLI (S1, S5)', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  let base: string;
  let noteId: string;
  let linkedId: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-docs-http-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    const lib = new PaperLibrary(root, { now: () => '2026-09-10T00:00:00.000Z' });
    const paperSource = normalizePaperInput('2401.12345');
    const blogSource = normalizePaperInput('https://example.com/blog/x');
    const linkedSource = normalizePaperInput('2401.99999');
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
      identifiers: { url: 'https://example.com/blog/x' },
      tags: [],
      docType: 'blog',
    });
    linkedId = paperIdForSource(linkedSource);
    lib.upsertPaper({
      id: linkedId,
      canonicalSource: linkedSource,
      sources: [linkedSource],
      identifiers: { arxiv: '2401.99999' },
      tags: [],
      docType: 'paper',
    });
    lib.upsertLink({ paperId: linkedId, surfaceType: 'topic', surfaceId: 't' });
    noteId = newDocumentId();
    lib.createNote({ id: noteId, title: '', body: 'standalone', mutationId: 'm1' });
    server = await startServer({ root, port: 0 });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('Web default Unlinked and CLI --status unlinked both show 3 peers (S5)', async () => {
    const html = await (await fetch(base + '/library')).text();
    expect(html).toContain('Untitled note');
    expect(html).toContain('arXiv 2401.12345');
    expect(html).toContain('https://example.com/blog/x');
    expect(html).toContain(linkedId);
    expect(html).toMatch(/<article class="paper-card row" hidden[^>]*data-linked="1"/);
    const unlinkedUrlHtml = await (await fetch(base + '/library?status=unlinked&type=all')).text();
    expect(unlinkedUrlHtml).toContain(linkedId);
    const badType = await fetch(base + '/library/documents?type=nope', {
      headers: { accept: 'application/json' },
    });
    expect(badType.status).toBe(400);
    expect(html).toMatch(/data-status="saved"/);
    expect(html).toContain('<div class="paper-state">Saved</div>');
    expect(html).toContain('data-type-filter="paper"');
    expect(html).toContain('data-type-filter="blog"');
    expect(html).toContain('data-type-filter="note"');
    expect(html).toContain('data-type="paper"');
    expect(html).toContain('data-type="blog"');
    expect(html).toContain('data-type="note"');
    expect(html).toContain('>note</span>');
    expect(html).toContain('syncLibraryUrl');
    expect(html).toContain("history.replaceState");
    expect(html).not.toMatch(new RegExp(`data-status="read"[^>]*${noteId}|${noteId}[^>]*data-status="read"`));
    const unlinked = await (await fetch(base + '/library/documents?status=unlinked', {
      headers: { accept: 'application/json' },
    })).json() as { id: string; docType: string }[];
    const all = await (await fetch(base + '/library/documents?status=all', {
      headers: { accept: 'application/json' },
    })).json() as { id: string; docType: string }[];
    expect(unlinked).toHaveLength(3);
    expect(all).toHaveLength(4);
    expect(unlinked.map((d) => d.docType).sort()).toEqual(['blog', 'note', 'paper']);
    expect(all.some((d) => d.id === linkedId)).toBe(true);
    expect(unlinked.some((d) => d.id === linkedId)).toBe(false);
    const readOnly = await (await fetch(base + '/library/documents?status=read', {
      headers: { accept: 'application/json' },
    })).json() as { id: string; docType: string }[];
    expect(readOnly.every((d) => d.docType !== 'note')).toBe(true);
    const unlinkedOut: string[] = [];
    runLibraryList({ cwd: root, status: 'unlinked', write: (s) => unlinkedOut.push(s) });
    const allOut: string[] = [];
    runLibraryList({ cwd: root, status: 'all', write: (s) => allOut.push(s) });
    expect(unlinkedOut.join('')).toContain('\tnote\t');
    expect(unlinkedOut.join('').split('\n').filter((l) => l.includes('\t'))).toHaveLength(3);
    expect(allOut.join('').split('\n').filter((l) => l.includes('\t'))).toHaveLength(4);
  });

  it('creates a note over HTTP and reopens it (S1)', async () => {
    const id = newDocumentId();
    const created = await fetch(base + '/library/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docType: 'note', id, title: '', body: 'from http', mutationId: 'h1' }),
    });
    expect(created.status).toBe(201);
    const editor = await (await fetch(base + '/library/documents/new?type=note')).text();
    expect(editor).toContain('setEditingEnabled');
    expect(editor).toContain('beforeunload');
    expect(editor).toContain('Unsaved changes. Discard?');
    const payload = await created.json() as { id: string; url: string };
    const retry = await fetch(base + '/library/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docType: 'note', id, title: '', body: 'from http', mutationId: 'h1' }),
    });
    expect(retry.status).toBe(200);
    const page = await fetch(base + payload.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('from http');
    expect(new PaperLibrary(root).getDocument(id)?.body).toBe('from http');
    expect(new PaperLibrary(root).listDocuments().filter((d) => d.id === id)).toHaveLength(1);
    const bad = await fetch(base + '/library/documents?status=nope', {
      headers: { accept: 'application/json' },
    });
    expect(bad.status).toBe(400);
  });
});
