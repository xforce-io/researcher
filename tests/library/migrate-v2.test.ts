import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { PaperLibrary } from '../../src/library/store.js';
import { listResearcherWriters, listUsageLeases, readMaintenanceStage, writeMaintenanceStage } from '../../src/library/maintenance.js';
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
  writeFileSync(join(lib, 'papers/paper_arxiv_2401_12345/source.pdf'), '%PDF-fake\n');
}

function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
}

function seedTopicWithOldRefs(root: string): void {
  writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
  const topic = join(root, 't');
  gitInit(topic);
  writeFileSync(
    join(topic, 'notes.md'),
    'see .researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/x.md and /library/p/paper_arxiv_2401_12345\n',
  );
  execaSync('git', ['add', '-A'], { cwd: topic });
  execaSync('git', ['commit', '-m', 'init'], { cwd: topic });
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

  it('refuses while a matching idle writer lease is alive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-idle-'));
    seedLegacy(root);
    writeFileSync(join(root, 'cli.js'), 'setInterval(() => {}, 1e6);\n');
    const child = spawn(process.execPath, [join(root, 'cli.js'), 'serve'], {
      cwd: root,
      stdio: 'ignore',
    });
    try {
      const deadline = Date.now() + 4000;
      let seen = listResearcherWriters({ workspaceRoot: root });
      while (Date.now() < deadline && !seen.some((w) => w.pid === child.pid)) {
        await new Promise((r) => setTimeout(r, 50));
        seen = listResearcherWriters({ workspaceRoot: root });
      }
      expect(seen.some((w) => w.pid === child.pid && /cli\.js\s+serve/.test(w.command))).toBe(true);
      const result = migrateLibrary({ cwd: root, write: () => {} });
      expect(result.status).toBe('refused');
      expect(result.blockers.join(' ')).toMatch(/writer processes/);
      expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    } finally {
      child.kill('SIGTERM');
    }
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
    expect(existsSync(join(root, '.researcher-workspace/library/documents/paper_arxiv_2401_12345/assets/source.pdf'))).toBe(true);
    expect(listUsageLeases(root).some((l) => l.mode === 'exclusive')).toBe(false);
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

  it('resumes after live rename interrupt without emptying the library', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-resume-'));
    seedLegacy(root);
    const first = migrateLibrary({
      cwd: root,
      listWriters: () => [],
      onAfterLiveRename: () => {
        throw new Error('cut');
      },
      write: () => {},
    });
    expect(first.status).toBe('refused');
    expect(existsSync(join(root, '.researcher-workspace/library/schema.json'))).toBe(false);
    expect(existsSync(join(root, '.researcher-workspace/migrate-staging/library/schema.json'))).toBe(true);
    const resumed = migrateLibrary({ cwd: root, resume: true, listWriters: () => [], write: () => {} });
    expect(resumed.status).toBe('completed');
    expect(resumed.documents).toBe(1);
    const lib = new PaperLibrary(root);
    expect(lib.getDocument('paper_arxiv_2401_12345')?.docType).toBe('paper');
    expect(lib.listNotes('paper_arxiv_2401_12345')).toHaveLength(1);
  });

  it('refuses missing successful read artifacts and leaves the live v1 tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-miss-'));
    seedLegacy(root);
    rmSync(join(root, '.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md'));
    const result = migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} });
    expect(result.status).toBe('refused');
    expect(result.blockers.join(' ')).toMatch(/missing read artifact/);
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    expect(existsSync(join(root, '.researcher-workspace/library/schema.json'))).toBe(false);
    expect(readMaintenanceStage(root)).toBeUndefined();
  });

  it('rewrites topic managed refs and stays references-pending until they are committed', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-refs-'));
    seedLegacy(root);
    seedTopicWithOldRefs(root);
    const first = migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} });
    expect(first.status).toBe('references-pending');
    const notes = readFileSync(join(root, 't/notes.md'), 'utf8');
    expect(notes).toContain('.researcher-workspace/library/documents/');
    expect(notes).toContain('/library/documents/paper_arxiv_2401_12345');
    expect(notes).not.toContain('/library/p/');
    expect(notes).not.toContain('/library/papers/');
    const rolled = migrateLibrary({ cwd: root, rollback: true, listWriters: () => [], write: () => {} });
    expect(rolled.status).toBe('rolled-back');
    const restoredNotes = readFileSync(join(root, 't/notes.md'), 'utf8');
    expect(restoredNotes).toContain('.researcher-workspace/library/papers/');
    expect(restoredNotes).toContain('/library/p/paper_arxiv_2401_12345');
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    const remigrate = migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} });
    expect(remigrate.status).toBe('references-pending');
    const blocked = migrateLibrary({ cwd: root, resume: true, listWriters: () => [], write: () => {} });
    expect(blocked.status).toBe('references-pending');
    execaSync('git', ['add', '-A'], { cwd: join(root, 't') });
    execaSync('git', ['commit', '-m', 'rewrite refs'], { cwd: join(root, 't') });
    const done = migrateLibrary({ cwd: root, resume: true, listWriters: () => [], write: () => {} });
    expect(done.status).toBe('completed');
  });

  it('validates backup, preserves post-migration data, and makes a second rollback a no-op', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-mig-rb-'));
    seedLegacy(root);
    expect(migrateLibrary({ cwd: root, listWriters: () => [], write: () => {} }).status).toBe('completed');
    const lib = new PaperLibrary(root);
    lib.createNote({ id: 'doc_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: '', body: 'keep after migrate', mutationId: 'm1' });
    const first = migrateLibrary({ cwd: root, rollback: true, listWriters: () => [], write: () => {} });
    expect(first.status).toBe('rolled-back');
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    expect(existsSync(join(root, '.researcher-workspace/library/schema.json'))).toBe(false);
    const preserved = readdirSync(join(root, '.researcher-workspace')).filter((n) => n.startsWith('library-post-migration-'));
    expect(preserved.length).toBe(1);
    expect(existsSync(join(root, '.researcher-workspace', preserved[0], 'documents/doc_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/document.md'))).toBe(true);
    const second = migrateLibrary({ cwd: root, rollback: true, listWriters: () => [], write: () => {} });
    expect(second.status).toBe('no-op');
    expect(existsSync(join(root, '.researcher-workspace/library/papers.jsonl'))).toBe(true);
    const missing = migrateLibrary({
      cwd: mkdtempSync(join(tmpdir(), 'r-mig-nobak-')),
      rollback: true,
      listWriters: () => [],
      write: () => {},
    });
    expect(missing.status).toBe('refused');
    expect(missing.blockers.join(' ')).toMatch(/no backup/);
  });
});
