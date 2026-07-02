import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paper, PaperRead, PaperSurfaceLink, TopicIntegration } from './model.js';

export const WORKSPACE_STATE_DIR = '.researcher-workspace';
export const LIBRARY_DIR = `${WORKSPACE_STATE_DIR}/library`;

interface Clock {
  now: () => string;
}

type PaperInput = Omit<Paper, 'createdAt' | 'updatedAt'> & Partial<Pick<Paper, 'createdAt' | 'updatedAt'>>;
type ReadInput = Omit<PaperRead, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperRead, 'createdAt' | 'updatedAt'>>;
type LinkInput = Omit<PaperSurfaceLink, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperSurfaceLink, 'createdAt' | 'updatedAt'>>;
type IntegrationInput = TopicIntegration;

const systemClock: Clock = { now: () => new Date().toISOString() };

export class PaperLibrary {
  private readonly clock: Clock;

  constructor(readonly workspaceRoot: string, opts: Partial<Clock> = {}) {
    this.clock = { ...systemClock, ...opts };
  }

  get rootDir(): string {
    return join(this.workspaceRoot, LIBRARY_DIR);
  }

  upsertPaper(input: PaperInput): Paper {
    const existing = this.getPaper(input.id);
    const now = this.clock.now();
    const paper: Paper = {
      ...input,
      sources: uniqueSources(input.sources),
      tags: uniqueStrings(input.tags),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('papers.jsonl'), paper, (p) => p.id);
    return paper;
  }

  getPaper(id: string): Paper | undefined {
    return this.listPapers().find((p) => p.id === id);
  }

  listPapers(): Paper[] {
    return readJsonl<Paper>(this.path('papers.jsonl')).sort((a, b) => a.id.localeCompare(b.id));
  }

  upsertRead(input: ReadInput): PaperRead {
    const existing = this.listReads().find((r) => r.id === input.id);
    const now = this.clock.now();
    const read: PaperRead = {
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('reads.jsonl'), read, (r) => r.id);
    return read;
  }

  listReads(paperId?: string): PaperRead[] {
    const reads = readJsonl<PaperRead>(this.path('reads.jsonl'));
    return (paperId ? reads.filter((r) => r.paperId === paperId) : reads)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  upsertLink(input: LinkInput): PaperSurfaceLink {
    const keyOf = (l: PaperSurfaceLink) => `${l.paperId}\t${l.surfaceType}\t${l.surfaceId}`;
    const existing = this.listLinks().find((l) => keyOf(l) === keyOf(input as PaperSurfaceLink));
    const now = this.clock.now();
    const link: PaperSurfaceLink = {
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('links.jsonl'), link, keyOf);
    return link;
  }

  listLinks(paperId?: string): PaperSurfaceLink[] {
    const links = readJsonl<PaperSurfaceLink>(this.path('links.jsonl'));
    return (paperId ? links.filter((l) => l.paperId === paperId) : links)
      .sort((a, b) => `${a.paperId}:${a.surfaceType}:${a.surfaceId}`.localeCompare(`${b.paperId}:${b.surfaceType}:${b.surfaceId}`));
  }

  upsertIntegration(input: IntegrationInput): TopicIntegration {
    const keyOf = (i: TopicIntegration) => `${i.paperId}\t${i.topicId}`;
    writeJsonlUpsert(this.path('integrations.jsonl'), input, keyOf);
    return input;
  }

  listIntegrations(paperId?: string): TopicIntegration[] {
    const integrations = readJsonl<TopicIntegration>(this.path('integrations.jsonl'));
    return paperId ? integrations.filter((i) => i.paperId === paperId) : integrations;
  }

  private path(file: string): string {
    return join(this.rootDir, file);
  }
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
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '');
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function uniqueSources(items: Paper['sources']): Paper['sources'] {
  const byId = new Map(items.map((s) => [s.id, s]));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
