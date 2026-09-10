import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execaSync } from 'execa';
import type { Paper, PaperNote, PaperRead, PaperSurfaceLink, TopicIntegration } from './model.js';
import { LIBRARY_DIR, PaperLibrary, SCHEMA_VERSION } from './store.js';
import {
  listRegisteredSchedulers,
  listResearcherWriters,
  listUsageLeases,
  maintenanceDir,
  readMaintenanceStage,
  removeUsageLease,
  tryAcquireExclusiveLease,
  writeMaintenanceStage,
  type WriterProcess,
} from './maintenance.js';
import { hasWorkspaceManifest, loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../workspace/manifest.js';

export interface MigrateOptions {
  cwd: string;
  dryRun?: boolean;
  resume?: boolean;
  rollback?: boolean;
  listWriters?: (opts: { workspaceRoot: string; migratePid?: number }) => WriterProcess[];
  onActivate?: () => void;
  onAfterLiveRename?: () => void;
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

interface MigrateJournal {
  stage: string;
  backup?: string;
  liveRenamed?: boolean;
  stagingActivated?: boolean;
  restored?: boolean;
  paperCount: number;
  topicEdits: { topicPath: string; files: string[] }[];
}

const defaultWrite = (s: string) => process.stdout.write(s);
const JOURNAL = 'migrate-journal.json';
const BACKUP_META = 'backup.json';

export function migrateLibrary(opts: MigrateOptions): MigrateResult {
  const write = opts.write ?? defaultWrite;
  const root = opts.cwd;
  if (opts.rollback) return rollback(root, opts, write);
  const lib = new PaperLibrary(root);
  const stage = readMaintenanceStage(root);

  if (opts.dryRun) {
    const blockers = preflight(root, { ...opts, dryRun: true });
    const papers = readJsonl<Paper>(join(root, LIBRARY_DIR, 'papers.jsonl'));
    const notes = readJsonl<PaperNote>(join(root, LIBRARY_DIR, 'notes.jsonl'));
    const reads = readJsonl<PaperRead>(join(root, LIBRARY_DIR, 'reads.jsonl'));
    const missing = missingReadFiles(root, reads);
    const extra = blockers.concat(missing);
    const msg = extra.length
      ? `dry-run blocked: ${extra.join('; ')}`
      : `dry-run papers=${papers.length} notes=${notes.length} reads=${reads.length}`;
    write(`library migrate: ${msg}\n`);
    return {
      status: 'dry-run',
      documents: papers.length,
      annotations: notes.length,
      reads: reads.length,
      blockers: extra,
      message: msg,
    };
  }

  if (!opts.resume && lib.layout() === 'v2' && (!stage || stage === 'completed')) {
    const n = lib.listDocuments().length;
    write(`library migrate: already version 2 documents=${n}\n`);
    return { status: 'no-op', documents: n, annotations: lib.listNotes().length, reads: lib.listReads().length, blockers: [], message: 'already version 2' };
  }

  const blockers = preflight(root, opts);
  if (blockers.length) {
    write(`library migrate: refused ${blockers.join('; ')}\n`);
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers, message: blockers.join('; ') };
  }
  const exclusive = tryAcquireExclusiveLease(root, 'researcher library migrate');
  if (exclusive) {
    write(`library migrate: refused exclusive lease refused: ${exclusive}\n`);
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: [`exclusive lease refused: ${exclusive}`], message: exclusive };
  }
  try {
    if (opts.resume) {
      if (stage === 'references-pending') return resumeReferences(root, write);
      if (stage === 'activating') return resumeActivating(root, opts, write);
      if (stage === 'converting' || stage === 'maintenance') return runConvert(root, opts, write);
      if (stage === 'completed' || lib.layout() === 'v2') {
        return { status: 'no-op', documents: safeDocCount(lib), annotations: 0, reads: 0, blockers: [], message: 'already version 2' };
      }
    }
    if (lib.layout() === 'v2' && (!stage || stage === 'completed')) {
      const n = lib.listDocuments().length;
      write(`library migrate: already version 2 documents=${n}\n`);
      return { status: 'no-op', documents: n, annotations: lib.listNotes().length, reads: lib.listReads().length, blockers: [], message: 'already version 2' };
    }
    return runConvert(root, opts, write);
  } finally {
    removeUsageLease(root, process.pid);
  }
}

function safeDocCount(lib: PaperLibrary): number {
  try {
    return lib.listDocuments().length;
  } catch {
    return 0;
  }
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
  const schedulers = listRegisteredSchedulers(root);
  if (schedulers.length) blockers.push(`registered schedulers: ${schedulers.join(', ')}`);
  return blockers;
}

function missingReadFiles(root: string, reads: PaperRead[]): string[] {
  const missing: string[] = [];
  for (const read of reads) {
    if (read.status !== 'read' || !read.artifactPath) continue;
    if (!existsSync(join(root, read.artifactPath))) {
      missing.push(`missing read artifact ${read.id}: ${read.artifactPath}`);
    }
  }
  return missing;
}

function runConvert(root: string, opts: MigrateOptions, write: (s: string) => void): MigrateResult {
  const libRoot = join(root, LIBRARY_DIR);
  const papers = readJsonl<Paper>(join(libRoot, 'papers.jsonl'));
  const notes = readJsonl<PaperNote>(join(libRoot, 'notes.jsonl'));
  const reads = readJsonl<PaperRead>(join(libRoot, 'reads.jsonl'));
  const links = readJsonl<PaperSurfaceLink>(join(libRoot, 'links.jsonl'));
  const integrations = readJsonl<TopicIntegration>(join(libRoot, 'integrations.jsonl'));
  const missing = missingReadFiles(root, reads);
  if (missing.length) return refuseBeforeActivate(root, missing, write);
  const topicScan = previewTopicRewrites(root);
  if (topicScan.blockers.length) return refuseBeforeActivate(root, topicScan.blockers, write);

  writeMaintenanceStage(root, 'converting');
  const staging = join(root, '.researcher-workspace', 'migrate-staging');
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  const stagingLib = join(staging, 'library');
  mkdirSync(stagingLib, { recursive: true });
  writeFileSync(join(stagingLib, 'schema.json'), `${JSON.stringify({ version: SCHEMA_VERSION }, null, 2)}\n`);

  const live = new StagingLibrary(stagingLib);
  const convertErrors: string[] = [];
  for (const paper of papers) {
    live.writePaper(paper);
    live.copyAssets(root, paper.id);
  }
  for (const read of reads) {
    const err = live.writeRead(root, read);
    if (err) convertErrors.push(err);
  }
  for (const note of notes) live.writeAnnotation(note);
  for (const link of links) live.writeLink(link);
  for (const integration of integrations) live.writeIntegration(integration);
  if (convertErrors.length) return refuseBeforeActivate(root, convertErrors, write);

  writeMaintenanceStage(root, 'activating');
  const backup = join(root, '.researcher-workspace', `library-backup-${Date.now()}`);
  writeJournal(root, {
    stage: 'activating',
    backup,
    liveRenamed: false,
    stagingActivated: false,
    restored: false,
    paperCount: papers.length,
    topicEdits: topicScan.edits,
  });
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

  return finishActivate(root, opts, write, {
    papers, notes, reads, stagingLib, backup, topicEdits: topicScan.edits,
  });
}

function finishActivate(
  root: string,
  opts: MigrateOptions,
  write: (s: string) => void,
  ctx: {
    papers: Paper[];
    notes: PaperNote[];
    reads: PaperRead[];
    stagingLib: string;
    backup: string;
    topicEdits: { topicPath: string; files: string[] }[];
  },
): MigrateResult {
  const libRoot = join(root, LIBRARY_DIR);
  const staging = dirname(ctx.stagingLib);
  if (existsSync(libRoot) && !pathIsInside(ctx.backup, libRoot)) {
    mkdirSync(dirname(ctx.backup), { recursive: true });
    writeJournal(root, {
      stage: 'activating',
      backup: ctx.backup,
      liveRenamed: false,
      stagingActivated: false,
      restored: false,
      paperCount: ctx.papers.length,
      topicEdits: ctx.topicEdits,
    });
    renameSync(libRoot, ctx.backup);
    writeJournal(root, {
      stage: 'activating',
      backup: ctx.backup,
      liveRenamed: true,
      stagingActivated: false,
      restored: false,
      paperCount: ctx.papers.length,
      topicEdits: ctx.topicEdits,
    });
    try {
      opts.onAfterLiveRename?.();
    } catch (err) {
      write(`library migrate: activate interrupted after live rename: ${err instanceof Error ? err.message : String(err)}\n`);
      return {
        status: 'refused',
        documents: ctx.papers.length,
        annotations: ctx.notes.length,
        reads: ctx.reads.length,
        blockers: ['activate interrupted'],
        message: 'activate interrupted; resume from journal',
      };
    }
  }
  if (existsSync(ctx.stagingLib) && !existsSync(libRoot)) {
    renameSync(ctx.stagingLib, libRoot);
  }
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  writeBackupMeta(root, ctx.backup, false);
  applyTopicRewrites(root, ctx.topicEdits, write);
  writeJournal(root, {
    stage: ctx.topicEdits.length ? 'references-pending' : 'completed',
    backup: ctx.backup,
    liveRenamed: true,
    stagingActivated: true,
    restored: false,
    paperCount: ctx.papers.length,
    topicEdits: ctx.topicEdits,
  });
  if (ctx.topicEdits.length) {
    writeMaintenanceStage(root, 'references-pending');
    const files = ctx.topicEdits.flatMap((e) => e.files.map((f) => `${e.topicPath}:${f}`));
    write(`library migrate: references-pending; commit topic files then resume: ${files.join(', ')}\n`);
    return {
      status: 'references-pending',
      documents: ctx.papers.length,
      annotations: ctx.notes.length,
      reads: ctx.reads.length,
      blockers: ['topic references pending commit'],
      message: 'references-pending',
    };
  }
  writeMaintenanceStage(root, 'completed');
  write(`library migrate: completed documents=${ctx.papers.length} annotations=${ctx.notes.length} reads=${ctx.reads.length}\n`);
  return {
    status: 'completed',
    documents: ctx.papers.length,
    annotations: ctx.notes.length,
    reads: ctx.reads.length,
    blockers: [],
    message: 'completed',
  };
}

function resumeActivating(root: string, opts: MigrateOptions, write: (s: string) => void): MigrateResult {
  const journal = readJournal(root);
  const libRoot = join(root, LIBRARY_DIR);
  const stagingLib = join(root, '.researcher-workspace', 'migrate-staging', 'library');
  const backup = journal?.backup;
  if (existsSync(join(libRoot, 'schema.json'))) {
    return finishCompletedOrPending(root, journal ?? {
      stage: 'activating',
      paperCount: 0,
      topicEdits: [],
    }, write);
  }
  if (existsSync(stagingLib) && !existsSync(libRoot)) {
    renameSync(stagingLib, libRoot);
    if (backup) writeBackupMeta(root, backup, false);
    return finishCompletedOrPending(root, {
      stage: 'activating',
      backup,
      liveRenamed: true,
      stagingActivated: true,
      restored: false,
      paperCount: journal?.paperCount ?? 0,
      topicEdits: journal?.topicEdits ?? [],
    }, write);
  }
  if (backup && existsSync(backup) && !existsSync(libRoot)) {
    renameSync(backup, libRoot);
    write('library migrate: restored live from backup after incomplete activate\n');
    writeMaintenanceStage(root, 'maintenance');
    return runConvert(root, opts, write);
  }
  if (existsSync(join(libRoot, 'papers.jsonl'))) return runConvert(root, opts, write);
  write('library migrate: refused cannot resume activating without journal/backup\n');
  return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: ['cannot resume activating'], message: 'cannot resume activating' };
}

function finishCompletedOrPending(root: string, journal: MigrateJournal, write: (s: string) => void): MigrateResult {
  applyTopicRewrites(root, journal.topicEdits, write);
  writeJournal(root, journal);
  if (journal.topicEdits.length) {
    writeMaintenanceStage(root, 'references-pending');
    write('library migrate: references-pending; commit topic files then resume\n');
    return {
      status: 'references-pending',
      documents: journal.paperCount,
      annotations: 0,
      reads: 0,
      blockers: ['topic references pending commit'],
      message: 'references-pending',
    };
  }
  writeMaintenanceStage(root, 'completed');
  write(`library migrate: completed documents=${journal.paperCount}\n`);
  return { status: 'completed', documents: journal.paperCount, annotations: 0, reads: 0, blockers: [], message: 'completed' };
}

function resumeReferences(root: string, write: (s: string) => void): MigrateResult {
  const journal = readJournal(root);
  if (!journal) {
    writeMaintenanceStage(root, 'completed');
    return { status: 'completed', documents: 0, annotations: 0, reads: 0, blockers: [], message: 'resumed' };
  }
  const blockers: string[] = [];
  for (const edit of journal.topicEdits) {
    const topicDir = join(root, edit.topicPath);
    if (gitPorcelain(topicDir)) blockers.push(`${edit.topicPath} worktree not clean`);
    for (const file of edit.files) {
      const abs = join(topicDir, file);
      if (!existsSync(abs)) {
        blockers.push(`missing ${edit.topicPath}/${file}`);
        continue;
      }
      if (gitPorcelain(topicDir, file)) blockers.push(`${edit.topicPath}/${file} not committed`);
    }
  }
  if (blockers.length) {
    write(`library migrate: references-pending ${blockers.join('; ')}\n`);
    return { status: 'references-pending', documents: journal.paperCount, annotations: 0, reads: 0, blockers, message: blockers.join('; ') };
  }
  writeMaintenanceStage(root, 'completed');
  writeJournal(root, { ...journal, stage: 'completed' });
  write('library migrate: resumed references-pending → completed; update Pointers to topic commits, do not pull first\n');
  return { status: 'completed', documents: journal.paperCount, annotations: 0, reads: 0, blockers: [], message: 'resumed' };
}

function rollback(root: string, opts: MigrateOptions, write: (s: string) => void): MigrateResult {
  const metaPath = join(maintenanceDir(root), BACKUP_META);
  if (!existsSync(metaPath)) {
    write('library migrate: rollback refused (no backup)\n');
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: ['no backup'], message: 'no backup' };
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { backup: string; restored?: boolean };
  if (meta.restored) {
    write('library migrate: rollback no-op (already restored)\n');
    return { status: 'no-op', documents: 0, annotations: 0, reads: 0, blockers: [], message: 'already restored' };
  }
  if (!meta.backup || !existsSync(meta.backup) || !statSync(meta.backup).isDirectory()) {
    write('library migrate: rollback refused (backup missing or invalid)\n');
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: ['backup missing'], message: 'backup missing' };
  }
  const mutex = preflight(root, { ...opts, dryRun: true });
  if (mutex.length) {
    write(`library migrate: rollback refused ${mutex.join('; ')}\n`);
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: mutex, message: mutex.join('; ') };
  }
  const exclusive = tryAcquireExclusiveLease(root, 'researcher library migrate --rollback');
  if (exclusive) {
    write(`library migrate: rollback refused exclusive lease refused: ${exclusive}\n`);
    return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: [`exclusive lease refused: ${exclusive}`], message: exclusive };
  }
  try {
    const libRoot = join(root, LIBRARY_DIR);
    if (existsSync(join(libRoot, 'schema.json'))) {
      const post = join(root, '.researcher-workspace', `library-post-migration-${Date.now()}`);
      mkdirSync(dirname(post), { recursive: true });
      renameSync(libRoot, post);
      write(`library migrate: preserved post-migration library at ${post}\n`);
    } else if (existsSync(libRoot)) {
      write('library migrate: rollback refused (live library is not v2; refusing to delete)\n');
      return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers: ['live not v2'], message: 'live not v2' };
    }
    restoreTopicRewrites(root, write);
    renameSync(meta.backup, libRoot);
    writeBackupMeta(root, meta.backup, true);
    writeMaintenanceStage(root, 'completed');
    write('library migrate: rolled back to pre-migration snapshot\n');
    return { status: 'rolled-back', documents: 0, annotations: 0, reads: 0, blockers: [], message: 'rolled-back' };
  } finally {
    removeUsageLease(root, process.pid);
  }
}

function refuseBeforeActivate(root: string, blockers: string[], write: (s: string) => void): MigrateResult {
  const staging = join(root, '.researcher-workspace', 'migrate-staging');
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  const stage = readMaintenanceStage(root);
  if (stage === 'maintenance' || stage === 'converting') {
    rmSync(join(maintenanceDir(root), 'stage.json'), { force: true });
  }
  write(`library migrate: refused ${blockers.join('; ')}\n`);
  return { status: 'refused', documents: 0, annotations: 0, reads: 0, blockers, message: blockers.join('; ') };
}

function topicRefBackupRoot(root: string): string {
  return join(maintenanceDir(root), 'topic-ref-backup');
}

function previewTopicRewrites(root: string): {
  edits: { topicPath: string; files: string[] }[];
  blockers: string[];
} {
  const edits: { topicPath: string; files: string[] }[] = [];
  const blockers: string[] = [];
  if (!hasWorkspaceManifest(root)) return { edits, blockers };
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  for (const topic of manifest.topics) {
    const topicDir = join(root, topic.path);
    if (!existsSync(topicDir)) continue;
    if (existsSync(join(topicDir, '.git')) && gitPorcelain(topicDir)) {
      blockers.push(`${topic.path} worktree not clean`);
      continue;
    }
    const files: string[] = [];
    for (const abs of walkMdFiles(topicDir)) {
      const before = readFileSync(abs, 'utf8');
      if (rewriteManagedRefs(before) === before) continue;
      files.push(relative(topicDir, abs).replace(/\\/g, '/'));
    }
    if (files.length) edits.push({ topicPath: topic.path, files });
  }
  return { edits, blockers };
}

function applyTopicRewrites(
  root: string,
  edits: { topicPath: string; files: string[] }[],
  write: (s: string) => void,
): void {
  for (const edit of edits) {
    const topicDir = join(root, edit.topicPath);
    const rewritten: string[] = [];
    for (const file of edit.files) {
      const abs = join(topicDir, file);
      if (!existsSync(abs)) continue;
      const before = readFileSync(abs, 'utf8');
      const after = rewriteManagedRefs(before);
      if (after === before) continue;
      const backup = join(topicRefBackupRoot(root), edit.topicPath, file);
      mkdirSync(dirname(backup), { recursive: true });
      if (!existsSync(backup)) writeFileSync(backup, before);
      writeFileSync(abs, after);
      rewritten.push(file);
    }
    if (rewritten.length) write(`library migrate: rewrote ${rewritten.length} file(s) in ${edit.topicPath}\n`);
  }
}

function restoreTopicRewrites(root: string, write: (s: string) => void): void {
  const backupRoot = topicRefBackupRoot(root);
  if (!existsSync(backupRoot) || !statSync(backupRoot).isDirectory()) return;
  let restored = 0;
  for (const abs of walkFiles(backupRoot)) {
    const rel = relative(backupRoot, abs).replace(/\\/g, '/');
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(abs));
    restored += 1;
  }
  if (restored) write(`library migrate: restored ${restored} topic managed ref file(s)\n`);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }
  return out;
}

function rewriteManagedRefs(text: string): string {
  return text
    .replaceAll('.researcher-workspace/library/papers/', '.researcher-workspace/library/documents/')
    .replaceAll('/library/p/', '/library/documents/');
}

function walkMdFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '.researcher-workspace') continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walkMdFiles(abs));
    else if (name.endsWith('.md')) out.push(abs);
  }
  return out;
}

function gitPorcelain(dir: string, file?: string): boolean {
  try {
    const args = ['status', '--porcelain'];
    if (file) args.push('--', file);
    const { stdout } = execaSync('git', args, { cwd: dir, timeout: 5000 });
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

function pathIsInside(parent: string, child: string): boolean {
  return parent === child;
}

function journalPath(root: string): string {
  return join(maintenanceDir(root), JOURNAL);
}

function readJournal(root: string): MigrateJournal | undefined {
  const path = journalPath(root);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MigrateJournal;
  } catch {
    return undefined;
  }
}

function writeJournal(root: string, journal: MigrateJournal): void {
  mkdirSync(maintenanceDir(root), { recursive: true });
  writeFileSync(journalPath(root), `${JSON.stringify(journal, null, 2)}\n`);
}

function writeBackupMeta(root: string, backup: string, restored: boolean): void {
  mkdirSync(maintenanceDir(root), { recursive: true });
  writeFileSync(join(maintenanceDir(root), BACKUP_META), `${JSON.stringify({ backup, restored }, null, 2)}\n`);
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

  copyAssets(workspaceRoot: string, paperId: string): void {
    const oldDir = join(workspaceRoot, LIBRARY_DIR, 'papers', paperId);
    if (!existsSync(oldDir) || !statSync(oldDir).isDirectory()) return;
    const dest = join(this.libRoot, 'documents', paperId, 'assets');
    for (const name of readdirSync(oldDir)) {
      if (name === 'reads' || name === '_extracted') continue;
      const abs = join(oldDir, name);
      if (!statSync(abs).isFile()) continue;
      mkdirSync(dest, { recursive: true });
      copyFileSync(abs, join(dest, name));
    }
  }

  writeRead(workspaceRoot: string, read: PaperRead): string | undefined {
    const dir = join(this.libRoot, 'documents', read.paperId, 'reads');
    mkdirSync(dir, { recursive: true });
    let artifactPath = read.artifactPath;
    const destMd = join(dir, `${read.id}.md`);
    if (read.status === 'read' && read.artifactPath) {
      const abs = join(workspaceRoot, read.artifactPath);
      if (!existsSync(abs)) return `missing read artifact ${read.id}: ${read.artifactPath}`;
      copyFileSync(abs, destMd);
      artifactPath = `${LIBRARY_DIR}/documents/${read.paperId}/reads/${read.id}.md`;
    } else if (read.artifactPath) {
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
    return undefined;
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
