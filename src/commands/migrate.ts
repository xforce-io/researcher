import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveProjectResearcherDir } from '../paths.js';
import { hasWorkspaceManifest, loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../workspace/manifest.js';

export interface MigrateNotesOptions {
  root: string;
}

export interface TopicMigration {
  topicDir: string;
  moved: string[];
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
  return results;
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
