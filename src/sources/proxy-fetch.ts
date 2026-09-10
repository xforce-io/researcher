import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_UA = 'researcher-library/0.0 (+https://github.com/xforce-io/researcher)';

export type CurlGet = (url: string, init?: RequestInit) => Promise<Response>;

/** True when a standard HTTP(S) proxy env var is set. Node global fetch ignores these. */
export function envHasHttpProxy(env: NodeJS.Dict<string> = process.env): boolean {
  return Boolean(
    env.HTTPS_PROXY ||
      env.https_proxy ||
      env.HTTP_PROXY ||
      env.http_proxy ||
      env.ALL_PROXY ||
      env.all_proxy,
  );
}

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function headerUserAgent(init?: RequestInit): string {
  const h = init?.headers;
  if (!h) return DEFAULT_UA;
  if (h instanceof Headers) return h.get('user-agent') || DEFAULT_UA;
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k.toLowerCase() === 'user-agent');
    return hit?.[1] || DEFAULT_UA;
  }
  const rec = h as Record<string, string>;
  return rec['user-agent'] || rec['User-Agent'] || DEFAULT_UA;
}

/** curl honors HTTP(S)_PROXY / NO_PROXY; used when Node fetch cannot. */
export async function curlGetResponse(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const dir = mkdtempSync(join(tmpdir(), 'researcher-http-get-'));
  const out = join(dir, 'body');
  try {
    const { stdout } = await execa(
      'curl',
      [
        '-sS',
        '-L',
        '-o',
        out,
        '-w',
        '%{http_code}\n%{content_type}',
        '--max-time',
        String(Math.max(1, Math.floor(timeoutMs / 1000))),
        '-A',
        headerUserAgent(init),
        url,
      ],
      { timeout: timeoutMs + 5_000 },
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

/**
 * Fetch that skips native fetch when a proxy env var is set (avoids a long
 * connect hang), otherwise fetch-then-curl like arXiv/url-fetch.
 */
export function createProxyAwareFetch(opts?: {
  fetch?: typeof fetch;
  curlGet?: CurlGet;
  env?: NodeJS.Dict<string>;
  timeoutMs?: number;
}): typeof fetch {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (input, init) => {
    const url = requestUrl(input);
    const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis);
    const curlGet = opts?.curlGet ?? ((u, i) => curlGetResponse(u, i, timeoutMs));
    const env = opts?.env ?? process.env;
    if (envHasHttpProxy(env)) {
      return curlGet(url, init);
    }
    try {
      return await fetchFn(input, init);
    } catch (err) {
      try {
        return await curlGet(url, init);
      } catch {
        throw err;
      }
    }
  };
}

export const proxyAwareFetch: typeof fetch = createProxyAwareFetch();
