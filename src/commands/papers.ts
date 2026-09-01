import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDefaultWorkspace } from '../config/default-workspace.js';
import { identifiersForSource, normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import {
  fetchTrendingPapers,
  searchPapers,
  showPaper,
  type PapersItem,
  type PapersSource,
} from '../sources/papers-radar.js';
import { defaultLibraryReadRunner, type LibraryReadRunner } from '../web/library-read.js';

const defaultWrite = (s: string) => process.stdout.write(s);
const defaultWriteErr = (s: string) => process.stderr.write(s);

export async function runPapersTrending(opts: {
  limit?: number;
  format?: 'json' | 'report';
  source?: PapersSource;
  category?: string;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
  fetch?: typeof fetch;
}): Promise<void> {
  const papers = await fetchTrendingPapers({
    limit: opts.limit,
    source: opts.source,
    category: opts.category,
    fetch: opts.fetch,
  });
  emitPapers(papers, opts.format ?? 'json', opts.write ?? defaultWrite);
}

export async function runPapersSearch(opts: {
  query: string;
  limit?: number;
  format?: 'json' | 'report';
  write?: (s: string) => void;
  fetch?: typeof fetch;
}): Promise<void> {
  const papers = await searchPapers({ query: opts.query, limit: opts.limit, fetch: opts.fetch });
  emitPapers(papers, opts.format ?? 'json', opts.write ?? defaultWrite);
}

export async function runPapersShow(opts: {
  arxivId: string;
  format?: 'json' | 'report';
  write?: (s: string) => void;
  fetch?: typeof fetch;
}): Promise<void> {
  const papers = await showPaper({ arxivId: opts.arxivId, fetch: opts.fetch });
  emitPapers(papers, opts.format ?? 'json', opts.write ?? defaultWrite);
}

export async function runPapersRead(opts: {
  input: string;
  workspace?: string;
  env?: NodeJS.Dict<string>;
  home?: string;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
  runner?: LibraryReadRunner;
}): Promise<void> {
  const write = opts.write ?? defaultWrite;
  const writeErr = opts.writeErr ?? defaultWriteErr;
  const workspaceRoot = resolveDefaultWorkspace({
    flag: opts.workspace,
    env: opts.env,
    home: opts.home,
  });
  const source = normalizePaperInput(opts.input);
  if (source.kind !== 'arxiv') {
    throw new Error('papers read accepts an arXiv id only');
  }
  const lib = new PaperLibrary(workspaceRoot);
  const paperId = paperIdForSource(source);
  const existingPaper = lib.getPaper(paperId);
  const paper = lib.upsertPaper({
    id: paperId,
    canonicalSource: existingPaper?.canonicalSource ?? source,
    sources: [...(existingPaper?.sources ?? []), source],
    identifiers: { ...(existingPaper?.identifiers ?? {}), ...identifiersForSource(source) },
    tags: existingPaper?.tags ?? [],
    title: existingPaper?.title,
    authors: existingPaper?.authors,
    abstract: existingPaper?.abstract,
    docType: existingPaper?.docType ?? 'paper',
  });

  const completed = lib.listReads(paper.id).find(
    (r) => r.status === 'read' && r.artifactPath && existsSync(join(workspaceRoot, r.artifactPath)),
  );
  if (completed?.artifactPath) {
    writeErr(`library-read: ${completed.artifactPath} (reuse)\n`);
    write(readFileSync(join(workspaceRoot, completed.artifactPath), 'utf8'));
    return;
  }

  const inFlight = lib.listReads(paper.id).find((r) => r.status === 'reading');
  if (inFlight) {
    throw new Error(`papers read: ${paper.id} is already reading (${inFlight.id})`);
  }

  const readId = `read_${paper.id}`;
  lib.upsertRead({ id: readId, paperId: paper.id, status: 'reading', lastError: undefined });
  const runner = opts.runner ?? defaultLibraryReadRunner;
  try {
    const result = await runner({
      workspaceRoot,
      paper,
      readId,
      onLine: (line) => writeErr(`${line}\n`),
    });
    if (result.title && !paper.title) {
      lib.upsertPaper({ ...paper, title: result.title });
    }
    lib.upsertRead({
      id: readId,
      paperId: paper.id,
      status: 'read',
      artifactPath: result.artifactPath,
      lastError: undefined,
    });
    writeErr(`library-read: ${result.artifactPath}\n`);
    write(readFileSync(join(workspaceRoot, result.artifactPath), 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lib.upsertRead({ id: readId, paperId: paper.id, status: 'failed', lastError: message });
    throw err;
  }
}

function emitPapers(papers: PapersItem[], format: 'json' | 'report', write: (s: string) => void): void {
  if (format === 'report') {
    write(formatReport(papers));
    return;
  }
  write(`${JSON.stringify(papers, null, 2)}\n`);
}

export function formatReport(papers: PapersItem[]): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const lines = [`📚 今日 AI 论文热榜 (${y}-${m}-${d})`, ''];
  papers.forEach((paper, i) => {
    const heat = '🔥'.repeat(paper.heat_level);
    lines.push(`${i + 1}. ${heat} ${paper.title}`);
    const stats: string[] = [];
    if ((paper.upvotes ?? 0) > 0) stats.push(`👍 ${paper.upvotes} upvotes`);
    if ((paper.github_stars ?? 0) > 0) {
      const stars = paper.github_stars!;
      stats.push(`⭐ ${stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars} GitHub stars`);
    }
    if (stats.length) lines.push(`   ${stats.join(' | ')}`);
    if (paper.ai_summary) lines.push(`   🤖 ${truncate(paper.ai_summary, 200)}`);
    else if (paper.abstract) lines.push(`   📝 ${truncate(paper.abstract, 150)}`);
    if (paper.ai_keywords?.length) lines.push(`   🏷️ Keywords: ${paper.ai_keywords.slice(0, 5).join(', ')}`);
    const links = [`arXiv: ${paper.arxiv_url}`, `PDF: ${paper.pdf_url}`];
    if (paper.hf_url) links.push(`HF: ${paper.hf_url}`);
    if (paper.github_repo) links.push(`GitHub: ${paper.github_repo}`);
    lines.push(`   🔗 ${links.join(' | ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
