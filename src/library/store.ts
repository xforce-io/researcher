import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { dump, load } from 'js-yaml';
import { randomUUID } from 'node:crypto';
import type {
  LibraryDocument,
  LibraryStatusFilter,
  Paper,
  PaperNote,
  PaperRead,
  PaperSurfaceLink,
  TopicIntegration,
} from './model.js';
import type { LibraryDocType } from './doc-type.js';
import { isNoteDocType, parseLibraryDocType } from './doc-type.js';
import { maintenanceStage, readMaintenanceStage, withDomainWriteLock } from './maintenance.js';

export const WORKSPACE_STATE_DIR = '.researcher-workspace';
export const LIBRARY_DIR = `${WORKSPACE_STATE_DIR}/library`;
export const SCHEMA_VERSION = 2;
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX_BYTES = 1024 * 1024;

export class LibraryNeedsMigrationError extends Error {
  constructor() {
    super('library is on the legacy layout; run: researcher library migrate');
    this.name = 'LibraryNeedsMigrationError';
  }
}

export class LibraryMaintenanceError extends Error {
  constructor(stage: string) {
    super(`library maintenance in progress (${stage}); run: researcher library migrate --resume`);
    this.name = 'LibraryMaintenanceError';
  }
}

interface Clock {
  now: () => string;
}

type PaperInput = Omit<Paper, 'createdAt' | 'updatedAt'> & Partial<Pick<Paper, 'createdAt' | 'updatedAt'>>;
type ReadInput = Omit<PaperRead, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperRead, 'createdAt' | 'updatedAt'>>;
type NoteInput = Omit<PaperNote, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperNote, 'createdAt' | 'updatedAt'>>;
type LinkInput = Omit<PaperSurfaceLink, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperSurfaceLink, 'createdAt' | 'updatedAt'>>;
type IntegrationInput = TopicIntegration;

const systemClock: Clock = { now: () => new Date().toISOString() };

export function newDocumentId(): string {
  return `doc_${randomUUID()}`;
}

export function newReadId(): string {
  return `read_${randomUUID()}`;
}

export function isSafeLibraryId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== 'new' && id !== 'import';
}

export class PaperLibrary {
  private readonly clock: Clock;

  constructor(readonly workspaceRoot: string, opts: Partial<Clock> = {}) {
    this.clock = { ...systemClock, ...opts };
  }

  get rootDir(): string {
    return join(this.workspaceRoot, LIBRARY_DIR);
  }

  layout(): 'empty' | 'v1' | 'v2' | 'mixed' {
    const schema = readSchema(this.rootDir);
    if (schema?.version === SCHEMA_VERSION) return 'v2';
    const hasLegacy = existsSync(this.path('papers.jsonl'))
      || existsSync(this.path('reads.jsonl'))
      || existsSync(this.path('notes.jsonl'));
    const hasV2 = existsSync(join(this.rootDir, 'documents'));
    if (hasLegacy && hasV2) return 'mixed';
    if (hasV2) return 'v2';
    if (hasLegacy) return 'v1';
    return 'empty';
  }

  assertReady(): void {
    const stage = readMaintenanceStage(this.workspaceRoot);
    if (stage && stage !== 'completed') throw new LibraryMaintenanceError(stage);
    const layout = this.layout();
    if (layout === 'v1' || layout === 'mixed') throw new LibraryNeedsMigrationError();
  }

  ensureV2(): void {
    this.assertReady();
    if (this.layout() === 'empty') {
      mkdirSync(this.rootDir, { recursive: true });
      writeSchema(this.rootDir);
    }
  }

  listDocuments(): LibraryDocument[] {
    this.assertReady();
    if (this.layout() === 'empty') return [];
    const dir = join(this.rootDir, 'documents');
    if (!existsSync(dir)) return [];
    const docs: LibraryDocument[] = [];
    for (const id of readdirSync(dir).sort()) {
      if (!isSafeLibraryId(id)) continue;
      const doc = this.readDocumentFile(id);
      if (doc) docs.push(doc);
    }
    return docs.sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
    });
  }

  getDocument(id: string): LibraryDocument | undefined {
    this.assertReady();
    if (!isSafeLibraryId(id)) return undefined;
    return this.readDocumentFile(id);
  }

  findByCanonicalSource(sourceId: string): LibraryDocument | undefined {
    return this.listDocuments().find((d) =>
      d.canonicalSource?.id === sourceId || d.sources.some((s) => s.id === sourceId),
    );
  }

  upsertPaper(input: PaperInput): Paper {
    this.ensureV2();
    const existing = this.getDocument(input.id);
    const now = this.clock.now();
    const doc: LibraryDocument = {
      id: input.id,
      docType: (input.docType ?? existing?.docType ?? 'paper') as LibraryDocType,
      title: input.title ?? existing?.title ?? '',
      tags: uniqueStrings(input.tags),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
      lastMutationId: existing?.lastMutationId,
      body: existing?.body ?? '',
      canonicalSource: existing?.canonicalSource ?? input.canonicalSource,
      sources: uniqueSources([...(existing?.sources ?? []), ...input.sources]),
      identifiers: { ...(existing?.identifiers ?? {}), ...input.identifiers },
      authors: input.authors ?? existing?.authors,
      abstract: input.abstract ?? existing?.abstract,
    };
    this.writeDocument(doc);
    return documentToPaper(doc);
  }

  getPaper(id: string): Paper | undefined {
    const doc = this.getDocument(id);
    if (!doc || isNoteDocType(doc.docType) || !doc.canonicalSource) return undefined;
    return documentToPaper(doc);
  }

  listPapers(): Paper[] {
    return this.listDocuments()
      .filter((d) => !isNoteDocType(d.docType) && d.canonicalSource)
      .map(documentToPaper);
  }

  createNote(input: {
    id: string;
    title: string;
    body: string;
    mutationId: string;
  }): LibraryDocument {
    this.ensureV2();
    if (!/^doc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) {
      throw new Error('id must be doc_UUID');
    }
    validateNoteFields(input.title, input.body);
    return withDomainWriteLock(this.workspaceRoot, () => {
      const existing = this.getDocument(input.id);
      if (existing) {
        if (!isNoteDocType(existing.docType)) throw new Error(`document already exists: ${input.id}`);
        if (existing.lastMutationId === input.mutationId) {
          if (existing.title === input.title && existing.body === input.body) return existing;
          throw Object.assign(new Error('mutationId conflict'), { status: 409 });
        }
        throw new Error(`document already exists: ${input.id}`);
      }
      const now = this.clock.now();
      const doc: LibraryDocument = {
        id: input.id,
        docType: 'note',
        title: input.title,
        tags: [],
        createdAt: now,
        updatedAt: now,
        revision: 1,
        lastMutationId: input.mutationId,
        body: input.body,
        sources: [],
        identifiers: {},
      };
      this.writeDocument(doc);
      return doc;
    });
  }

  updateNote(input: {
    id: string;
    title: string;
    body: string;
    expectedRevision: number;
    mutationId: string;
  }): LibraryDocument {
    this.ensureV2();
    validateNoteFields(input.title, input.body);
    return withDomainWriteLock(this.workspaceRoot, () => {
      const existing = this.getDocument(input.id);
      if (!existing) throw Object.assign(new Error(`unknown document: ${input.id}`), { status: 404 });
      if (!isNoteDocType(existing.docType)) {
        throw Object.assign(new Error(`document is not a note: ${input.id}`), { status: 422 });
      }
      if (existing.lastMutationId === input.mutationId) {
        if (existing.title === input.title && existing.body === input.body) return existing;
        throw Object.assign(new Error('mutationId conflict'), { status: 409 });
      }
      if (existing.revision !== input.expectedRevision) {
        throw Object.assign(new Error('revision conflict'), { status: 409, currentRevision: existing.revision });
      }
      const now = this.clock.now();
      const doc: LibraryDocument = {
        ...existing,
        title: input.title,
        body: input.body,
        updatedAt: now,
        revision: existing.revision + 1,
        lastMutationId: input.mutationId,
      };
      this.writeDocument(doc);
      return doc;
    });
  }

  upsertRead(input: ReadInput): PaperRead {
    this.ensureV2();
    const existing = this.listReads().find((r) => r.id === input.id);
    const now = this.clock.now();
    const read: PaperRead = {
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    const dir = join(this.rootDir, 'documents', read.paperId, 'reads');
    mkdirSync(dir, { recursive: true });
    const jsonPath = join(dir, `${read.id}.json`);
    atomicWrite(jsonPath, `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id: read.id,
      documentId: read.paperId,
      status: read.status,
      createdAt: read.createdAt,
      updatedAt: read.updatedAt,
      mutationId: read.mutationId,
      lastError: read.lastError,
      artifactPath: read.artifactPath,
    }, null, 2)}\n`);
    return read;
  }

  listReads(paperId?: string): PaperRead[] {
    this.assertReady();
    if (this.layout() === 'empty') return [];
    const docsDir = join(this.rootDir, 'documents');
    if (!existsSync(docsDir)) return [];
    const reads: PaperRead[] = [];
    const ids = paperId ? [paperId] : readdirSync(docsDir);
    for (const id of ids) {
      const readsDir = join(docsDir, id, 'reads');
      if (!existsSync(readsDir) || !statSync(readsDir).isDirectory()) continue;
      for (const fname of readdirSync(readsDir)) {
        if (!fname.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(readFileSync(join(readsDir, fname), 'utf8')) as {
            id: string;
            documentId: string;
            status: PaperRead['status'];
            createdAt: string;
            updatedAt: string;
            mutationId?: string;
            lastError?: string;
            artifactPath?: string;
          };
          reads.push({
            id: raw.id,
            paperId: raw.documentId,
            status: raw.status,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            mutationId: raw.mutationId,
            lastError: raw.lastError,
            artifactPath: raw.artifactPath,
          });
        } catch {
          /* skip corrupt read records */
        }
      }
    }
    return (paperId ? reads.filter((r) => r.paperId === paperId) : reads)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  upsertNote(input: NoteInput): PaperNote {
    this.ensureV2();
    const existing = this.listNotes().find((n) => n.id === input.id);
    const now = this.clock.now();
    const body = input.body.trim();
    if (!body) throw new Error('note body is required');
    const note: PaperNote = {
      ...input,
      body,
      pinned: input.pinned ?? existing?.pinned ?? false,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('annotations.jsonl'), annotationRecord(note), (n) => n.id);
    return note;
  }

  listNotes(paperId?: string): PaperNote[] {
    this.assertReady();
    const notes = readJsonl<AnnotationRecord>(this.path('annotations.jsonl')).map(recordToNote);
    const filtered = paperId ? notes.filter((n) => n.paperId === paperId) : notes;
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
    });
  }

  getNote(id: string): PaperNote | undefined {
    return this.listNotes().find((n) => n.id === id);
  }

  deleteNote(id: string): { deleted: true; noteId: string } {
    this.ensureV2();
    const existing = this.getNote(id);
    if (!existing) throw new Error(`unknown note id: ${id}`);
    writeJsonlFilter(this.path('annotations.jsonl'), (n: AnnotationRecord) => n.id !== id);
    return { deleted: true, noteId: id };
  }

  upsertLink(input: LinkInput): PaperSurfaceLink {
    this.ensureV2();
    const keyOf = (l: LinkRecord) => `${l.documentId}\t${l.surfaceType}\t${l.surfaceId}`;
    const existing = this.listLinks().find(
      (l) => l.paperId === input.paperId && l.surfaceType === input.surfaceType && l.surfaceId === input.surfaceId,
    );
    const now = this.clock.now();
    const link: PaperSurfaceLink = {
      paperId: input.paperId,
      surfaceType: input.surfaceType,
      surfaceId: input.surfaceId,
      rationale: input.rationale,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('links.jsonl'), linkRecord(link), keyOf);
    return link;
  }

  listLinks(paperId?: string): PaperSurfaceLink[] {
    this.assertReady();
    const links = readJsonl<LinkRecord & { relation?: string; paperId?: string }>(this.path('links.jsonl'))
      .filter((link) => link.relation !== 'rejected' && link.relation !== 'archived')
      .map((row) => recordToLink(row));
    return (paperId ? links.filter((l) => l.paperId === paperId) : links)
      .sort((a, b) => `${a.paperId}:${a.surfaceType}:${a.surfaceId}`.localeCompare(`${b.paperId}:${b.surfaceType}:${b.surfaceId}`));
  }

  unlink(paperId: string, surfaceType: PaperSurfaceLink['surfaceType'], surfaceId: string): { unlinked: true } {
    this.ensureV2();
    const found = this.listLinks(paperId).some(
      (link) => link.surfaceType === surfaceType && link.surfaceId === surfaceId,
    );
    if (!found) throw new Error(`no link for ${paperId} on ${surfaceType}:${surfaceId}`);
    writeJsonlFilter(
      this.path('links.jsonl'),
      (link: LinkRecord) => !(link.documentId === paperId && link.surfaceType === surfaceType && link.surfaceId === surfaceId),
    );
    return { unlinked: true };
  }

  upsertIntegration(input: IntegrationInput): TopicIntegration {
    this.ensureV2();
    const keyOf = (i: IntegrationRecord) => `${i.documentId}\t${i.topicId}`;
    writeJsonlUpsert(this.path('integrations.jsonl'), integrationRecord(input), keyOf);
    return input;
  }

  listIntegrations(paperId?: string): TopicIntegration[] {
    this.assertReady();
    const integrations = readJsonl<IntegrationRecord & { paperId?: string }>(this.path('integrations.jsonl'))
      .map(recordToIntegration);
    return paperId ? integrations.filter((i) => i.paperId === paperId) : integrations;
  }

  reclaimOrphanReads(reason = 'serve restarted while reading — previous task did not record a final state'): PaperRead[] {
    const reclaimed: PaperRead[] = [];
    for (const read of this.listReads()) {
      if (read.status !== 'reading') continue;
      reclaimed.push(this.upsertRead({
        ...read,
        status: 'failed',
        lastError: reason,
      }));
    }
    return reclaimed;
  }

  deletePaper(id: string): { deleted: true; paperId: string; removedReads: number } {
    this.ensureV2();
    const paper = this.getPaper(id);
    if (!paper) throw new Error(`unknown paper id: ${id}`);

    const topicLinks = this.listLinks(id).filter((l) => l.surfaceType === 'topic');
    if (topicLinks.length > 0) {
      throw new Error(
        `cannot delete ${id}: linked to topic(s) ${topicLinks.map((l) => l.surfaceId).join(', ')}. unlink first.`,
      );
    }
    const integrations = this.listIntegrations(id);
    if (integrations.length > 0) {
      throw new Error(
        `cannot delete ${id}: has topic integration(s) on ${integrations.map((i) => i.topicId).join(', ')}.`,
      );
    }
    const otherLinks = this.listLinks(id);
    if (otherLinks.length > 0) {
      throw new Error(`cannot delete ${id}: still linked to ${otherLinks.length} surface(s).`);
    }

    const reads = this.listReads(id);
    writeJsonlFilter(this.path('annotations.jsonl'), (n: AnnotationRecord) => n.documentId !== id);
    writeJsonlFilter(this.path('links.jsonl'), (l: LinkRecord) => l.documentId !== id);
    writeJsonlFilter(this.path('integrations.jsonl'), (i: IntegrationRecord) => i.documentId !== id);

    const artifactDir = join(this.rootDir, 'documents', id);
    if (existsSync(artifactDir)) rmSync(artifactDir, { recursive: true, force: true });

    return { deleted: true, paperId: id, removedReads: reads.length };
  }

  filterDocuments(opts: {
    type?: string;
    status?: LibraryStatusFilter | string;
    query?: string;
  }): LibraryDocument[] {
    const type = (opts.type ?? 'all').toLowerCase();
    const status = (opts.status ?? 'all') as string;
    if (status && !['all', 'unlinked', 'unread', 'read', 'linked', 'integrated'].includes(status)) {
      throw Object.assign(new Error(`unknown status: ${status}`), { status: 400 });
    }
    if (type && type !== 'all') parseLibraryDocType(type);
    let docs = this.listDocuments();
    if (type && type !== 'all') docs = docs.filter((d) => d.docType === type);
    if (status !== 'all') {
      docs = docs.filter((d) => documentMatchesStatus(this, d, status));
    }
    const q = opts.query?.trim().toLowerCase();
    if (q) {
      docs = docs.filter((d) => {
        const hay = [
          d.title,
          ...d.tags,
          d.canonicalSource?.id ?? '',
          ...d.sources.map((s) => s.id),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return docs;
  }

  private readDocumentFile(id: string): LibraryDocument | undefined {
    const path = join(this.rootDir, 'documents', id, 'document.md');
    if (!existsSync(path)) return undefined;
    try {
      return parseDocumentMarkdown(readFileSync(path, 'utf8'), id);
    } catch {
      return undefined;
    }
  }

  private writeDocument(doc: LibraryDocument): void {
    if (!isSafeLibraryId(doc.id)) throw new Error(`unsafe document id: ${doc.id}`);
    const dir = join(this.rootDir, 'documents', doc.id);
    mkdirSync(dir, { recursive: true });
    atomicWrite(join(dir, 'document.md'), serializeDocumentMarkdown(doc));
    writeSchema(this.rootDir);
  }

  private path(file: string): string {
    return join(this.rootDir, file);
  }
}

interface AnnotationRecord {
  id: string;
  documentId: string;
  body: string;
  kind: PaperNote['kind'];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LinkRecord {
  documentId: string;
  surfaceType: PaperSurfaceLink['surfaceType'];
  surfaceId: string;
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

interface IntegrationRecord {
  documentId: string;
  topicId: string;
  notePath?: string;
  zone?: TopicIntegration['zone'];
  integratedAt: string;
  summary?: string;
  landscapeImpact?: string;
  reportImpact?: string;
}

function annotationRecord(note: PaperNote): AnnotationRecord {
  return {
    id: note.id,
    documentId: note.paperId,
    body: note.body,
    kind: note.kind,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function recordToNote(row: AnnotationRecord & { paperId?: string }): PaperNote {
  return {
    id: row.id,
    paperId: row.documentId ?? row.paperId ?? '',
    body: row.body,
    kind: row.kind,
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function linkRecord(link: PaperSurfaceLink): LinkRecord {
  return {
    documentId: link.paperId,
    surfaceType: link.surfaceType,
    surfaceId: link.surfaceId,
    rationale: link.rationale,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function recordToLink(row: LinkRecord & { paperId?: string }): PaperSurfaceLink {
  return {
    paperId: row.documentId ?? row.paperId ?? '',
    surfaceType: row.surfaceType,
    surfaceId: row.surfaceId,
    rationale: row.rationale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function integrationRecord(row: TopicIntegration): IntegrationRecord {
  return {
    documentId: row.paperId,
    topicId: row.topicId,
    notePath: row.notePath,
    zone: row.zone,
    integratedAt: row.integratedAt,
    summary: row.summary,
    landscapeImpact: row.landscapeImpact,
    reportImpact: row.reportImpact,
  };
}

function recordToIntegration(row: IntegrationRecord & { paperId?: string }): TopicIntegration {
  return {
    paperId: row.documentId ?? row.paperId ?? '',
    topicId: row.topicId,
    notePath: row.notePath,
    zone: row.zone,
    integratedAt: row.integratedAt,
    summary: row.summary,
    landscapeImpact: row.landscapeImpact,
    reportImpact: row.reportImpact,
  };
}

export function documentToPaper(doc: LibraryDocument): Paper {
  if (!doc.canonicalSource) throw new Error(`document ${doc.id} has no canonicalSource`);
  return {
    id: doc.id,
    canonicalSource: doc.canonicalSource,
    sources: doc.sources,
    title: doc.title || undefined,
    authors: doc.authors,
    abstract: doc.abstract,
    identifiers: doc.identifiers,
    tags: doc.tags,
    docType: isNoteDocType(doc.docType) ? undefined : (doc.docType as Paper['docType']),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function documentMatchesStatus(lib: PaperLibrary, doc: LibraryDocument, status: string): boolean {
  const links = lib.listLinks(doc.id).filter((l) => l.surfaceType === 'topic');
  const integrations = lib.listIntegrations(doc.id);
  const linked = links.length > 0;
  const integrated = integrations.length > 0;
  if (status === 'unlinked') return !linked;
  if (status === 'linked') return linked;
  if (status === 'integrated') return integrated;
  if (status === 'unread' || status === 'read') {
    if (isNoteDocType(doc.docType)) return false;
    const reads = lib.listReads(doc.id);
    if (status === 'unread') return reads.length === 0;
    const latest = [...reads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest?.status === 'read';
  }
  return true;
}

export function displayTitle(doc: LibraryDocument): string {
  if (doc.title) return doc.title;
  if (isNoteDocType(doc.docType)) return 'Untitled note';
  if (doc.canonicalSource?.kind === 'arxiv') {
    return `arXiv ${doc.identifiers.arxiv ?? doc.canonicalSource.id.replace(/^arxiv:/, '')}`;
  }
  return doc.canonicalSource?.url ?? doc.canonicalSource?.id ?? doc.id;
}

function validateNoteFields(title: string, body: string): void {
  if (typeof title !== 'string') throw Object.assign(new Error('title is required'), { status: 400, field: 'title' });
  if ([...title].length > NOTE_TITLE_MAX) {
    throw Object.assign(new Error('title exceeds 200 code points'), { status: 400, field: 'title' });
  }
  if (typeof body !== 'string') throw Object.assign(new Error('body is required'), { status: 400, field: 'body' });
  if (!body.trim()) throw Object.assign(new Error('body must be non-empty'), { status: 400, field: 'body' });
  if (Buffer.byteLength(body, 'utf8') > NOTE_BODY_MAX_BYTES) {
    throw Object.assign(new Error('body exceeds 1 MiB'), { status: 400, field: 'body' });
  }
}

interface SchemaFile {
  version: number;
}

function readSchema(rootDir: string): SchemaFile | undefined {
  const path = join(rootDir, 'schema.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SchemaFile;
  } catch {
    return undefined;
  }
}

function writeSchema(rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  atomicWrite(join(rootDir, 'schema.json'), `${JSON.stringify({ version: SCHEMA_VERSION }, null, 2)}\n`);
}

function serializeDocumentMarkdown(doc: LibraryDocument): string {
  const fm: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    docType: doc.docType,
    title: doc.title,
    tags: doc.tags,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    revision: doc.revision,
  };
  if (doc.lastMutationId) fm.lastMutationId = doc.lastMutationId;
  if (doc.canonicalSource) fm.canonicalSource = doc.canonicalSource;
  if (doc.sources.length) fm.sources = doc.sources;
  if (Object.keys(doc.identifiers).length) fm.identifiers = doc.identifiers;
  if (doc.authors) fm.authors = doc.authors;
  if (doc.abstract) fm.abstract = doc.abstract;
  return `---\n${dump(fm, { noRefs: true, lineWidth: 120 }).trimEnd()}\n---\n${doc.body}`;
}

function parseDocumentMarkdown(raw: string, expectedId: string): LibraryDocument {
  if (!raw.startsWith('---')) throw new Error('missing frontmatter');
  const end = raw.indexOf('\n---', 3);
  if (end < 0) throw new Error('unterminated frontmatter');
  const fm = load(raw.slice(4, end)) as Record<string, unknown>;
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const id = String(fm.id ?? '');
  if (id !== expectedId) throw new Error('document id mismatch');
  return {
    id,
    docType: String(fm.docType ?? 'paper') as LibraryDocType,
    title: typeof fm.title === 'string' ? fm.title : '',
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    createdAt: String(fm.createdAt ?? ''),
    updatedAt: String(fm.updatedAt ?? ''),
    revision: Number(fm.revision ?? 1),
    lastMutationId: typeof fm.lastMutationId === 'string' ? fm.lastMutationId : undefined,
    body,
    canonicalSource: fm.canonicalSource as LibraryDocument['canonicalSource'],
    sources: Array.isArray(fm.sources) ? fm.sources as LibraryDocument['sources'] : [],
    identifiers: (fm.identifiers as LibraryDocument['identifiers']) ?? {},
    authors: Array.isArray(fm.authors) ? fm.authors.map(String) : undefined,
    abstract: typeof fm.abstract === 'string' ? fm.abstract : undefined,
  };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

function writeJsonlUpsert<T>(path: string, item: T, keyOf: (x: T) => string): void {
  const byKey = new Map<string, T>();
  for (const existing of readJsonl<T>(path)) byKey.set(keyOf(existing), existing);
  byKey.set(keyOf(item), item);
  mkdirSync(dirname(path), { recursive: true });
  const lines = [...byKey.values()].map((x) => JSON.stringify(x));
  atomicWrite(path, lines.length ? `${lines.join('\n')}\n` : '');
}

function writeJsonlFilter<T>(path: string, keep: (item: T) => boolean): void {
  const kept = readJsonl<T>(path).filter(keep);
  mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, kept.length ? `${kept.map((x) => JSON.stringify(x)).join('\n')}\n` : '');
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function uniqueSources(items: Paper['sources']): Paper['sources'] {
  const byId = new Map(items.map((s) => [s.id, s]));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export { maintenanceStage, readMaintenanceStage };
