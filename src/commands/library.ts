import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identifiersForSource, normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { defaultDocTypeForSource, isNoteDocType, isVideoDocType, parseLibraryDocType, type DocType } from '../library/doc-type.js';
import { displayTitle, newReadId, PaperLibrary } from '../library/store.js';
import { migrateLibrary } from '../library/migrate-v2.js';
import type { LibraryStatusFilter, TopicIntegration } from '../library/model.js';
import { defaultLibraryReadRunner, type LibraryReadRunner } from '../web/library-read.js';
import { countBodyStats, isBodyTooShort, loadUrlExtractThreshold, readFailureFields } from '../sources/url-extract.js';

export interface LibraryAddOptions {
  cwd: string;
  input: string;
  tags?: string[];
  docType?: DocType;
  write?: (s: string) => void;
}

export interface LibraryListOptions {
  cwd: string;
  type?: string;
  status?: string;
  query?: string;
  json?: boolean;
  write?: (s: string) => void;
}

export interface LibraryShowOptions {
  cwd: string;
  documentId: string;
  json?: boolean;
  write?: (s: string) => void;
}

export interface LibraryMigrateCliOptions {
  cwd: string;
  dryRun?: boolean;
  resume?: boolean;
  rollback?: boolean;
  write?: (s: string) => void;
}

export interface LibraryLinkOptions {
  cwd: string;
  paperId: string;
  topic: string;
  rationale?: string;
  write?: (s: string) => void;
}

export interface LibraryIntegrateOptions {
  cwd: string;
  paperId: string;
  topic: string;
  notePath?: string;
  zone?: TopicIntegration['zone'];
  summary?: string;
  write?: (s: string) => void;
}

export interface LibraryDeleteOptions {
  cwd: string;
  paperId: string;
  write?: (s: string) => void;
}

export interface LibraryReadCliOptions {
  cwd: string;
  input: string;
  force?: boolean;
  forceRefetch?: boolean;
  pasteFile?: string;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
  runner?: LibraryReadRunner;
}

export interface LibraryUnlinkOptions {
  cwd: string;
  paperId: string;
  topic: string;
  write?: (s: string) => void;
}

const defaultWrite = (s: string) => process.stdout.write(s);
export function runLibraryAdd(opts: LibraryAddOptions): { id: string } {
  const write = opts.write ?? defaultWrite;
  const source = normalizePaperInput(opts.input);
  const lib = new PaperLibrary(opts.cwd);
  const existing = lib.findByCanonicalSource(source.id);
  const id = existing?.id ?? paperIdForSource(source);
  const tags = opts.tags ?? existing?.tags ?? [];
  const docType = opts.docType ?? existing?.docType ?? defaultDocTypeForSource(source);
  if (isNoteDocType(docType) || isVideoDocType(docType)) {
    throw new Error('import cannot create note or video documents');
  }
  const paper = lib.upsertPaper({
    id,
    canonicalSource: existing?.canonicalSource ?? source,
    sources: [...(existing?.sources ?? []), source],
    identifiers: { ...(existing?.identifiers ?? {}), ...identifiersForSource(source) },
    tags,
    title: existing?.title,
    authors: existing?.authors,
    abstract: existing?.abstract,
    docType: docType as DocType,
  });
  write(`${paper.id}\t${paper.canonicalSource.id}\t${paper.docType ?? 'paper'}\n`);
  return { id: paper.id };
}

export const runLibraryImport = runLibraryAdd;

export function runLibraryList(opts: LibraryListOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  if (opts.status && !['all', 'unlinked', 'unread', 'read', 'linked', 'integrated'].includes(opts.status)) {
    throw Object.assign(new Error(`unknown status: ${opts.status}`), { status: 400 });
  }
  if (opts.type && opts.type !== 'all') parseLibraryDocType(opts.type);
  const docs = lib.filterDocuments({
    type: opts.type,
    status: (opts.status ?? 'all') as LibraryStatusFilter,
    query: opts.query,
  });
  if (opts.json) {
    write(`${JSON.stringify(docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      title: d.title,
      tags: d.tags,
      source: d.canonicalSource ?? null,
      updatedAt: d.updatedAt,
    })))}\n`);
    return;
  }
  if (docs.length === 0) {
    write('(no documents)\n');
    return;
  }
  for (const d of docs) {
    const source = d.canonicalSource?.id ?? '—';
    write(`${d.id}\t${d.docType}\t${displayTitle(d)}\t${source}\t${d.updatedAt}\n`);
  }
}

export function runLibraryShow(opts: LibraryShowOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  const doc = lib.getDocument(opts.documentId);
  if (!doc) throw new Error(`unknown document id: ${opts.documentId}`);
  if (opts.json) {
    write(`${JSON.stringify(doc)}\n`);
    return;
  }
  write(`${doc.id}\t${doc.docType}\t${displayTitle(doc)}\n`);
  if (isNoteDocType(doc.docType)) write(`${doc.body}\n`);
  if (isVideoDocType(doc.docType)) {
    const product = lib.currentCues(doc.id);
    if (product) {
      write(product.noSpeech ? 'No speech detected\n' : `${product.cues.length} cues\n`);
      for (const c of product.cues) write(`${c.start}\t${c.end}\t${c.text}\n`);
    }
  }
}

export function runLibraryMigrate(opts: LibraryMigrateCliOptions): number {
  const result = migrateLibrary({
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    resume: opts.resume,
    rollback: opts.rollback,
    write: opts.write,
  });
  if (result.status === 'refused') return 1;
  return 0;
}

export function runLibraryLink(opts: LibraryLinkOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  // Any document can be linked to a topic (#197), not only papers.
  if (!lib.getDocument(opts.paperId)) throw new Error(`unknown document id: ${opts.paperId}`);
  const link = lib.upsertLink({
    paperId: opts.paperId,
    surfaceType: 'topic',
    surfaceId: opts.topic,
    rationale: opts.rationale,
  });
  write(`${link.paperId}\t${link.surfaceType}:${link.surfaceId}\tlinked\n`);
}

export function runLibraryIntegrate(opts: LibraryIntegrateOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  if (!lib.getDocument(opts.paperId)) throw new Error(`unknown document id: ${opts.paperId}`);
  const integratedAt = new Date().toISOString();
  const integration = lib.upsertIntegration({
    paperId: opts.paperId,
    topicId: opts.topic,
    notePath: opts.notePath,
    zone: opts.zone,
    summary: opts.summary,
    integratedAt,
  });
  lib.upsertLink({
    paperId: opts.paperId,
    surfaceType: 'topic',
    surfaceId: opts.topic,
    rationale: opts.summary,
  });
  write(`${integration.paperId}\ttopic:${integration.topicId}\tintegrated\n`);
}

/** Remove only the explicit topic link. Existing integration history remains intact. */
export function runLibraryUnlink(opts: LibraryUnlinkOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  if (!lib.getDocument(opts.paperId)) throw new Error(`unknown document id: ${opts.paperId}`);
  lib.unlink(opts.paperId, 'topic', opts.topic);
  write(`${opts.paperId}\ttopic:${opts.topic}\tunlinked\n`);
}

/** Delete a Library paper only when it has no topic links/integrations. */
export function runLibraryDelete(opts: LibraryDeleteOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  const result = lib.deletePaper(opts.paperId);
  write(`deleted\t${result.paperId}\treads=${result.removedReads}\n`);
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean).sort();
}

const defaultWriteErr = (s: string) => process.stderr.write(s);

export async function runLibraryReadCommand(opts: LibraryReadCliOptions): Promise<void> {
  const write = opts.write ?? defaultWrite;
  const writeErr = opts.writeErr ?? defaultWriteErr;
  const lib = new PaperLibrary(opts.cwd);
  const existingDoc = lib.getDocument(opts.input) ?? lib.getPaper(opts.input);
  const paper = existingDoc
    ? lib.getPaper(existingDoc.id)
    : (() => {
        const added = runLibraryAdd({ cwd: opts.cwd, input: opts.input, write: () => {} });
        return new PaperLibrary(opts.cwd).getPaper(added.id);
      })();
  if (!paper) throw new Error(`unknown document: ${opts.input}`);

  let pastedText: string | undefined;
  if (opts.pasteFile) {
    pastedText = opts.pasteFile === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(opts.pasteFile, 'utf8');
    const threshold = loadUrlExtractThreshold();
    const stats = countBodyStats(pastedText);
    if (isBodyTooShort(pastedText, threshold)) {
      writeErr(`paste too short: ${stats.chars} chars, ${stats.words} words\n`);
      throw Object.assign(new Error(`paste too short: ${stats.chars} chars, ${stats.words} words`), { exitCode: 1 });
    }
  }

  const completed = lib.listReads(paper.id).find(
    (r) => r.status === 'read' && r.artifactPath && existsSync(join(opts.cwd, r.artifactPath)),
  );
  if (completed?.artifactPath && !opts.force && pastedText === undefined) {
    writeErr(`library-read: ${completed.artifactPath} (reuse)\n`);
    return;
  }

  const inFlight = lib.listReads(paper.id).find((r) => r.status === 'reading');
  if (inFlight) {
    lib.upsertRead({
      ...inFlight,
      status: 'failed',
      lastError: 'library read: reclaimed stale reading (no live CLI task)',
    });
    writeErr(`library-read: reclaimed stale reading ${inFlight.id}\n`);
  }

  const readId = newReadId();
  lib.upsertRead({ id: readId, paperId: paper.id, status: 'reading', lastError: undefined });
  const runner = opts.runner ?? defaultLibraryReadRunner;
  try {
    const result = await runner({
      workspaceRoot: opts.cwd,
      paper,
      readId,
      pastedText,
      forceRefetch: pastedText === undefined && (opts.forceRefetch === true || opts.force === true),
      onLine: (line) => writeErr(`${line}\n`),
    });
    if (result.title && !paper.title) {
      lib.upsertPaper({ ...paper, title: result.title });
    }
    lib.upsertRead({
      id: readId,
      paperId: paper.id,
      status: 'read',
      artifactPath: result.artifactPath,
      lastError: undefined,
      extractionMethod: result.extractionMethod,
      extractedChars: result.bodyChars,
      extractedWords: result.bodyWords,
    });
    writeErr(`library-read: ${result.artifactPath}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lib.upsertRead({ id: readId, paperId: paper.id, status: 'failed', lastError: message, ...readFailureFields(err) });
    throw err;
  }
}
