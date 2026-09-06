import { arxivAbsUrl, arxivPdfUrl, canonicalizeArxivId } from './arxiv.js';
import { calculateHeatIndex, calculateHeatLevel, hasCommunityHeat } from './paper-heat.js';

const HF_DAILY = 'https://huggingface.co/api/daily_papers';
const HF_PAPER = 'https://huggingface.co/api/papers';
const ARXIV_API = 'https://export.arxiv.org/api/query';
const TIMEOUT_MS = 90_000;

export class PapersRadarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PapersRadarError';
  }
}

export type PapersSource = 'huggingface' | 'arxiv' | 'both';

export type PapersItem = {
  id: string;
  paper_id: string;
  title: string;
  authors: string[];
  abstract: string;
  arxiv_url: string;
  pdf_url: string;
  source: 'huggingface' | 'arxiv';
  published_date: string;
  heat_index: number;
  heat_level: number;
  upvotes?: number;
  hf_url?: string;
  github_repo?: string;
  github_stars?: number;
  ai_summary?: string;
  ai_keywords?: string[];
};

type FetchFn = typeof fetch;

export async function fetchTrendingPapers(opts: {
  limit?: number;
  source?: PapersSource;
  category?: string;
  fetch?: FetchFn;
} = {}): Promise<PapersItem[]> {
  const limit = opts.limit ?? 10;
  const source = opts.source ?? 'huggingface';
  const category = opts.category ?? 'cs.AI';
  const fetchFn = opts.fetch ?? fetch;
  const byId = new Map<string, PapersItem>();

  if (source === 'huggingface' || source === 'both') {
    try {
      const hf = await fetchHuggingFaceDaily(limit, fetchFn);
      for (const p of hf) byId.set(p.paper_id, p);
    } catch (err) {
      if (source === 'huggingface') {
        try {
          for (const p of await fetchArxivCategory(category, limit, fetchFn)) {
            byId.set(p.paper_id, p);
          }
        } catch (fallbackErr) {
          throw new PapersRadarError(
            `huggingface daily papers failed and arXiv fallback failed: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            } (hf: ${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }
  }

  if (source === 'arxiv' || source === 'both') {
    try {
      for (const p of await fetchArxivCategory(category, limit, fetchFn)) {
        if (!byId.has(p.paper_id)) byId.set(p.paper_id, p);
      }
    } catch (err) {
      if (source === 'arxiv' && byId.size === 0) throw toRadarError(err, 'arXiv category fetch failed');
    }
  }

  const enriched = await enrichCommunitySignals([...byId.values()], fetchFn);
  const gated = enriched.filter(hasCommunityHeat);
  const ranked = gated.sort((a, b) => b.heat_index - a.heat_index || a.paper_id.localeCompare(b.paper_id));
  const sliced = ranked.slice(0, limit);
  if (sliced.length === 0) {
    throw new PapersRadarError('no papers with community heat (upvotes or GitHub stars)');
  }
  return sliced;
}

export async function searchPapers(opts: {
  query: string;
  limit?: number;
  fetch?: FetchFn;
}): Promise<PapersItem[]> {
  const q = opts.query.trim();
  if (!q) throw new PapersRadarError('search query is empty');
  const limit = opts.limit ?? 5;
  const fetchFn = opts.fetch ?? fetch;
  const searchQuery = `ti:"${q}"`;
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(searchQuery)}` +
    `&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(url, fetchFn, 'arXiv search');
  const papers = parseAtomPapers(xml, 'arxiv').slice(0, limit);
  if (papers.length === 0) throw new PapersRadarError(`no papers found for: ${q}`);
  return papers;
}

export async function showPaper(opts: {
  arxivId: string;
  fetch?: FetchFn;
}): Promise<PapersItem[]> {
  const canonical = canonicalizeArxivId(opts.arxivId);
  const bare = canonical.replace(/^arxiv:/, '');
  const fetchFn = opts.fetch ?? fetch;
  try {
    const paper = await fetchHuggingFacePaper(bare, fetchFn);
    if (paper) return [withHeat(paper)];
  } catch {
    /* fall through */
  }
  try {
    const xml = await fetchText(
      `${ARXIV_API}?id_list=${encodeURIComponent(bare)}`,
      fetchFn,
      `arXiv id ${bare}`,
    );
    const papers = parseAtomPapers(xml, 'arxiv');
    if (papers.length === 0) throw new PapersRadarError(`paper not found: ${bare}`);
    return papers.slice(0, 1);
  } catch (err) {
    if (err instanceof PapersRadarError && /not found/.test(err.message)) throw err;
    throw new PapersRadarError(`paper not found: ${bare}`);
  }
}

async function fetchHuggingFaceDaily(limit: number, fetchFn: FetchFn): Promise<PapersItem[]> {
  const data = await fetchJson(`${HF_DAILY}?limit=${limit}`, fetchFn, 'HuggingFace daily papers');
  if (!Array.isArray(data)) throw new PapersRadarError('HuggingFace daily papers: expected array');
  const papers: PapersItem[] = [];
  for (const item of data) {
    const mapped = mapHfDailyItem(item);
    if (mapped) papers.push(withHeat(mapped));
  }
  if (papers.length === 0) throw new PapersRadarError('HuggingFace daily papers returned no papers');
  return papers;
}

async function fetchHuggingFacePaper(paperId: string, fetchFn: FetchFn): Promise<Omit<PapersItem, 'heat_index' | 'heat_level'> | undefined> {
  const data = await fetchJson(`${HF_PAPER}/${paperId}`, fetchFn, `HuggingFace paper ${paperId}`);
  if (!data || typeof data !== 'object') return undefined;
  const rec = data as Record<string, unknown>;
  return mapHfPaper(rec, rec);
}

async function fetchArxivCategory(category: string, limit: number, fetchFn: FetchFn): Promise<PapersItem[]> {
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(`cat:${category}`)}` +
    `&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(url, fetchFn, 'arXiv category');
  return parseAtomPapers(xml, 'arxiv');
}

function mapHfDailyItem(item: unknown): Omit<PapersItem, 'heat_index' | 'heat_level'> | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  const paper = rec.paper;
  if (!paper || typeof paper !== 'object') return undefined;
  const mapped = mapHfPaper(paper as Record<string, unknown>, rec);
  if (!mapped) return undefined;
  applyGithubFields(mapped, paper as Record<string, unknown>, rec);
  return mapped;
}

function mapHfPaper(
  paper: Record<string, unknown>,
  extra: Record<string, unknown>,
): Omit<PapersItem, 'heat_index' | 'heat_level'> | undefined {
  const rawId = String(paper.id ?? extra.id ?? '');
  let paper_id: string;
  try {
    paper_id = canonicalizeArxivId(rawId).replace(/^arxiv:/, '');
  } catch {
    return undefined;
  }
  const title = String(paper.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return undefined;
  const authors = Array.isArray(paper.authors)
    ? paper.authors
        .map((a) => (a && typeof a === 'object' ? String((a as { name?: unknown }).name ?? '').trim() : ''))
        .filter(Boolean)
    : [];
  const abstract = String(paper.summary ?? '').trim();
  const publishedAt = String(paper.publishedAt ?? '');
  const item: Omit<PapersItem, 'heat_index' | 'heat_level'> = {
    id: `arxiv:${paper_id}`,
    paper_id,
    title,
    authors,
    abstract,
    arxiv_url: arxivAbsUrl(`arxiv:${paper_id}`),
    pdf_url: arxivPdfUrl(`arxiv:${paper_id}`),
    source: 'huggingface',
    published_date: publishedAt.slice(0, 10),
    hf_url: `https://huggingface.co/papers/${paper_id}`,
  };
  if (typeof paper.upvotes === 'number') item.upvotes = paper.upvotes;
  if (typeof paper.ai_summary === 'string' && paper.ai_summary) item.ai_summary = paper.ai_summary;
  if (Array.isArray(paper.ai_keywords)) {
    item.ai_keywords = paper.ai_keywords.map((k) => String(k)).filter(Boolean);
  }
  applyGithubFields(item, paper, extra);
  return item;
}

/** Live HF API: `paper.githubRepo` is a URL string and `githubStars` a number.
 * Older/nested payloads used `item.githubRepo: { url, stars }`. Accept both. */
function applyGithubFields(
  item: Omit<PapersItem, 'heat_index' | 'heat_level'>,
  ...records: Record<string, unknown>[]
): void {
  for (const rec of records) {
    const repo = rec.githubRepo;
    if (typeof repo === 'string' && repo && !item.github_repo) item.github_repo = repo;
    if (repo && typeof repo === 'object') {
      const r = repo as Record<string, unknown>;
      if (typeof r.url === 'string' && r.url && !item.github_repo) item.github_repo = r.url;
      if (typeof r.stars === 'number' && item.github_stars === undefined) item.github_stars = r.stars;
    }
    const stars = rec.githubStars ?? rec.github_stars;
    if (typeof stars === 'number' && item.github_stars === undefined) item.github_stars = stars;
  }
}

function parseAtomPapers(xml: string, source: 'arxiv'): PapersItem[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const papers: PapersItem[] = [];
  for (const entry of entries) {
    const idMatch = /<id>\s*([^<]*\/abs\/[^<]+)\s*<\/id>/.exec(entry) ?? /<id>\s*([^<]+)\s*<\/id>/.exec(entry);
    if (!idMatch) continue;
    let paper_id: string;
    try {
      paper_id = canonicalizeArxivId(idMatch[1]).replace(/^arxiv:/, '');
    } catch {
      continue;
    }
    const title = decodeXml((/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '')).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const abstract = decodeXml(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? '');
    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => decodeXml(m[1])).filter(Boolean);
    const published = /<published>([\s\S]*?)<\/published>/.exec(entry)?.[1] ?? '';
    papers.push(
      withHeat({
        id: `arxiv:${paper_id}`,
        paper_id,
        title,
        authors,
        abstract,
        arxiv_url: arxivAbsUrl(`arxiv:${paper_id}`),
        pdf_url: arxivPdfUrl(`arxiv:${paper_id}`),
        source,
        published_date: published.slice(0, 10),
      }),
    );
  }
  return papers;
}

function needsCommunityEnrichment(paper: PapersItem): boolean {
  if (hasCommunityHeat(paper)) return false;
  return paper.upvotes === undefined && paper.github_stars === undefined;
}

async function enrichCommunitySignals(papers: PapersItem[], fetchFn: FetchFn): Promise<PapersItem[]> {
  return Promise.all(
    papers.map(async (paper) => {
      if (!needsCommunityEnrichment(paper)) return paper;
      try {
        const hf = await fetchHuggingFacePaper(paper.paper_id, fetchFn);
        if (!hf) return paper;
        return withHeat({
          ...paper,
          upvotes: hf.upvotes ?? paper.upvotes,
          github_stars: hf.github_stars ?? paper.github_stars,
          github_repo: hf.github_repo ?? paper.github_repo,
          hf_url: hf.hf_url ?? paper.hf_url,
          ai_summary: hf.ai_summary ?? paper.ai_summary,
          ai_keywords: hf.ai_keywords ?? paper.ai_keywords,
        });
      } catch {
        return paper;
      }
    }),
  );
}

function withHeat(item: Omit<PapersItem, 'heat_index' | 'heat_level'>): PapersItem {
  const heat_index = calculateHeatIndex(item);
  return { ...item, heat_index, heat_level: calculateHeatLevel(heat_index) };
}

async function fetchJson(url: string, fetchFn: FetchFn, label: string): Promise<unknown> {
  const res = await fetchWithTimeout(url, fetchFn, label);
  if (!res.ok) throw new PapersRadarError(`${label}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new PapersRadarError(`${label}: invalid JSON`);
  }
}

async function fetchText(url: string, fetchFn: FetchFn, label: string): Promise<string> {
  const res = await fetchWithTimeout(url, fetchFn, label);
  if (!res.ok) throw new PapersRadarError(`${label}: HTTP ${res.status}`);
  return res.text();
}

async function fetchWithTimeout(url: string, fetchFn: FetchFn, label: string): Promise<Response> {
  try {
    return await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw toRadarError(err, `${label} request failed`);
  }
}

function toRadarError(err: unknown, fallback: string): PapersRadarError {
  if (err instanceof PapersRadarError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new PapersRadarError(`${fallback}: ${msg}`);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
