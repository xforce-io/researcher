import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { identifiersForSource, paperIdForSource, sourceRefForId } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import type { Paper, PaperRead } from '../library/model.js';
import { nextNoteNumber } from '../state/note_index.js';
import { DEFAULT_FM, serializeNote } from '../state/zone.js';
import { runLibraryRead, type LibraryReadRunner } from '../web/library-read.js';
import type { RunContext } from './context.js';

export interface LibraryTopicReadOptions {
  workspaceRoot: string;
  topicPath?: string;
  libraryReadRunner?: LibraryReadRunner;
}

export async function libraryTopicRead(ctx: RunContext, opts: LibraryTopicReadOptions): Promise<void> {
  if (!ctx.addSourceId) throw new Error('library topic read requires addSourceId in context');

  const source = sourceRefForId(ctx.addSourceId);
  const paperId = paperIdForSource(source);
  const lib = new PaperLibrary(opts.workspaceRoot);
  const existingPaper = lib.getPaper(paperId);
  let paper = lib.upsertPaper({
    id: paperId,
    canonicalSource: existingPaper?.canonicalSource ?? source,
    sources: [...(existingPaper?.sources ?? []), source],
    identifiers: { ...(existingPaper?.identifiers ?? {}), ...identifiersForSource(source) },
    tags: existingPaper?.tags ?? [],
    title: existingPaper?.title,
    authors: existingPaper?.authors,
    abstract: existingPaper?.abstract,
  });

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
  paper = lib.getPaper(paper.id) ?? paper;

  const noteRelPath = writeTopicIntegrationNote({
    ctx,
    paper,
    artifact,
    artifactPath: read.artifactPath,
  });

  const topicId = opts.topicPath ?? inferTopicPath(opts.workspaceRoot, ctx.projectRoot);
  lib.upsertLink({
    paperId: paper.id,
    surfaceType: 'topic',
    surfaceId: topicId,
    relation: 'integrated',
    rationale: ctx.triageReason,
  });
  lib.upsertIntegration({
    paperId: paper.id,
    topicId,
    notePath: noteRelPath,
    zone: 'active',
    integratedAt: new Date().toISOString(),
    summary: ctx.triageReason,
  });
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
  opts.lib.upsertRead({ id: readId, paperId: opts.paper.id, status: 'reading' });
  const runner = opts.runner ?? ((runnerOpts) => runLibraryRead({ ...runnerOpts, adapter: opts.ctx.adapter }));
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
    opts.lib.upsertRead({ id: readId, paperId: opts.paper.id, status: 'failed' });
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
  paper: Paper;
  artifact: string;
  artifactPath: string;
}): string {
  const destinationDir = join(opts.ctx.projectRoot, 'notes', 'active');
  mkdirSync(destinationDir, { recursive: true });
  const nextNum = nextNoteNumber(opts.ctx.projectRoot).toString().padStart(2, '0');
  const title = opts.paper.title || opts.paper.identifiers.arxiv || opts.paper.identifiers.url || opts.paper.id;
  const filename = `${nextNum}_${slugify(title)}.md`;
  const relPath = `notes/active/${filename}`;
  const body = [
    `# ${title}`,
    '',
    `> Topic integration note derived from Library read artifact \`${opts.artifactPath}\`.`,
    '',
    '## Library read',
    '',
    opts.artifact.trim(),
    '',
  ].join('\n');
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
