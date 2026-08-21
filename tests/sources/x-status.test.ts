import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlMaterial } from '../../src/sources/url-fetch.js';
import {
  materialFromFxtwitter,
  materialFromSyndication,
  parseXStatusUrl,
} from '../../src/sources/x-status.js';

describe('parseXStatusUrl', () => {
  it('accepts x.com and twitter.com status URLs', () => {
    expect(parseXStatusUrl('https://x.com/vasuman/status/2085806422072418632')).toEqual({
      handle: 'vasuman',
      statusId: '2085806422072418632',
    });
    expect(parseXStatusUrl('https://twitter.com/foo/status/1?s=20')).toEqual({
      handle: 'foo',
      statusId: '1',
    });
    expect(parseXStatusUrl('https://mobile.x.com/foo/status/2#x')).toEqual({
      handle: 'foo',
      statusId: '2',
    });
  });

  it('rejects non-status URLs', () => {
    expect(parseXStatusUrl('https://x.com/vasuman')).toBeNull();
    expect(parseXStatusUrl('https://example.com/status/1')).toBeNull();
  });
});

describe('materialFromFxtwitter', () => {
  it('maps a plain tweet', () => {
    const m = materialFromFxtwitter(
      { tweet: { text: 'hello world', author: { screen_name: 'a' } } },
      'https://x.com/a/status/1',
      'blog',
    );
    expect(m.text).toBe('hello world');
    expect(m.title).toBe('hello world');
    expect(m.docType).toBe('blog');
  });

  it('folds an X Article when tweet text is a t.co link', () => {
    const m = materialFromFxtwitter(
      {
        tweet: {
          text: '',
          raw_text: { text: 'https://t.co/haApURmzAN' },
          author: { screen_name: 'vasuman' },
          article: {
            title: 'AI Adoption is a Myth',
            content: {
              blocks: [
                { text: 'You’re already in the top 1% of AI users.' },
                { text: ' ' },
                { text: 'They won’t catch up.' },
              ],
            },
          },
        },
      },
      'https://x.com/vasuman/status/2085806422072418632',
      'blog',
    );
    expect(m.title).toBe('AI Adoption is a Myth');
    expect(m.text).toContain('# AI Adoption is a Myth');
    expect(m.text).toContain('top 1%');
    expect(m.text).toContain('They won’t catch up.');
    expect(m.text).not.toContain('t.co');
  });

  it('throws when tweet and article are empty', () => {
    expect(() =>
      materialFromFxtwitter(
        { tweet: { text: '', author: { screen_name: 'a' } } },
        'https://x.com/a/status/1',
        'blog',
      ),
    ).toThrow(/empty text/);
  });
});

describe('materialFromSyndication', () => {
  it('uses article preview when blocks are missing', () => {
    const m = materialFromSyndication(
      {
        text: 'https://t.co/x',
        user: { screen_name: 'vasuman' },
        article: { title: 'AI Adoption is a Myth', preview_text: 'You’re already in the top 1%.' },
      },
      'https://x.com/vasuman/status/1',
      'blog',
    );
    expect(m.text).toContain('# AI Adoption is a Myth');
    expect(m.text).toContain('top 1%');
  });
});

describe('fetchUrlMaterial X dispatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEARCHER_HOME;
  });

  it('uses fxtwitter and does not GET the x.com HTML page', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-x-'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.fxtwitter.com')) {
        return Response.json({
          tweet: { text: 'plain status', author: { screen_name: 'foo' } },
        });
      }
      return new Response('<html><body>shell</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const material = await fetchUrlMaterial('url:https://x.com/foo/status/99');
    expect(material.text).toBe('plain status');
    expect(material.docType).toBe('blog');
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('x.com/foo/status'))).toBe(true);
  });

  it('does not write cache when both public APIs fail', async () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-x-'));
    process.env.RESEARCHER_HOME = home;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    await expect(fetchUrlMaterial('url:https://x.com/foo/status/99')).rejects.toThrow(/503|X status/);
    const cacheDir = join(home, 'cache', 'url');
    expect(existsSync(cacheDir) ? readdirSync(cacheDir) : []).toEqual([]);
  });

  it('does not send status URLs to X APIs for a normal page', async () => {
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-x-'));
    const fetchMock = vi.fn(async () =>
      new Response(
        '<html><head><title>Hi</title></head><body><article><p>page</p></article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const material = await fetchUrlMaterial('url:https://example.com/post');
    expect(material.text).toContain('page');
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('fxtwitter'))).toBe(true);
  });
});
