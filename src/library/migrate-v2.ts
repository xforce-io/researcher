import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paper, PaperNote, PaperRead, PaperSurfaceLink, TopicIntegration } from './model.js';
import { LIBRARY_DIR, PaperLibrary, SCHEMA_VERSION } from './store.js';
import {
  listRegisteredSchedulers,
  listResearcherWriters,
  listUsageLeases,
  readMaintenanceStage,
  tryAcquireExclusiveLease,
  writeMaintenanceStage,
  type WriterProcess,
} from './maintenance.js';

export interface MigrateOptions {
  cwd: string;
  dryRun?: boolean;
  resume?: boolean;
  rollback?: boolean;
  listWriters?: (opts: { workspaceRoot: string; migratePid?: number }) => WriterProcess[];
  onActivate?: () => void;
  write?: (s: string) => void;
}

export interface MigrateResult {
  status: 'dry-run' | 'completed' | 'no-op' | 'refused' | 'references-pending' | 'rolled-back';
  documents: number;
  annotations: number;
  reads: number;
  blockers: string[];
  message: string;
}

const defaultWrite = (s: string) => process.stdout.write(s);

export function migrateLibrary(opts: MigrateOptions): MigrateResult {
  const write = opts.write ?? defaultWrite;
  const root = opts.cwd;
  if (opts.rollback) return rollback(root, write);
  const lib = new PaperLibrary(root);
  const stage = readMaintenanceStage(root);

  if (opts.resume) {
    if (stage === 'references-pending') {
      writeMaintenanceStage(root, 'completed');
      write('library migrate: resumed references-pending → completed\n');
      return { status: 'completed', documents: lib.listDocuments().length, annotations: lib.listNotes().length, reads: lib.listReads().length, blockers: [], message: 'resumed' };
    }
    if (stage === 'activating' || stage === 'converting' || stage === 'maintenance') {
      return runConvert(root, opts, write);
    }
    if (stage === 'completed' || lib.layout() === 'v2') {
      return { status: 'no-op', documents: lib.listDocuments().length, annotations: 0, reads: 0, blockers: [], message: 'already version 2' };
    }
  }

  if (lib.layout() === 'v2' && (!stage || stage === 'completed')) {
    const n = lib.listDocuments().length;
    write(`library migrate: already version 2 documents=${n}\n`);
    return { status: 'no-op', documents: n, annotations: lib.listNotes().length, reads: lib.listReads().length, blockers: [], message: 'already version 2' };
  }

  const blockers = preflight(root, opts);
  if (opts.dryRun) {
    const papers = readJsonl<Paper>(join(root, LIBRARY_DIR, 'papers.jsonl'));
    const notes = readJsonl<PaperNote>(join(root, LIBRARY_DIR, 'notes.jsonl'));
    const reads = readJsonl<PaperRead>(join(root, LIBRARY_DIR, 'reads.jsonl'));
    const msg = blockers.length
      ? `dry-run blocked: ${blockers.join('; ')}`
      : `dry-run papers=${papers.length} notes=${notes.length} reads=${reads.length}`;
    write(`library migrate: ${msg}\n`);
    return {
      status: 'dry-run',
      documents: papers.length,
      annotations: notes.length,
      reads: reads.length,
      blockers,
      message: msg,
    };
  }
  if (blockers.length) {
    write(`library migrate: refused ${blockers.join('; ')}\n`);
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers, message: blockers.join('; ') };
  }
  return runConvert(root, opts, write);
}

function preflight(root: string, opts: MigrateOptions): string[] {
  const blockers: string[] = [];
  const listWriters = opts.listWriters ?? listResearcherWriters;
  try {
    const writers = listWriters({ workspaceRoot: root, migratePid: process.pid });
    if (writers.length) {
      blockers.push(`writer processes: ${writers.map((w) => `${w.pid} ${w.command}`).join(', ')}`);
    }
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : String(err));
  }
  const leases = listUsageLeases(root).filter((l) => l.pid !== process.pid);
  if (leases.length) {
    blockers.push(`usage lease held: ${leases.map((l) => `pid=${l.pid} ${l.command}`).join(', ')}`);
  }
  if (!opts.dryRun) {
    const exclusive = tryAcquireExclusiveLease(root, 'researcher library migrate');
    if (exclusive) blockers.push(`exclusive lease refused: ${exclusive}`);
  }
  const schedulers = listRegisteredSchedulers(root);
  if (schedulers.length) blockers.push(`registered schedulers: ${schedulers.join(', ')}`);
  return blockers;
}

function runConvert(root: string, opts: MigrateOptions, write: (s: string) => void): MigrateResult {
  writeMaintenanceStage(root, 'maintenance');
  const libRoot = join(root, LIBRARY_DIR);
  const papers = readJsonl<Paper>(join(libRoot, 'papers.jsonl'));
  const notes = readJsonl<PaperNote>(join(libRoot, 'notes.jsonl'));
  const reads = readJsonl<PaperRead>(join(libRoot, 'reads.jsonl'));
  const links = readJsonl<PaperSurfaceLink>(join(libRoot, 'links.jsonl'));
  const integrations = readJsonl<TopicIntegration>(join(libRoot, 'integrations.jsonl'));

  writeMaintenanceStage(root, 'converting');
  const staging = join(root, '.researcher-workspace', 'migrate-staging');
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  const stagingLib = join(staging, 'library');
  mkdirSync(stagingLib, { recursive: true });
  writeFileSync(join(stagingLib, 'schema.json'), `${JSON.stringify({ version: SCHEMA_VERSION }, null, 2)}\n`);

  const live = new StagingLibrary(stagingLib);
  for (const paper of papers) live.writePaper(paper);
  for (const read of reads) live.writeRead(root, read);
  for (const note of notes) live.writeAnnotation(note);
  for (const link of links) live.writeLink(link);
  for (const integration of integrations) live.writeIntegration(integration);

  writeMaintenanceStage(root, 'activating');
  try {
    opts.onActivate?.();
  } catch (err) {
    write(`library migrate: activate interrupted: ${err instanceof Error ? err.message : String(err)}\n`);
    return {
      status: 'refused',
      documents: papers.length,
      annotations: notes.length,
      reads: reads.length,
      blockers: ['activate interrupted'],
      message: 'activate interrupted; library remains in activating stage',
    };
  }

  const backup = join(root, '.researcher-workspace', `library-backup-${Date.now()}`);
  if (existsSync(libRoot)) {
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(libRoot, backup);
  }
  renameSync(stagingLib, libRoot);
  rmSync(staging, { recursive: true, force: true });
  writeFileSync(join(root, '.researcher-workspace', 'maintenance', 'backup.json'), `${JSON.stringify({ backup }, null, 2)}\n`);
  writeMaintenanceStage(root, 'completed');
  write(`library migrate: completed documents=${papers.length} annotations=${notes.length} reads=${reads.length}\n`);
  return {
    status: 'completed',
    documents: papers.length,
    annotations: notes.length,
    reads: reads.length,
    blockers: [],
    message: 'completed',
  };
}

function rollback(root: string, write: (s: string) => void): MigrateResult {
  const backupMeta = join(root, '.researcher-workspace', 'maintenance', 'backup.json');
  if (!existsSync(backupMeta)) {
    write('library migrate: rollback refused (no backup)\n');
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: ['no backup'], message: 'no backup' };
  }
  const { backup } = JSON.parse(readFileSync(backupMeta, 'utf8')) as { backup: string };
  const libRoot = join(root, LIBRARY_DIR);
  if (existsSync(libRoot)) rmSync(libRoot, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, libRoot);
  writeMaintenanceStage(root, 'completed');
  write('library migrate: rolled back to pre-migration snapshot\n');
  return { status: 'rolled-back', documents: 0, annotations: 0, reads: 0, blockers: [], message: 'rolled-back' };
}

class StagingLibrary {
  constructor(private readonly libRoot: string) {}

  writePaper(paper: Paper): void {
    const dir = join(this.libRoot, 'documents', paper.id);
    mkdirSync(dir, { recursive: true });
    const fm = [
      '---',
      'schemaVersion: 2',
      `id: ${paper.id}`,
      `docType: ${paper.docType ?? 'paper'}`,
      `title: ${JSON.stringify(paper.title ?? '')}`,
      `tags: ${JSON.stringify(paper.tags)}`,
      `createdAt: ${JSON.stringify(paper.createdAt)}`,
      `updatedAt: ${JSON.stringify(paper.updatedAt)}`,
      'revision: 1',
      `canonicalSource: ${JSON.stringify(paper.canonicalSource)}`,
      `sources: ${JSON.stringify(paper.sources)}`,
      `identifiers: ${JSON.stringify(paper.identifiers)}`,
      paper.authors ? `authors: ${JSON.stringify(paper.authors)}` : '',
      paper.abstract ? `abstract: ${JSON.stringify(paper.abstract)}` : '',
      '---',
      '',
    ].filter(Boolean).join('\n');
    writeFileSync(join(dir, 'document.md'), `${fm}\n`);
  }

  writeRead(workspaceRoot: string, read: PaperRead): void {
    const dir = join(this.libRoot, 'documents', read.paperId, 'reads');
    mkdirSync(dir, { recursive: true });
    let artifactPath = read.artifactPath;
    const destMd = join(dir, `${read.id}.md`);
    if (read.artifactPath) {
      const abs = join(workspaceRoot, read.artifactPath);
      if (existsSync(abs)) {
        copyFileSync(abs, destMd);
        artifactPath = `${LIBRARY_DIR}/documents/${read.paperId}/reads/${read.id}.md`;
      }
    }
    writeFileSync(join(dir, `${read.id}.json`), `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id: read.id,
      documentId: read.paperId,
      status: read.status === 'reading' || read.status === 'queued' ? 'failed' : read.status,
      createdAt: read.createdAt,
      updatedAt: read.updatedAt,
      lastError: read.status === 'reading' || read.status === 'queued' ? 'execution interrupted by migration' : read.lastError,
      artifactPath,
    }, null, 2)}\n`);
  }

  writeAnnotation(note: PaperNote): void {
    appendJsonl(join(this.libRoot, 'annotations.jsonl'), {
      id: note.id,
      documentId: note.paperId,
      body: note.body,
      kind: note.kind,
      pinned: note.pinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  }

  writeLink(link: PaperSurfaceLink): void {
    appendJsonl(join(this.libRoot, 'links.jsonl'), {
      documentId: link.paperId,
      surfaceType: link.surfaceType,
      surfaceId: link.surfaceId,
      rationale: link.rationale,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    });
  }

  writeIntegration(row: TopicIntegration): void {
    appendJsonl(join(this.libRoot, 'integrations.jsonl'), {
      documentId: row.paperId,
      topicId: row.topicId,
      notePath: row.notePath,
      zone: row.zone,
      integratedAt: row.integratedAt,
      summary: row.summary,
      landscapeImpact: row.landscapeImpact,
      reportImpact: row.reportImpact,
    });
  }
}

function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, `${prev}${JSON.stringify(row)}\n`);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}
