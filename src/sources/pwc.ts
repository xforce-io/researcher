import { execa } from 'execa';
import { arxivAbsUrl, canonicalizeArxivId } from './arxiv.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_TIMEOUT_MS = 45_000;

export type PwcSearchHit = {
  arxivId: string;
  title: string;
  abstract: string;
  url: string;
};

export class PwcError extends Error {
  constructor(
    message: string,
    public readonly code: 'PWC_NOT_FOUND' | 'PWC_EXIT' | 'PWC_TIMEOUT' | 'PWC_BAD_JSON',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PwcError';
  }
}

export function resolvePwcBin(): string {
  const fromEnv = process.env.RESEARCHER_PWC_BIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'pwc';
}

export async function isPwcAvailable(bin = resolvePwcBin()): Promise<boolean> {
  try {
    const result = await execa(bin, ['version'], { timeout: 10_000, reject: false });
    if ('code' in result && result.code === 'ENOENT') return false;
    return result.exitCode === 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') return false;
    return false;
  }
}

export async function pwcSearch(
  query: string,
  opts: {
    bin?: string;
    limit?: number;
    mode?: 'hybrid' | 'keyword' | 'semantic';
    timeoutMs?: number;
  } = {},
): Promise<PwcSearchHit[]> {
  const bin = opts.bin ?? resolvePwcBin();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const mode = opts.mode ?? 'hybrid';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const q = query.trim();
  if (!q) return [];

  let result: Awaited<ReturnType<typeof execa>>;
  try {
    result = await execa(bin, ['search', q, '--limit', String(limit), '--mode', mode, '--json'], {
      timeout: timeoutMs,
      reject: false,
    });
  } catch (error) {
    throw mapSpawnError(error);
  }

  if ('code' in result && result.code === 'ENOENT') {
    throw new PwcError(`pwc executable not found: ${bin}`, 'PWC_NOT_FOUND');
  }
  if (result.timedOut) {
    throw new PwcError(`pwc search timed out for query: ${q}`, 'PWC_TIMEOUT');
  }
  if (result.exitCode !== 0) {
    throw new PwcError(
      `pwc search exited ${result.exitCode ?? 1}: ${(result.stderr || result.stdout || '').slice(0, 200)}`,
      'PWC_EXIT',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''));
  } catch (error) {
    throw new PwcError('pwc search returned non-JSON stdout', 'PWC_BAD_JSON', error);
  }

  const rows = extractRows(parsed);
  const hits: PwcSearchHit[] = [];
  for (const row of rows) {
    const hit = mapRow(row);
    if (hit) hits.push(hit);
  }
  return hits;
}

function extractRows(parsed: unknown): Record<string, unknown>[] {
  // Prefer { schema_version, data } wrapper; also accept bare data shapes.
  let data: unknown = parsed;
  if (parsed && typeof parsed === 'object' && 'data' in parsed) {
    data = (parsed as { data: unknown }).data;
  }
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const list = obj.results ?? obj.items;
    if (Array.isArray(list)) {
      return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    }
  }
  throw new PwcError('pwc search JSON missing result list', 'PWC_BAD_JSON');
}

function mapRow(row: Record<string, unknown>): PwcSearchHit | null {
  const title = String(row.title ?? '').trim();
  const abstract = String(row.abstract ?? '').trim();
  if (!title || !abstract) return null;

  const arxivRaw = row.arxiv_id ?? row.arxivId;
  let canonical: string;
  try {
    canonical = canonicalizeArxivId(String(arxivRaw ?? row.id ?? ''));
  } catch {
    return null;
  }
  const bare = canonical.replace(/^arxiv:/, '');
  const urlRaw = String(row.url_abs ?? row.source_url ?? row.url ?? '').trim();
  const url = urlRaw || arxivAbsUrl(canonical);
  try {
    // Validate URL shape early; discover-candidates zod requires url().
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return null;
  }
  return { arxivId: bare, title, abstract, url };
}

function mapSpawnError(error: unknown): PwcError {
  const processError = error as { code?: unknown; timedOut?: unknown };
  if (processError.code === 'ENOENT') {
    return new PwcError('pwc executable not found', 'PWC_NOT_FOUND', error);
  }
  if (processError.timedOut === true) {
    return new PwcError('pwc search timed out', 'PWC_TIMEOUT', error);
  }
  return new PwcError('pwc search failed to start', 'PWC_EXIT', error);
}
