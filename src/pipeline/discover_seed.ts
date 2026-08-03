import { writeFileSync } from 'node:fs';
import { loadProjectYaml, type ProjectYaml } from '../config/project-yaml.js';
import type { DiscoverCandidate, DiscoverCandidates } from '../config/discover-candidates.js';
import { isPwcAvailable, pwcSearch, resolvePwcBin, type PwcSearchHit } from '../sources/pwc.js';

export const PLACEHOLDER_QUERY = 'your topic keyword';
export const SEED_QUERY_CAP = 5;
export const SEED_PER_QUERY_LIMIT = 10;
export const SEED_GLOBAL_CAP = 20;

export type DiscoverSeedReport = {
  attempted: boolean;
  available: boolean;
  queries: string[];
  candidateCount: number;
  skippedReason?: string;
  warnings: string[];
};

export async function seedDiscoverCandidates(opts: {
  projectYamlPath: string;
  candidatesPath: string;
  seenIds: ReadonlySet<string> | readonly string[];
  language: string;
  /** inject for tests */
  search?: typeof pwcSearch;
  available?: typeof isPwcAvailable;
  bin?: string;
}): Promise<DiscoverSeedReport> {
  const cfg = loadProjectYaml(opts.projectYamlPath);
  const queries = collectQueries(cfg.sources);
  if (queries.length === 0) {
    return {
      attempted: false,
      available: false,
      queries: [],
      candidateCount: 0,
      skippedReason: 'no_queries',
      warnings: [],
    };
  }

  const bin = opts.bin ?? resolvePwcBin();
  const availableFn = opts.available ?? isPwcAvailable;
  const searchFn = opts.search ?? pwcSearch;
  const warnings: string[] = [];
  const available = await availableFn(bin);
  if (!available) {
    writeHandoff(opts.candidatesPath, [], summaryUnavailable(opts.language));
    return {
      attempted: true,
      available: false,
      queries,
      candidateCount: 0,
      skippedReason: 'pwc_unavailable',
      warnings,
    };
  }

  const seen = toSeenSet(opts.seenIds);
  const byId = new Map<string, DiscoverCandidate>();
  let anySuccess = false;
  for (const q of queries) {
    try {
      const hits = await searchFn(q, { bin, limit: SEED_PER_QUERY_LIMIT, mode: 'hybrid' });
      anySuccess = true;
      for (const hit of hits) {
        const c = hitToCandidate(hit);
        if (seen.has(c.id) || byId.has(c.id)) continue;
        byId.set(c.id, c);
        if (byId.size >= SEED_GLOBAL_CAP) break;
      }
    } catch (error) {
      warnings.push(`pwc search failed for ${JSON.stringify(q)}: ${(error as Error).message}`);
    }
    if (byId.size >= SEED_GLOBAL_CAP) break;
  }

  const candidates = [...byId.values()];
  const summary =
    candidates.length === 0
      ? summaryEmpty(opts.language, queries)
      : summaryHits(opts.language, queries, candidates.length);
  writeHandoff(opts.candidatesPath, candidates, summary);

  return {
    attempted: true,
    available: true,
    queries,
    candidateCount: candidates.length,
    skippedReason: candidates.length === 0 && !anySuccess ? 'all_queries_failed' : undefined,
    warnings,
  };
}

function collectQueries(sources: ProjectYaml['sources']): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (source.kind === 'x-inbox') continue;
    if (!source.queries) continue;
    for (const raw of source.queries) {
      const q = raw.trim();
      if (!q || q === PLACEHOLDER_QUERY) continue;
      if (seen.has(q)) continue;
      seen.add(q);
      out.push(q);
      if (out.length >= SEED_QUERY_CAP) return out;
    }
  }
  return out;
}

function toSeenSet(seenIds: ReadonlySet<string> | readonly string[]): Set<string> {
  return seenIds instanceof Set ? new Set(seenIds) : new Set(seenIds);
}

function hitToCandidate(hit: PwcSearchHit): DiscoverCandidate {
  return {
    id: `arxiv:${hit.arxivId}`,
    title: hit.title,
    url: hit.url,
    abstract: hit.abstract,
    source: 'arxiv',
  };
}

function writeHandoff(path: string, candidates: DiscoverCandidate[], search_summary: string): void {
  const body: DiscoverCandidates = { candidates, search_summary };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

function summaryUnavailable(language: string): string {
  if (language === 'zh') {
    return '主机 pwc 种子已跳过：PATH 上未找到 pwc。Collect agent 应在无主机种子的情况下自行发现。';
  }
  return 'Host pwc seed skipped: pwc not available on PATH. Collect agent should discover without host seed.';
}

function summaryEmpty(language: string, queries: string[]): string {
  const joined = queries.join(' | ');
  if (language === 'zh') {
    return `主机 pwc 种子已运行查询：${joined}。过滤后无新的 arxiv 候选。`;
  }
  return `Host pwc seed ran queries: ${joined}. No new arxiv candidates after filters.`;
}

function summaryHits(language: string, queries: string[], count: number): string {
  const joined = queries.join(' | ');
  if (language === 'zh') {
    return `主机 pwc 种子：从查询 ${joined} 得到 ${count} 篇 arxiv 候选。`;
  }
  return `Host pwc seed: ${count} arxiv candidates from queries: ${joined}.`;
}
