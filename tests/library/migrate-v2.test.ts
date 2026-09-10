import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperLibrary } from '../../src/library/store.js';
import { writeMaintenanceStage } from '../../src/library/maintenance.js';
import { migrateLibrary } from '../../src/library/migrate-v2.js';

function seedLegacy(root: string): void {
  const lib = join(root, '.researcher-workspace/library');
  mkdirSync(join(lib, 'papers/paper_arxiv_2401_12345/reads'), { recursive: true });
  writeFileSync(join(lib, 'papers.jsonl'), `${JSON.stringify({
    id: 'paper_arxiv_2401_12345',
    canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345' },
    sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345' }],
    identifiers: { arxiv: '2401.12345' },
    tags: ['survey'],
    docType: 'paper',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);
  writeFileSync(join(lib, 'notes.jsonl'), `${JSON.stringify({
    id: 'note_1',
    paperId: 'paper_arxiv_2401_12345',
    body: 'keep me',
    kind: 'idea',
    pinned: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);
  writeFileSync(join(lib, 'links.jsonl'), `${JSON.stringify({
    paperId: 'paper_arxiv_2401_12345',
    surfaceType: 'topic',
    surfaceId: 'trace',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);
  writeFileSync(join(lib, 'integrations.jsonl'), `${JSON.stringify({
    paperId: 'paper_arxiv_2401_12345',
    topicId: 'trace',
    integratedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);
  writeFileSync(join(lib, 'reads.jsonl'), `${JSON.stringify({
    id: 'read_paper_arxiv_2401_12345',
    paperId: 'paper_arxiv_2401_12345',
    status: 'read',
    artifactPath: '.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })}\n`);
  writeFileSync(
    join(lib, 'papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md'),
    '# Essence\n\nkept\n',
  );
}

describe('library migrate v2 (S6)', () => {
  it('dry-run reports scope without writing schema v2', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-dry-'));
    seedLegacy(root);
    const result = migrateLibrary({ cwd: root, dryRun: true, write: () => {} });
    expect(result.status).toBe('dry-run');
    expect(result.documents).toBe(1);
    expect(existsSync(join(root, '.researcher-workspace/library/schema.json'))).toBe(false);
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
  });

  it('refuses while a matching idle writer lease is alive', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-idle-'));
    seedLegacy(root);
    const result = migrateLibrary({
      cwd: root,
      listWriters: () => [{ pid: 424242, command: 'researcher serve --cwd workspace' }],
      write: () => {},
    });
    expect(result.status).toBe('refused');
    expect(result.blockers.join(' ')).toMatch(/writer processes/);
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
  });

  it('completes, preserves relations, and remigrates as no-op', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-ok-'));
    seedLegacy(root);
    const first = migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} });
    expect(first.status).toBe('completed');
    const lib = new PaperLibrary(root);
    expect(lib.getDocument('paper_arxiv_2401_12345')?.docType).toBe('paper');
    expect(lib.listNotes('paper_arxiv_2401_12345')[0].body).toBe('keep me');
    expect(lib.listLinks('paper_arxiv_2401_12345')).toHaveLength(1);
    expect(lib.listIntegrations('paper_arxiv_2401_12345')).toHaveLength(1);
    expect(lib.listReads('paper_arxiv_2401_12345')[0].status).toBe('read');
    expect(readFileSync(join(root, '.researcher-workspace/library/documents/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md'), 'utf8')).toContain('kept');
    const second = migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} });
    expect(second.status).toBe('no-op');
    expect(lib.listDocuments()).toHaveLength(1);
  });

  it('does not release a half-activated tree after activate interrupt', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-int-'));
    seedLegacy(root);
    const result = migrateLibrary({
      cwd: root,
      listWriters: () => [],
      onActivate: () => {
        throw new Error('boom');
      },
      write: () => {},
    });
    expect(result.status).toBe('refused');
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    expect(() => new PaperLibrary(root).listDocuments()).toThrow(/maintenance|legacy layout/);
    writeMaintenanceStage(root, 'completed');
  });
});
