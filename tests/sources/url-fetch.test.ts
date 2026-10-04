import { describe, expect, it, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchUrlMaterial, formatNetworkError, githubRepoRawCandidates } from '../../src/sources/url-fetch.js';
import { UrlExtractError } from '../../src/sources/url-extract.js';
import { longParagraphs } from '../helpers/long-prose.js';

function htmlPage(title: string, body: string): string {
  return `<html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function cacheKey(canonicalId: string): string {
  return createHash('sha256').update(canonicalId).digest('hex').slice(0, 16);
}

describe('fetchUrlMaterial', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEARCHER_HOME;
  });

  it('fetches HTML and returns runner-owned text + title', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      htmlPage('Blog Post', `<article>${longParagraphs('Hello doc world.')}</article>`),
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )));

    const material = await fetchUrlMaterial('url:https://example.com/blog/hello');
    expect(material.title).toBe('Blog Post');
    expect(material.text).toContain('Hello doc world.');
    expect(material.contentType).toMatch(/html/i);
    expect(material.docType).toBe('blog');
    expect(['readability', 'dom-fallback']).toContain(material.extractionMethod);
    expect(material.bodyChars).toBeGreaterThanOrEqual(1000);
  });

  it('uses cache on second fetch', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    const fetchMock = vi.fn(async () => new Response(
      htmlPage('Once', `<main>${longParagraphs('Cached body')}</main>`),
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const a = await fetchUrlMaterial('url:https://example.com/x');
    const b = await fetchUrlMaterial('url:https://example.com/x');
    expect(a.text).toContain('Cached body');
    expect(b.text).toContain('Cached body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips cache when forceRefetch is set', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    const fetchMock = vi.fn(async () => new Response(
      htmlPage('Again', `<main>${longParagraphs('Fresh body')}</main>`),
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUrlMaterial('url:https://example.com/x');
    await fetchUrlMaterial('url:https://example.com/x', { forceRefetch: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('self-heals a short HTML cache hit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    process.env.RESEARCHER_HOME = home;
    const id = 'url:https://example.com/poison';
    const key = cacheKey(id);
    const dir = join(home, 'cache', 'url');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
      title: 'Poison',
      contentType: 'text/html',
      docType: 'blog',
      url: 'https://example.com/poison',
    }));
    writeFileSync(join(dir, `${key}.txt`), '82 byte teaser');
    const fetchMock = vi.fn(async () => new Response(
      htmlPage('Healed', `<article>${longParagraphs('Healed body')}</article>`),
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const material = await fetchUrlMaterial(id);
    expect(material.text).toContain('Healed body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, `${key}.txt`), 'utf8')).toContain('Healed body');
  });

  it('does not write cache when HTML extract is too short', async () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    process.env.RESEARCHER_HOME = home;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      htmlPage('Short', '<article><p>tiny</p></article>'),
      { status: 200, headers: { 'content-type': 'text/html' } },
    )));
    await expect(fetchUrlMaterial('url:https://example.com/short')).rejects.toBeInstanceOf(UrlExtractError);
    const dir = join(home, 'cache', 'url');
    expect(existsSync(dir) ? readFileSync : () => '').toBeTruthy();
    if (existsSync(dir)) {
      expect(readFileSync).toBeTypeOf('function');
      const files = (await import('node:fs')).readdirSync(dir);
      expect(files.filter((f) => f.endsWith('.txt'))).toEqual([]);
    }
  });

  it('throws a clear error on HTTP failure', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(fetchUrlMaterial('url:https://example.com/missing')).rejects.toThrow(/404|fetch/i);
  });

  it('includes the underlying fetch cause in the thrown error', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    const cause = Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const boom = new TypeError('fetch failed', { cause });
    vi.stubGlobal('fetch', vi.fn(async () => { throw boom; }));
    await expect(fetchUrlMaterial('url:http://127.0.0.1:1/doc')).rejects.toThrow(/UND_ERR_CONNECT_TIMEOUT/);
  });

  it('resolves a GitHub repo-root URL to paper text via raw artifacts', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (/paper\.pdf(\?|$)/i.test(u)) {
        return new Response('missing', { status: 404 });
      }
      if (/\/README\.md(\?|$)/i.test(u)) {
        return new Response(
          '# A Programming Paradigm for Spatiotemporal Composability\n\nAbstract\nWe lift effects.\n',
          { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } },
        );
      }
      return new Response(
        '<html><head><title>GitHub</title></head><body><main>repo chrome</main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const material = await fetchUrlMaterial('url:https://github.com/acme/paper');
    expect(material.text).toContain('Spatiotemporal Composability');
    expect(material.text).toContain('Abstract');
    expect(material.extractionMethod).toBe('plain');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('raw.githubusercontent.com'))).toBe(true);
  });
});

describe('formatNetworkError', () => {
  it('includes the Node fetch message and cause code', () => {
    const cause = Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const err = new TypeError('fetch failed', { cause });
    const msg = formatNetworkError(err);
    expect(msg).toMatch(/fetch failed/);
    expect(msg).toMatch(/UND_ERR_CONNECT_TIMEOUT/);
  });
});

describe('githubRepoRawCandidates', () => {
  it('lists paper.pdf then README on main/master for a repo root', () => {
    const urls = githubRepoRawCandidates('https://github.com/cordiverse/paper');
    expect(urls?.[0]).toBe('https://raw.githubusercontent.com/cordiverse/paper/main/paper.pdf');
    expect(urls).toContain('https://raw.githubusercontent.com/cordiverse/paper/main/README.md');
    expect(urls).toContain('https://raw.githubusercontent.com/cordiverse/paper/master/paper.pdf');
  });

  it('ignores blob/issue paths and reserved owners', () => {
    expect(githubRepoRawCandidates('https://github.com/cordiverse/paper/blob/main/paper.pdf')).toBeUndefined();
    expect(githubRepoRawCandidates('https://github.com/topics/agents')).toBeUndefined();
  });
});
