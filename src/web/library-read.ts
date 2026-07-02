import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runRead } from '../commands/read.js';
import type { Paper } from '../library/model.js';

export interface LibraryReadRunnerOptions {
  topicDir: string;
  topicPath: string;
  paper: Paper;
  onLine?: (line: string) => void;
}

export interface LibraryReadResult {
  artifactPath?: string;
}

export type LibraryReadRunner = (opts: LibraryReadRunnerOptions) => Promise<LibraryReadResult>;

export async function defaultLibraryReadRunner(opts: LibraryReadRunnerOptions): Promise<LibraryReadResult> {
  const before = new Set(listPendingNotes(opts.topicDir));
  const input = paperInput(opts.paper);
  opts.onLine?.(`deep-read ${opts.paper.id} in ${opts.topicPath}`);
  await runRead({ cwd: opts.topicDir, input });
  const artifact = newestNewPendingNote(opts.topicDir, before);
  return { artifactPath: artifact ? `${opts.topicPath}/${artifact}` : undefined };
}

function paperInput(paper: Paper): string {
  if (paper.canonicalSource.kind === 'arxiv') {
    return paper.identifiers.arxiv ?? paper.canonicalSource.id.replace(/^arxiv:/, '');
  }
  return paper.identifiers.url ?? paper.canonicalSource.url ?? paper.canonicalSource.id.replace(/^url:/, '');
}

function listPendingNotes(topicDir: string): string[] {
  const dir = join(topicDir, 'notes/pending');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => `notes/pending/${f}`);
}

function newestNewPendingNote(topicDir: string, before: Set<string>): string | undefined {
  const notes = listPendingNotes(topicDir).filter((rel) => !before.has(rel));
  if (notes.length === 0) return undefined;
  return notes.sort((a, b) =>
    statSync(join(topicDir, b)).mtimeMs - statSync(join(topicDir, a)).mtimeMs
  )[0];
}
