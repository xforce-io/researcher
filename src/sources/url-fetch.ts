import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveResearcherHome } from '../paths.js';
import { defaultDocTypeForSource, type DocType } from '../library/doc-type.js';
import type { SourceRef } from '../library/model.js';

const FETCH_TIMEOUT_MS = 60_000;
const MAX_BYTES = 5 * 1024 * 1024;

export interface UrlMaterial {
  title: string;
  text: string;
  contentType: string;
  docType: DocType;
  url: string;
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

  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'researcher-library/0.0 (+https://github.com/xforce-io/researcher)' },
  });
  if (!res.ok) {
    throw new Error(`url fetch failed: HTTP ${res.status} for ${url}`);
  }

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error(`url fetch too large: ${buf.length} bytes (max ${MAX_BYTES}) for ${url}`);
  }

  let title = '';
  let text = '';
  const looksPdf = contentType.includes('application/pdf') || /\.pdf(\?|$)/i.test(url);

  if (looksPdf) {
    text = await pdfBufferToText(buf);
    title = urlPathTitle(url);
  } else if (contentType.includes('text/plain') || contentType.includes('text/markdown') || /\.(md|txt)(\?|$)/i.test(url)) {
    text = buf.toString('utf8');
    title = firstHeading(text) || urlPathTitle(url);
  } else {
    // HTML and unknown types: attempt HTML extract; fall back to raw utf8.
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

  const material: UrlMaterial = { title, text, contentType: contentType || 'application/octet-stream', docType, url };
  writeUrlCache(canonicalId, material);
  return material;
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
