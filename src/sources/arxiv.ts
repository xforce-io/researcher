import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { readJsonCache, writeJsonCache } from './cache.js';
import { formatNetworkError } from './url-fetch.js';

const ID_RE = /(\d{4}\.\d{4,5})(?:v\d+)?/;
const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT = 'researcher-library/0.0 (+https://github.com/xforce-io/researcher)';

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
  const { res, attempts, totalWaitMs } = await fetchWithRetry(apiUrl);
  if (!res.ok) {
    throw new Error(
      `arxiv api ${res.status} for ${bareId} ` +
        `(gave up after ${attempts} attempts, waited ${Math.round(totalWaitMs / 1000)}s)`,
    );
  }
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

const DEFAULT_MIN_INTERVAL_MS = 5_000; // arXiv etiquette: space requests apart
const DEFAULT_RETRIES = 8;

function arxivMinIntervalMs(): number {
  const v = Number(process.env.RESEARCHER_ARXIV_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_INTERVAL_MS;
}

function arxivMaxAttempts(): number {
  const v = Number(process.env.RESEARCHER_ARXIV_RETRIES);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_RETRIES;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Timestamp of the last arxiv request. Enforces a *preventive* minimum interval
// between any two arxiv API calls (vs. only backing off after a 429). Because it
// is module-level, it also spaces out requests across serially-run workspace
// topics — the actual root cause of the 429 storm this guards against.
let lastArxivRequestAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const interval = arxivMinIntervalMs();
  if (interval > 0) {
    const wait = lastArxivRequestAt + interval - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastArxivRequestAt = Date.now();
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT },
    });
  } catch (err) {
    try {
      return await curlGetResponse(url);
    } catch {
      throw new Error(`arxiv fetch failed: ${formatNetworkError(err)} for ${url}`);
    }
  }
}

/** Same curl fallback as URL sources: Node fetch to arXiv often ECONNRESET. */
async function curlGetResponse(url: string): Promise<Response> {
  const dir = mkdtempSync(join(tmpdir(), 'researcher-arxiv-get-'));
  const out = join(dir, 'body');
  try {
    const { stdout } = await execa(
      'curl',
      [
        '-sS',
        '-L',
        '-o', out,
        '-w', '%{http_code}\n%{content_type}',
        '--max-time', String(Math.floor(FETCH_TIMEOUT_MS / 1000)),
        '-A', USER_AGENT,
        url,
      ],
      { timeout: FETCH_TIMEOUT_MS + 5_000 },
    );
    const lines = stdout.replace(/\r/g, '').trimEnd().split('\n');
    const contentType = (lines.length >= 2 ? lines.pop() ?? '' : '').toLowerCase();
    const status = Number(lines.pop() || '0');
    if (!Number.isFinite(status) || status <= 0) {
      throw new Error(`curl produced no HTTP status for ${url}`);
    }
    const buf = existsSync(out) ? readFileSync(out) : Buffer.alloc(0);
    return new Response(buf, {
      status,
      headers: contentType ? { 'content-type': contentType } : undefined,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface RetryOutcome {
  res: Response;
  /** How many requests were actually made. */
  attempts: number;
  /** Total time spent in backoff sleeps (excludes preventive throttle waits). */
  totalWaitMs: number;
}

async function fetchWithRetry(url: string): Promise<RetryOutcome> {
  const max = arxivMaxAttempts();
  let last!: Response;
  let totalWaitMs = 0;
  let attempts = 0;
  for (let i = 0; i < max; i++) {
    last = await throttledFetch(url);
    attempts = i + 1;
    if (last.ok) return { res: last, attempts, totalWaitMs };
    // 4xx other than 429 means the id is wrong — no point retrying.
    if (last.status >= 400 && last.status < 500 && last.status !== 429) {
      return { res: last, attempts, totalWaitMs };
    }
    if (i === max - 1) break;
    const delay = retryDelayMs(last, i);
    totalWaitMs += delay;
    await sleep(delay);
  }
  return { res: last, attempts, totalWaitMs };
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
