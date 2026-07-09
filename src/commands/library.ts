import { identifiersForSource, normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { defaultDocTypeForSource, type DocType } from '../library/doc-type.js';
import { PaperLibrary } from '../library/store.js';
import type { PaperRelation, TopicIntegration } from '../library/model.js';

export interface LibraryAddOptions {
  cwd: string;
  input: string;
  tags?: string[];
  docType?: DocType;
  write?: (s: string) => void;
}

export interface LibraryListOptions {
  cwd: string;
  write?: (s: string) => void;
}

export interface LibraryLinkOptions {
  cwd: string;
  paperId: string;
  topic: string;
  relation?: PaperRelation;
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

const defaultWrite = (s: string) => process.stdout.write(s);
const RELATIONS: PaperRelation[] = ['candidate', 'relevant', 'integrated', 'rejected', 'archived'];

export function runLibraryAdd(opts: LibraryAddOptions): void {
  const write = opts.write ?? defaultWrite;
  const source = normalizePaperInput(opts.input);
  const id = paperIdForSource(source);
  const lib = new PaperLibrary(opts.cwd);
  const existing = lib.getPaper(id);
  const tags = opts.tags ?? existing?.tags ?? [];
  const docType = opts.docType ?? existing?.docType ?? defaultDocTypeForSource(source);
  const paper = lib.upsertPaper({
    id,
    canonicalSource: existing?.canonicalSource ?? source,
    sources: [...(existing?.sources ?? []), source],
    identifiers: { ...(existing?.identifiers ?? {}), ...identifiersForSource(source) },
    tags,
    docType,
  });
  write(`${paper.id}\t${paper.canonicalSource.id}\t${paper.docType ?? 'paper'}\n`);
}

export function runLibraryList(opts: LibraryListOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  const papers = lib.listPapers();
  if (papers.length === 0) {
    write('(no papers)\n');
    return;
  }
  for (const p of papers) {
    const tags = p.tags.length ? `\t${p.tags.join(',')}` : '';
    write(`${p.id}\t${p.canonicalSource.id}${tags}\n`);
  }
}

export function runLibraryLink(opts: LibraryLinkOptions): void {
  const write = opts.write ?? defaultWrite;
  const lib = new PaperLibrary(opts.cwd);
  const paper = lib.getPaper(opts.paperId);
  if (!paper) throw new Error(`unknown paper id: ${opts.paperId}`);
  const relation = opts.relation ?? 'candidate';
  const link = lib.upsertLink({
    paperId: opts.paperId,
    surfaceType: 'topic',
    surfaceId: opts.topic,
    relation,
    rationale: opts.rationale,
  });
  write(`${link.paperId}\t${link.surfaceType}:${link.surfaceId}\t${link.relation}\n`);
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
    relation: 'integrated',
    rationale: opts.summary,
  });
  write(`${integration.paperId}\ttopic:${integration.topicId}\tintegrated\n`);
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean).sort();
}

export function parseRelation(raw: string): PaperRelation {
  if ((RELATIONS as string[]).includes(raw)) return raw as PaperRelation;
  throw new Error(`invalid relation: ${raw}. expected one of ${RELATIONS.join(', ')}`);
}
