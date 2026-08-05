import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { identifiersForSource, paperIdForSource, sourceRefForId } from '../library/identity.js';
import type { Paper } from '../library/model.js';
import { PaperLibrary } from '../library/store.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { listIntegratedNotes } from '../state/note_index.js';
import { hasWorkspaceManifest, loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../workspace/manifest.js';

export interface MigrateNotesOptions {
  root: string;
}

export interface TopicMigration {
  topicDir: string;
  moved: string[];
}

export interface LibraryBackfillResult {
  workspaceRoot: string;
  importedPapers: number;
  importedReads: number;
  importedLinks: number;
  importedIntegrations: number;
}

const NOTE_RE = /^\d+_.*\.md$/;

export function migrateFlatNotesInTopic(topicDir: string): TopicMigration {
  const notesDir = join(topicDir, 'notes');
  const activeDir = join(notesDir, 'active');
  const moved: string[] = [];
  if (!existsSync(notesDir)) return { topicDir, moved };

  mkdirSync(activeDir, { recursive: true });
  for (const file of readdirSync(notesDir).sort()) {
    if (!NOTE_RE.test(file) || file.startsWith('00_')) continue;
    const from = join(notesDir, file);
    const to = join(activeDir, file);
    if (existsSync(to)) throw new Error(`cannot migrate ${from}: destination exists at ${to}`);

    const before = readFileSync(from, 'utf8');
    renameSync(from, to);
    writeFileSync(to, withActiveFrontmatter(before));
    moved.push(`notes/${file} -> notes/active/${file}`);
  }
  return { topicDir, moved };
}

function withActiveFrontmatter(content: string): string {
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end > 0) {
      const head = content.slice(4, end);
      const body = content.slice(end);
      const cleaned = head
        .split('\n')
        .filter((line) => !/^(zone|pin|score|dwell)\s*:/.test(line))
        .join('\n')
        .replace(/\n*$/, '');
      const injected = [
        'zone: active',
        'pin: false',
        'score: 0',
        'dwell: 0',
        cleaned,
      ].filter(Boolean).join('\n');
      return `---\n${injected}${body}`;
    }
  }
  return `---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---\n${content}`;
}

export async function runMigrateNotes(opts: MigrateNotesOptions): Promise<TopicMigration[]> {
  const root = resolve(opts.root);
  const topics = topicDirs(root);
  const results = topics.map(migrateFlatNotesInTopic);
  for (const r of results) {
    if (r.moved.length === 0) {
      process.stdout.write(`notes migration: ${r.topicDir}: no flat notes\n`);
    } else {
      process.stdout.write(`notes migration: ${r.topicDir}: moved ${r.moved.length} note(s)\n`);
      for (const m of r.moved) process.stdout.write(`  ${m}\n`);
    }
  }
  if (hasWorkspaceManifest(root)) {
    const backfill = backfillLibraryFromTopicNotes(root);
    process.stdout.write(
      `library backfill: ${backfill.importedPapers} paper(s), ` +
      `${backfill.importedReads} legacy read(s), ` +
      `${backfill.importedLinks} link(s), ${backfill.importedIntegrations} integration(s)\n`,
    );
  }
  return results;
}

export function backfillLibraryFromTopicNotes(workspaceRoot: string): LibraryBackfillResult {
  const root = resolve(workspaceRoot);
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  const lib = new PaperLibrary(root);
  let importedPapers = 0;
  let importedReads = 0;
  let importedLinks = 0;
  let importedIntegrations = 0;

  for (const topic of manifest.topics) {
    const topicDir = join(root, topic.path);
    if (!existsSync(resolveProjectResearcherDir(topicDir))) continue;
    for (const note of listIntegratedNotes(topicDir)) {
      if (note.zone === 'pending') continue;
      const content = readFileSync(note.absPath, 'utf8');
      const sources = extractSources(content);
      for (const sourceId of sources) {
        const source = sourceRefForId(sourceId);
        const paperId = paperIdForSource(source);
        const existing = lib.getPaper(paperId);
        const paper = lib.upsertPaper({
          id: paperId,
          canonicalSource: existing?.canonicalSource ?? source,
          sources: [...(existing?.sources ?? []), source],
          identifiers: { ...(existing?.identifiers ?? {}), ...identifiersForSource(source) },
          tags: existing?.tags ?? [],
          title: existing?.title ?? noteTitle(content, note.filename),
          authors: existing?.authors,
          abstract: existing?.abstract,
          createdAt: existing?.createdAt,
        });
        if (!existing) importedPapers++;
        if (!hasCompletedRead(lib, paper.id, root)) {
          const readId = legacyReadId(paper.id, topic.path, note.relPath);
          const artifactPath = `.researcher-workspace/library/papers/${paper.id}/reads/${readId}.md`;
          writeLegacyReadArtifact({
            workspaceRoot: root,
            artifactPath,
            paper,
            topicPath: topic.path,
            notePath: note.relPath,
            noteContent: content,
          });
          const readsBefore = lib.listReads(paper.id).length;
          lib.upsertRead({ id: readId, paperId: paper.id, status: 'read', artifactPath });
          if (lib.listReads(paper.id).length > readsBefore) importedReads++;
        }
        const linksBefore = lib.listLinks(paper.id).length;
        lib.upsertLink({
          paperId: paper.id,
          surfaceType: 'topic',
          surfaceId: topic.path,
          rationale: `legacy note ${note.relPath}`,
        });
        if (lib.listLinks(paper.id).length > linksBefore) importedLinks++;
        const integrationsBefore = lib.listIntegrations(paper.id).length;
        lib.upsertIntegration({
          paperId: paper.id,
          topicId: topic.path,
          notePath: note.relPath,
          zone: note.zone,
          integratedAt: paper.createdAt,
          summary: `legacy note ${note.relPath}`,
        });
        if (lib.listIntegrations(paper.id).length > integrationsBefore) importedIntegrations++;
      }
    }
  }

  return { workspaceRoot: root, importedPapers, importedReads, importedLinks, importedIntegrations };
}

function topicDirs(root: string): string[] {
  if (existsSync(resolveProjectResearcherDir(root))) return [root];
  if (hasWorkspaceManifest(root)) {
    const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
    return manifest.topics
      .map((t) => join(root, t.path))
      .filter((dir) => existsSync(resolveProjectResearcherDir(dir)));
  }
  throw new Error(`${root} is neither a topic repo nor a researcher workspace`);
}

function extractSources(content: string): string[] {
  const out = new Set<string>();
  for (const match of content.matchAll(/(?:^|\n)\s*arxiv\s*:\s*["']?(\d{4}\.\d{4,5})(?:v\d+)?["']?/gi)) {
    out.add(`arxiv:${match[1]}`);
  }
  for (const match of content.matchAll(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})(?:v\d+)?/gi)) {
    out.add(`arxiv:${match[1]}`);
  }
  for (const match of content.matchAll(/(?:^|\n)\s*url\s*:\s*(https?:\/\/[^\s)]+)/gi)) {
    out.add(`url:${match[1].replace(/^["']|["']$/g, '')}`);
  }
  return [...out].sort();
}

function noteTitle(content: string, filename: string): string {
  const fmTitle = /(?:^|\n)\s*(?:title|paper)\s*:\s*["']?(.+?)["']?\s*(?:\n|$)/i.exec(content)?.[1]?.trim();
  if (fmTitle) return fmTitle;
  const h1 = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  if (h1) return h1;
  return filename.replace(/^\d+_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
}

function hasCompletedRead(lib: PaperLibrary, paperId: string, workspaceRoot: string): boolean {
  return lib.listReads(paperId).some((r) => r.status === 'read' && r.artifactPath && existsSync(join(workspaceRoot, r.artifactPath)));
}

function legacyReadId(paperId: string, topicPath: string, notePath: string): string {
  return `legacy_${paperId}_${slugify(topicPath)}_${basename(notePath).replace(/\.md$/, '')}`;
}

function writeLegacyReadArtifact(opts: {
  workspaceRoot: string;
  artifactPath: string;
  paper: Paper;
  topicPath: string;
  notePath: string;
  noteContent: string;
}): void {
  const abs = join(opts.workspaceRoot, opts.artifactPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, [
    '---',
    `title: ${JSON.stringify(opts.paper.title ?? opts.paper.id)}`,
    `paper_id: ${JSON.stringify(opts.paper.id)}`,
    `source_kind: ${JSON.stringify(opts.paper.canonicalSource.kind)}`,
    `source_id: ${JSON.stringify(opts.paper.canonicalSource.id)}`,
    `source_url: ${JSON.stringify(opts.paper.canonicalSource.url ?? '')}`,
    'kind: legacy-topic-read',
    `topic: ${JSON.stringify(opts.topicPath)}`,
    `source_note: ${JSON.stringify(opts.notePath)}`,
    '---',
    '',
    '# Legacy topic read',
    '',
    'This Library read artifact was backfilled from an existing topic note. It preserves historical reading state; it was not produced by the current Library deep-read runner.',
    '',
    '## Source topic note',
    '',
    opts.noteContent.trim(),
    '',
  ].join('\n'));
}

function slugify(seed: string): string {
  return seed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'topic';
}
