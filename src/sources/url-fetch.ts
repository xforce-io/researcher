import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveResearcherHome } from '../paths.js';
import { defaultDocTypeForSource, type DocType } from '../library/doc-type.js';
import type { SourceRef } from '../library/model.js';
import { fetchXStatusMaterial, parseXStatusUrl } from './x-status.js';

const FETCH_TIMEOUT_MS = 60_000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'researcher-library/0.0 (+https://github.com/xforce-io/researcher)';
const GH_REPO_ROOT = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)\/?$/i;
const GH_RESERVED_OWNERS = new Set([
  'topics', 'orgs', 'users', 'settings', 'marketplace', 'explore', 'login', 'features', 'pricing', 'about',
]);

export interface UrlMaterial {
  title: string;
  text: string;
  contentType: string;
  docType: DocType;
  url: string;
}

/** Include Node fetch `.cause` (e.g. UND_ERR_CONNECT_TIMEOUT) in a single string. */
export function formatNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const bits = [err.message];
  const cause = err.cause;
  if (cause && typeof cause === 'object') {
    const code = 'code' in cause && cause.code != null ? String(cause.code) : '';
    const msg = cause instanceof Error ? cause.message : '';
    if (code && !bits.includes(code)) bits.push(code);
    if (msg && !bits.includes(msg)) bits.push(msg);
  }
  return bits.join(': ');
}

/** Raw artifact URLs to try for a GitHub repo homepage (`owner/repo`). */
export function githubRepoRawCandidates(url: string): string[] | undefined {
  const m = GH_REPO_ROOT.exec(url);
  if (!m) return undefined;
  const owner = m[1];
  let repo = m[2];
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  if (!owner || !repo) return undefined;
  if (GH_RESERVED_OWNERS.has(owner.toLowerCase())) return undefined;
  const files = ['paper.pdf', 'README.md', 'readme.md'];
  const branches = ['main', 'master'];
  const out: string[] = [];
  for (const branch of branches) {
    for (const file of files) {
      out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`);
    }
  }
  return out;
}

export async function fetchUrlMaterial(canonicalId: string, opts?: { docType?: DocType }): Promise<UrlMaterial> {
  if (!canonicalId.startsWith('url:')) {
    throw new Error(`fetchUrlMaterial: expected url:-prefixed id, got ${canonicalId}`);
  }
  const url = canonicalId.slice('url:'.length);
  const source: SourceRef = { kind: 'url', id: canonicalId, url };
  const docType = opts?.docType ?? defaultDocTypeForSource(source);

  const cached = readUrlCache(canonicalId);
  if (cached) return { ...cached, docType: opts?.docType ?? cached.docType };

  if (parseXStatusUrl(url)) {
    const fetched = await fetchXStatusMaterial(url, docType);
    writeUrlCache(canonicalId, fetched);
    return fetched;
  }

  const extras = githubRepoRawCandidates(url) ?? [];
  const tryUrls = extras.length > 0 ? [...extras, url] : [url];
  let lastErr: unknown;
  for (let i = 0; i < tryUrls.length; i++) {
    const candidate = tryUrls[i];
    const isLast = i === tryUrls.length - 1;
    try {
      const fetched = await fetchOneUrl(candidate, docType);
      const material: UrlMaterial = { ...fetched, url, docType };
      writeUrlCache(canonicalId, material);
      return material;
    } catch (err) {
      lastErr = err;
      if (isLast) break;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(String(lastErr));
}

async function fetchOneUrl(url: string, docType: DocType): Promise<UrlMaterial> {
  const { status, contentType, buf } = await httpGet(url);
  if (status < 200 || status >= 300) {
    throw new Error(`url fetch failed: HTTP ${status} for ${url}`);
  }
  if (buf.length > MAX_BYTES) {
    throw new Error(`url fetch too large: ${buf.length} bytes (max ${MAX_BYTES}) for ${url}`);
  }

  let title = '';
  let text = '';
  const looksPdf = contentType.includes('application/pdf') || /\.pdf(\?|$)/i.test(url);

  if (looksPdf) {
    text = await pdfBufferToText(buf);
    title = firstNonEmptyLine(text) || urlPathTitle(url);
  } else if (contentType.includes('text/plain') || contentType.includes('text/markdown') || /\.(md|txt)(\?|$)/i.test(url)) {
    text = buf.toString('utf8');
    title = firstHeading(text) || urlPathTitle(url);
  } else {
    const html = buf.toString('utf8');
    if (/<html[\s>]/i.test(html) || contentType.includes('html') || /<body[\s>]/i.test(html)) {
      const extracted = extractHtmlMainText(html);
      title = extracted.title || urlPathTitle(url);
      text = extracted.text;
    } else {
      text = html;
      title = urlPathTitle(url);
    }
  }

  if (!text.trim()) {
    throw new Error(`url fetch produced empty text for ${url}`);
  }

  return { title, text, contentType: contentType || 'application/octet-stream', docType, url };
}

async function httpGet(url: string): Promise<{ status: number; contentType: string; buf: Buffer }> {
  try {
    return await fetchGet(url);
  } catch (err) {
    try {
      return await curlGet(url);
    } catch {
      throw new Error(`url fetch failed: ${formatNetworkError(err)} for ${url}`);
    }
  }
}

async function fetchGet(url: string): Promise<{ status: number; contentType: string; buf: Buffer }> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
    buf,
  };
}

async function curlGet(url: string): Promise<{ status: number; contentType: string; buf: Buffer }> {
  const dir = mkdtempSync(join(tmpdir(), 'researcher-url-get-'));
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
    return { status, contentType, buf };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function extractHtmlMainText(html: string): { title: string; text: string } {
  let title = '';
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (tm) title = decodeEntities(stripTags(tm[1])).replace(/\s+/g, ' ').trim();

  let body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const main =
    /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0] ??
    /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ??
    /<body\b[\s\S]*?<\/body>/i.exec(body)?.[0] ??
    body;

  const text = decodeEntities(
    main
      .replace(/<\/(p|div|h[1-6]|li|tr|section|header|footer|article|main|blockquote|pre)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );

  return { title, text };
}

function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function firstHeading(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : '';
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

function urlPathTitle(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return segs.at(-1) || u.hostname;
  } catch {
    return url;
  }
}

async function pdfBufferToText(buf: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'researcher-url-pdf-'));
  const pdfPath = join(dir, 'doc.pdf');
  try {
    writeFileSync(pdfPath, buf);
    const { stdout } = await execa('pdftotext', [pdfPath, '-'], { timeout: 60_000 });
    return stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── cache: <RESEARCHER_HOME>/cache/url/<sha16>.{meta.json,txt} ──────────────

function urlCacheKey(canonicalId: string): string {
  return createHash('sha256').update(canonicalId).digest('hex').slice(0, 16);
}

function urlCacheDir(): string {
  return join(resolveResearcherHome(), 'cache', 'url');
}

function readUrlCache(canonicalId: string): UrlMaterial | undefined {
  const key = urlCacheKey(canonicalId);
  const metaPath = join(urlCacheDir(), `${key}.meta.json`);
  const textPath = join(urlCacheDir(), `${key}.txt`);
  if (!existsSync(metaPath) || !existsSync(textPath)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Omit<UrlMaterial, 'text'>;
    const text = readFileSync(textPath, 'utf8');
    return { ...meta, text };
  } catch {
    return undefined;
  }
}

function writeUrlCache(canonicalId: string, material: UrlMaterial): void {
  const key = urlCacheKey(canonicalId);
  const dir = urlCacheDir();
  mkdirSync(dir, { recursive: true });
  const { text, ...meta } = material;
  writeAtomic(join(dir, `${key}.meta.json`), JSON.stringify(meta));
  writeAtomic(join(dir, `${key}.txt`), text);
}

function writeAtomic(finalPath: string, content: string): void {
  const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, finalPath);
}
