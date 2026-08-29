import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { identifiersForSource, paperIdForSource, sourceRefForId } from '../library/identity.js';
import { defaultDocTypeForSource } from '../library/doc-type.js';
import { LIBRARY_DIR, PaperLibrary } from '../library/store.js';
import { hasWorkspaceManifest } from '../workspace/manifest.js';
import { parseNote } from '../state/zone.js';
import type { RunContext } from './context.js';

/** Walk up from `start` until a researcher.workspace.yml is found. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (hasWorkspaceManifest(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * After a successful workspace-topic `add`, upsert the paper into the Library,
 * write a completed read artifact from the topic note, and link the topic.
 * No-op for standalone topic repos (#164).
 */
export function registerAddInWorkspaceLibrary(ctx: RunContext): void {
  if (!ctx.addSourceId || !ctx.newNoteContent || !ctx.newNoteRelPath) return;
  const workspaceRoot = findWorkspaceRoot(ctx.projectRoot);
  if (!workspaceRoot) return;
  const topicPath = relative(workspaceRoot, ctx.projectRoot).replace(/\\/g, '/');
  if (!topicPath || topicPath === '.' || topicPath.startsWith('..')) return;

  const source = sourceRefForId(ctx.addSourceId);
  const paperId = paperIdForSource(source);
  const { body } = parseNote(ctx.newNoteContent);
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const lib = new PaperLibrary(workspaceRoot);
  const existing = lib.getPaper(paperId);
  const paper = lib.upsertPaper({
    id: paperId,
    canonicalSource: existing?.canonicalSource ?? source,
    sources: [...(existing?.sources ?? []), source],
    identifiers: { ...(existing?.identifiers ?? {}), ...identifiersForSource(source) },
    tags: existing?.tags ?? [],
    title: title || existing?.title,
    authors: existing?.authors,
    abstract: existing?.abstract,
    docType: existing?.docType ?? defaultDocTypeForSource(source),
  });

  const readId = `read_${paperId}`;
  const artifactPath = `${LIBRARY_DIR}/papers/${paperId}/reads/${readId}.md`;
  const absArtifact = join(workspaceRoot, artifactPath);
  mkdirSync(dirname(absArtifact), { recursive: true });
  const sourceUrl = source.url ?? '';
  const artifact = [
    '---',
    `title: ${JSON.stringify(paper.title || paper.id)}`,
    `authors: ${JSON.stringify(paper.authors ?? [])}`,
    `paper_id: ${JSON.stringify(paper.id)}`,
    `source_kind: ${JSON.stringify(source.kind)}`,
    `source_id: ${JSON.stringify(source.id)}`,
    `source_url: ${JSON.stringify(sourceUrl)}`,
    'pdf_url: ""',
    `read_id: ${JSON.stringify(readId)}`,
    'kind: library-read',
    `doc_type: ${JSON.stringify(paper.docType ?? defaultDocTypeForSource(source))}`,
    `tags: ${JSON.stringify(paper.tags)}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
  writeFileSync(absArtifact, artifact);
  lib.upsertRead({
    id: readId,
    paperId,
    status: 'read',
    artifactPath,
    lastError: undefined,
  });
  if (!lib.listLinks(paperId).some((l) => l.surfaceType === 'topic' && l.surfaceId === topicPath)) {
    lib.upsertLink({
      paperId,
      surfaceType: 'topic',
      surfaceId: topicPath,
      rationale: ctx.triageReason ?? 'manual feed via researcher add',
    });
  }
  lib.upsertIntegration({
    paperId,
    topicId: topicPath,
    notePath: ctx.newNoteRelPath,
    zone: ctx.newNoteRelPath.includes('/buffer/')
      ? 'buffer'
      : ctx.newNoteRelPath.includes('/history/')
        ? 'history'
        : 'active',
    summary: ctx.triageReason ?? 'manual feed via researcher add',
    integratedAt: new Date().toISOString(),
  });
}
