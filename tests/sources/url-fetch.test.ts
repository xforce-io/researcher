import { describe, expect, it, vi, afterEach } from 'vitest';
import { extractHtmlMainText, fetchUrlMaterial, formatNetworkError, githubRepoRawCandidates } from '../../src/sources/url-fetch.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('extractHtmlMainText', () => {
  it('strips scripts/styles and prefers article body', () => {
    const html = `
      <html><head><title>Design Doc: Cache</title>
      <style>.x{color:red}</style>
      <script>alert(1)</script></head>
      <body>
        <nav>Home</nav>
        <article>
          <h1>Cache design</h1>
          <p>We decided to use LRU.</p>
          <p>Tradeoff: memory vs hit rate.</p>
        </article>
        <footer>©</footer>
      </body></html>`;
    const { title, text } = extractHtmlMainText(html);
    expect(title).toBe('Design Doc: Cache');
    expect(text).toContain('Cache design');
    expect(text).toContain('We decided to use LRU.');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
  });

  it('decodes basic entities', () => {
    const { text } = extractHtmlMainText('<html><body><p>A &amp; B &lt; C</p></body></html>');
    expect(text).toContain('A & B < C');
  });
});

describe('fetchUrlMaterial', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEARCHER_HOME;
  });

  it('fetches HTML and returns runner-owned text + title', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `<html><head><title>Blog Post</title></head><body><article><p>Hello doc world.</p></article></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )));

    const material = await fetchUrlMaterial('url:https://example.com/blog/hello');
    expect(material.title).toBe('Blog Post');
    expect(material.text).toContain('Hello doc world.');
    expect(material.contentType).toMatch(/html/i);
    expect(material.docType).toBe('blog');
  });

  it('uses cache on second fetch', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-url-'));
    const fetchMock = vi.fn(async () => new Response(
      `<html><head><title>Once</title></head><body><main><p>Cached body</p></main></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const a = await fetchUrlMaterial('url:https://example.com/x');
    const b = await fetchUrlMaterial('url:https://example.com/x');
    expect(a.text).toContain('Cached body');
    expect(b.text).toContain('Cached body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
