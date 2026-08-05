import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paper, PaperNote, PaperRead, PaperSurfaceLink, TopicIntegration } from './model.js';

export const WORKSPACE_STATE_DIR = '.researcher-workspace';
export const LIBRARY_DIR = `${WORKSPACE_STATE_DIR}/library`;

interface Clock {
  now: () => string;
}

type PaperInput = Omit<Paper, 'createdAt' | 'updatedAt'> & Partial<Pick<Paper, 'createdAt' | 'updatedAt'>>;
type ReadInput = Omit<PaperRead, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperRead, 'createdAt' | 'updatedAt'>>;
type NoteInput = Omit<PaperNote, 'createdAt' | 'updatedAt'> & Partial<Pick<PaperNote, 'createdAt' | 'updatedAt'>>;
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
    // Newest activity first — Library inbox should surface recent upserts/reads above stale ids.
    return readJsonl<Paper>(this.path('papers.jsonl')).sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
    });
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

  upsertNote(input: NoteInput): PaperNote {
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
    writeJsonlUpsert(this.path('notes.jsonl'), note, (n) => n.id);
    return note;
  }

  listNotes(paperId?: string): PaperNote[] {
    const notes = readJsonl<PaperNote>(this.path('notes.jsonl'));
    const filtered = paperId ? notes.filter((n) => n.paperId === paperId) : notes;
    // Pinned first, then newest activity.
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
    const existing = this.getNote(id);
    if (!existing) throw new Error(`unknown note id: ${id}`);
    writeJsonlFilter(this.path('notes.jsonl'), (n: PaperNote) => n.id !== id);
    return { deleted: true, noteId: id };
  }

  upsertLink(input: LinkInput): PaperSurfaceLink {
    const keyOf = (l: PaperSurfaceLink) => `${l.paperId}\t${l.surfaceType}\t${l.surfaceId}`;
    const existing = this.listLinks().find((l) => keyOf(l) === keyOf(input as PaperSurfaceLink));
    const now = this.clock.now();
    const link: PaperSurfaceLink = {
      paperId: input.paperId,
      surfaceType: input.surfaceType,
      surfaceId: input.surfaceId,
      rationale: input.rationale,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    writeJsonlUpsert(this.path('links.jsonl'), link, keyOf);
    return link;
  }

  listLinks(paperId?: string): PaperSurfaceLink[] {
    // Older workspaces stored workflow decisions in links. Rejected and archived
    // entries were never active links; hide them while retaining the ledger on disk.
    // All other legacy links normalize to the new relation-free shape on their next upsert.
    const links = readJsonl<PaperSurfaceLink & { relation?: string }>(this.path('links.jsonl'))
      .filter((link) => link.relation !== 'rejected' && link.relation !== 'archived')
      .map(({ relation: _relation, ...link }) => link);
    return (paperId ? links.filter((l) => l.paperId === paperId) : links)
      .sort((a, b) => `${a.paperId}:${a.surfaceType}:${a.surfaceId}`.localeCompare(`${b.paperId}:${b.surfaceType}:${b.surfaceId}`));
  }

  unlink(paperId: string, surfaceType: PaperSurfaceLink['surfaceType'], surfaceId: string): { unlinked: true } {
    const found = this.listLinks(paperId).some(
      (link) => link.surfaceType === surfaceType && link.surfaceId === surfaceId,
    );
    if (!found) throw new Error(`no link for ${paperId} on ${surfaceType}:${surfaceId}`);
    writeJsonlFilter(
      this.path('links.jsonl'),
      (link: PaperSurfaceLink) => !(link.paperId === paperId && link.surfaceType === surfaceType && link.surfaceId === surfaceId),
    );
    return { unlinked: true };
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

  /**
   * Mark every in-flight `reading` record as `failed`. Used on serve startup: TaskRegistry
   * is in-memory only, so a previous process death leaves orphan `reading` rows with no live task.
   */
  reclaimOrphanReads(reason = 'serve restarted while reading — previous task did not record a final state'): PaperRead[] {
    const reclaimed: PaperRead[] = [];
    for (const read of this.listReads()) {
      if (read.status !== 'reading') continue;
      reclaimed.push(this.upsertRead({
        ...read,
        status: 'failed',
        lastError: reason,
        // keep artifactPath if any partial file was written; usually absent for orphans
      }));
    }
    return reclaimed;
  }

  /**
   * Delete a Library paper that is not linked/integrated into any topic surface.
   * Removes paper + reads ledger rows and the on-disk artifact directory under library/papers/<id>/.
   */
  deletePaper(id: string): { deleted: true; paperId: string; removedReads: number } {
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
    // Any non-topic surface link also blocks delete — keep library relations intact.
    const otherLinks = this.listLinks(id);
    if (otherLinks.length > 0) {
      throw new Error(`cannot delete ${id}: still linked to ${otherLinks.length} surface(s).`);
    }

    const reads = this.listReads(id);
    writeJsonlFilter(this.path('papers.jsonl'), (p: Paper) => p.id !== id);
    writeJsonlFilter(this.path('reads.jsonl'), (r: PaperRead) => r.paperId !== id);
    writeJsonlFilter(this.path('notes.jsonl'), (n: PaperNote) => n.paperId !== id);
    // links/integrations already empty for this paper; rewrite keeps other rows intact
    writeJsonlFilter(this.path('links.jsonl'), (l: PaperSurfaceLink) => l.paperId !== id);
    writeJsonlFilter(this.path('integrations.jsonl'), (i: TopicIntegration) => i.paperId !== id);

    const artifactDir = join(this.rootDir, 'papers', id);
    if (existsSync(artifactDir)) rmSync(artifactDir, { recursive: true, force: true });

    return { deleted: true, paperId: id, removedReads: reads.length };
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

function writeJsonlFilter<T>(path: string, keep: (item: T) => boolean): void {
  const kept = readJsonl<T>(path).filter(keep);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, kept.length ? `${kept.map((x) => JSON.stringify(x)).join('\n')}\n` : '');
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function uniqueSources(items: Paper['sources']): Paper['sources'] {
  const byId = new Map(items.map((s) => [s.id, s]));
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
