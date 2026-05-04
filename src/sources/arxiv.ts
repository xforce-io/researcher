import { readJsonCache, writeJsonCache } from './cache.js';

const ID_RE = /(\d{4}\.\d{4,5})(?:v\d+)?/;

export function canonicalizeArxivId(input: string): string {
  const m = ID_RE.exec(input);
  if (!m) throw new Error(`not an arxiv id: ${input}`);
  return `arxiv:${m[1]}`;
}

export function arxivAbsUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/abs/${id}`;
}

export function arxivPdfUrl(canonicalId: string): string {
  const id = canonicalId.replace(/^arxiv:/, '');
  return `https://arxiv.org/pdf/${id}`;
}

export interface ArxivMetadata {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  abs_url: string;
  pdf_url: string;
}

export async function fetchArxivMetadata(canonicalId: string): Promise<ArxivMetadata> {
  const bareId = canonicalId.replace(/^arxiv:/, '');
  const cached = readJsonCache<ArxivMetadata>(bareId);
  if (cached) return cached;
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${bareId}`;
  const res = await fetchWithRetry(apiUrl);
  if (!res.ok) throw new Error(`arxiv api ${res.status} for ${bareId}`);
  const xml = await res.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) throw new Error(`no entry for ${bareId} in arxiv api response`);
  const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '');
  const abstract = decodeXml(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? '');
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
    .map((m) => decodeXml(m[1]));
  if (!title) throw new Error(`empty title for ${bareId} in arxiv api response`);
  const meta: ArxivMetadata = {
    id: canonicalId,
    title,
    authors,
    abstract,
    abs_url: arxivAbsUrl(canonicalId),
    pdf_url: arxivPdfUrl(canonicalId),
  };
  writeJsonCache(bareId, meta);
  return meta;
}

async function fetchWithRetry(url: string, attempts = 6): Promise<Response> {
  let last!: Response;
  for (let i = 0; i < attempts; i++) {
    last = await fetch(url);
    if (last.ok) return last;
    // 4xx other than 429 means the id is wrong — no point retrying.
    if (last.status >= 400 && last.status < 500 && last.status !== 429) return last;
    if (i === attempts - 1) break;
    await new Promise((r) => setTimeout(r, retryDelayMs(last, i)));
  }
  return last;
}

function retryDelayMs(res: Response, attempt: number): number {
  const ra = res.headers.get('retry-after');
  if (ra) {
    const sec = Number(ra);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 120_000);
    const dateMs = Date.parse(ra);
    if (!Number.isNaN(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return Math.min(delta, 120_000);
    }
  }
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s (cap), with jitter.
  const base = Math.min(2000 * 2 ** attempt, 60_000);
  return base + Math.floor(Math.random() * 1000);
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
