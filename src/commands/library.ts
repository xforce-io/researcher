import { identifiersForSource, normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { defaultDocTypeForSource, isNoteDocType, isVideoDocType, parseLibraryDocType, type DocType } from '../library/doc-type.js';
import { displayTitle, PaperLibrary } from '../library/store.js';
import { migrateLibrary } from '../library/migrate-v2.js';
import type { LibraryStatusFilter, TopicIntegration } from '../library/model.js';

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
  const paper = lib.getPaper(opts.paperId);
  if (!paper) throw new Error(`unknown paper id: ${opts.paperId}`);
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
  const paper = lib.getPaper(opts.paperId);
  if (!paper) throw new Error(`unknown paper id: ${opts.paperId}`);
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
  if (!lib.getPaper(opts.paperId)) throw new Error(`unknown paper id: ${opts.paperId}`);
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
