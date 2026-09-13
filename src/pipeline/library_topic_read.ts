import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { identifiersForSource, paperIdForSource, sourceRefForId } from '../library/identity.js';
import { displayTitle, PaperLibrary } from '../library/store.js';
import type { Paper, PaperRead } from '../library/model.js';
import { cuesIntegrationBody, integrationSourceState } from './integration_source.js';
import { nextNoteNumber } from '../state/note_index.js';
import { DEFAULT_FM, serializeNote } from '../state/zone.js';
import { defaultLibraryReadRunner, type LibraryReadRunner } from '../web/library-read.js';
import { libraryReadEmbedBody } from '../markdown/frontmatter.js';
import type { RunContext } from './context.js';

export interface LibraryTopicReadOptions {
  workspaceRoot: string;
  topicPath?: string;
  libraryReadRunner?: LibraryReadRunner;
}

export async function libraryTopicRead(ctx: RunContext, opts: LibraryTopicReadOptions): Promise<void> {
  // Exactly one addressing mode (#197): a source ref (discover / add / read) or
  // an existing Library document (linked queue). Never both, never neither.
  if (ctx.addSourceId && ctx.addDocumentId) {
    throw new Error('library topic read requires exactly one of addSourceId / addDocumentId, got both');
  }
  if (!ctx.addSourceId && !ctx.addDocumentId) {
    throw new Error('library topic read requires addSourceId or addDocumentId in context');
  }

  const lib = new PaperLibrary(opts.workspaceRoot);
  const documentId = ctx.addDocumentId ?? paperIdForSource(sourceRefForId(ctx.addSourceId!));

  if (ctx.addSourceId) upsertSourceDocument(lib, ctx.addSourceId);

  const doc = lib.getDocument(documentId);
  if (!doc) throw new Error(`unknown document for topic integration: ${documentId}`);

  const state = integrationSourceState(lib, doc);
  if (!state.ready) {
    throw new Error(`document ${documentId} has no integration source: ${state.reason}`);
  }

  let title: string;
  let body: string;
  if (state.kind === 'read') {
    const paper = lib.getPaper(documentId);
    if (!paper) throw new Error(`document is not deep-readable: ${documentId}`);
    // Keep seen.jsonl behaviour identical for external material reached by id.
    ctx.addSourceId = paper.canonicalSource.id;
    const read = await ensureLibraryRead({
      workspaceRoot: opts.workspaceRoot,
      paper,
      lib,
      ctx,
      runner: opts.libraryReadRunner,
    });
    if (!read.artifactPath) throw new Error(`Library read for ${paper.id} has no artifact path`);
    const artifactAbs = join(opts.workspaceRoot, read.artifactPath);
    if (!existsSync(artifactAbs)) throw new Error(`Library read artifact missing: ${read.artifactPath}`);
    const artifact = readFileSync(artifactAbs, 'utf8');
    // The read runner may have written the title: re-read before naming the note.
    const fresh = lib.getPaper(paper.id) ?? paper;
    title = paperTitle(fresh);
    body = [
      `> Topic integration note derived from Library read artifact \`${read.artifactPath}\`.`,
      '',
      '## Library read',
      '',
      libraryReadEmbedBody(artifact, title),
    ].join('\n');
  } else if (state.kind === 'note-body') {
    title = displayTitle(doc);
    body = [
      '> Topic integration note derived from a standalone Library note.',
      '',
      '## Note',
      '',
      doc.body.trim(),
    ].join('\n');
  } else {
    const product = lib.currentCues(documentId);
    if (!product) throw new Error(`video transcript vanished during integration: ${documentId}`);
    title = displayTitle(doc);
    body = [
      '> Topic integration note derived from the video transcript.',
      '',
      '## Transcript',
      '',
      cuesIntegrationBody(product.cues),
    ].join('\n');
  }

  const noteRelPath = writeTopicIntegrationNote({ ctx, title, body });

  const topicId = opts.topicPath ?? inferTopicPath(opts.workspaceRoot, ctx.projectRoot);
  // Defer Library "integrated" until synthesize actually rewrites the landscape.
  // Marking here made Web show "in landscape" while 00_research_landscape.md was still empty.
  if (!lib.listLinks(documentId).some((l) => l.surfaceType === 'topic' && l.surfaceId === topicId)) {
    lib.upsertLink({
      paperId: documentId,
      surfaceType: 'topic',
      surfaceId: topicId,
      rationale: ctx.triageReason,
    });
  }
  ctx.pendingLibraryIntegration = {
    workspaceRoot: opts.workspaceRoot,
    paperId: documentId,
    topicId,
    notePath: noteRelPath,
    zone: 'active',
    summary: ctx.triageReason,
  };
}

/** Discover / add / read reach the Library by source ref, creating the document. */
function upsertSourceDocument(lib: PaperLibrary, addSourceId: string): void {
  const source = sourceRefForId(addSourceId);
  const paperId = paperIdForSource(source);
  const existingPaper = lib.getPaper(paperId);
  lib.upsertPaper({
    id: paperId,
    canonicalSource: existingPaper?.canonicalSource ?? source,
    sources: [...(existingPaper?.sources ?? []), source],
    identifiers: { ...(existingPaper?.identifiers ?? {}), ...identifiersForSource(source) },
    tags: existingPaper?.tags ?? [],
    title: existingPaper?.title,
    authors: existingPaper?.authors,
    abstract: existingPaper?.abstract,
  });
}

function paperTitle(paper: Paper): string {
  return paper.title || paper.identifiers.arxiv || paper.identifiers.url || paper.id;
}

/** Record Library integration after landscape synthesize has been verified. */
export function finalizeLibraryIntegration(
  ctx: RunContext,
  opts?: { workspaceRoot?: string; topicPath?: string },
): void {
  const pending = ctx.pendingLibraryIntegration;
  if (!pending) return;

  const workspaceRoot = opts?.workspaceRoot ?? pending.workspaceRoot;
  const topicId = opts?.topicPath ?? pending.topicId;
  const notePath = ctx.newNoteRelPath ?? pending.notePath;
  const zone: 'active' | 'buffer' | 'history' = notePath.includes('/buffer/')
    ? 'buffer'
    : notePath.includes('/history/')
      ? 'history'
      : (pending.zone ?? 'active');
  const lib = new PaperLibrary(workspaceRoot);
  lib.upsertLink({
    paperId: pending.paperId,
    surfaceType: 'topic',
    surfaceId: topicId,
    rationale: pending.summary ?? ctx.triageReason,
  });
  lib.upsertIntegration({
    paperId: pending.paperId,
    topicId,
    notePath,
    zone,
    integratedAt: new Date().toISOString(),
    summary: pending.summary ?? ctx.triageReason,
  });
  ctx.pendingLibraryIntegration = undefined;
}

async function ensureLibraryRead(opts: {
  workspaceRoot: string;
  paper: Paper;
  lib: PaperLibrary;
  ctx: RunContext;
  runner?: LibraryReadRunner;
}): Promise<PaperRead> {
  const existing = latestReadableArtifact(opts.lib, opts.paper.id, opts.workspaceRoot);
  if (existing) return existing;

  const readId = `read_${opts.paper.id}`;
  opts.lib.upsertRead({ id: readId, paperId: opts.paper.id, status: 'reading', lastError: undefined });
  // Library-read uses defaultLibraryReadRunner (createAgentRuntime / grok-cli),
  // never the topic ctx.adapter instance (#136). Factory selection is #163.
  const runner = opts.runner ?? defaultLibraryReadRunner;
  try {
    const result = await runner({
      workspaceRoot: opts.workspaceRoot,
      paper: opts.paper,
      readId,
    });
    if (result.title && !opts.paper.title) {
      opts.lib.upsertPaper({ ...opts.paper, title: result.title });
    }
    return opts.lib.upsertRead({ id: readId, paperId: opts.paper.id, status: 'read', artifactPath: result.artifactPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.lib.upsertRead({ id: readId, paperId: opts.paper.id, status: 'failed', lastError: message });
    throw err;
  }
}

function latestReadableArtifact(lib: PaperLibrary, paperId: string, workspaceRoot: string): PaperRead | undefined {
  return lib.listReads(paperId)
    .filter((r) => r.status === 'read' && r.artifactPath && existsSync(join(workspaceRoot, r.artifactPath)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function writeTopicIntegrationNote(opts: {
  ctx: RunContext;
  title: string;
  body: string;
}): string {
  const destinationDir = join(opts.ctx.projectRoot, 'notes', 'active');
  mkdirSync(destinationDir, { recursive: true });
  const nextNum = nextNoteNumber(opts.ctx.projectRoot).toString().padStart(2, '0');
  const title = opts.title;
  const filename = `${nextNum}_${slugify(title)}.md`;
  const relPath = `notes/active/${filename}`;
  const body = [`# ${title}`, '', opts.body, ''].join('\n');
  const content = serializeNote({ ...DEFAULT_FM, zone: 'active', tags: [] }, body);
  writeFileSync(join(opts.ctx.projectRoot, relPath), content);
  opts.ctx.newNoteFilename = filename;
  opts.ctx.newNoteRelPath = relPath;
  opts.ctx.newNoteContent = content;
  return relPath;
}

function inferTopicPath(workspaceRoot: string, topicRoot: string): string {
  const rel = relative(workspaceRoot, topicRoot);
  return rel && !rel.startsWith('..') ? rel : basename(topicRoot);
}

function slugify(seed: string): string {
  return seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_').slice(0, 6).join('_') || 'paper';
}
