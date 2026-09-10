import { describe, expect, it, vi } from 'vitest';
import {
  createProxyAwareFetch,
  envHasHttpProxy,
  headerUserAgent,
  requestUrl,
} from '../../src/sources/proxy-fetch.js';

describe('envHasHttpProxy', () => {
  it('is false when no proxy vars are set', () => {
    expect(envHasHttpProxy({})).toBe(false);
    expect(envHasHttpProxy({ PATH: '/bin', NO_PROXY: '*' })).toBe(false);
  });

  it('is true for standard HTTP(S)_PROXY names', () => {
    expect(envHasHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:6478' })).toBe(true);
    expect(envHasHttpProxy({ https_proxy: 'http://127.0.0.1:6478' })).toBe(true);
    expect(envHasHttpProxy({ HTTP_PROXY: 'http://127.0.0.1:6478' })).toBe(true);
    expect(envHasHttpProxy({ ALL_PROXY: 'http://127.0.0.1:6478' })).toBe(true);
  });
});

describe('requestUrl / headerUserAgent', () => {
  it('stringifies Request and URL inputs', () => {
    expect(requestUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(requestUrl(new URL('https://example.com/b'))).toBe('https://example.com/b');
    expect(requestUrl(new Request('https://example.com/c'))).toBe('https://example.com/c');
  });

  it('reads user-agent from header shapes', () => {
    expect(headerUserAgent()).toMatch(/^researcher-library\//);
    expect(headerUserAgent({ headers: { 'user-agent': 'ua-a' } })).toBe('ua-a');
    expect(headerUserAgent({ headers: { 'User-Agent': 'ua-b' } })).toBe('ua-b');
    expect(headerUserAgent({ headers: new Headers({ 'user-agent': 'ua-c' }) })).toBe('ua-c');
    expect(headerUserAgent({ headers: [['user-agent', 'ua-d']] })).toBe('ua-d');
  });
});

describe('createProxyAwareFetch', () => {
  it('uses curl and skips native fetch when a proxy env var is set', async () => {
    const fetchFn = vi.fn(async () => new Response('from-fetch'));
    const curlGet = vi.fn(async () => new Response('from-curl', { status: 200 }));
    const f = createProxyAwareFetch({
      fetch: fetchFn,
      curlGet,
      env: { HTTPS_PROXY: 'http://127.0.0.1:6478' },
    });
    const res = await f('https://huggingface.co/api/daily_papers');
    expect(await res.text()).toBe('from-curl');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(curlGet).toHaveBeenCalledTimes(1);
    expect(curlGet.mock.calls[0][0]).toBe('https://huggingface.co/api/daily_papers');
  });

  it('uses native fetch and skips curl when no proxy and fetch succeeds', async () => {
    const fetchFn = vi.fn(async () => new Response('from-fetch', { status: 200 }));
    const curlGet = vi.fn(async () => new Response('from-curl'));
    const f = createProxyAwareFetch({ fetch: fetchFn, curlGet, env: {} });
    const res = await f('https://export.arxiv.org/api/query');
    expect(await res.text()).toBe('from-fetch');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(curlGet).not.toHaveBeenCalled();
  });

  it('falls back to curl when no proxy and native fetch throws', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const curlGet = vi.fn(async () => new Response('from-curl', { status: 200 }));
    const f = createProxyAwareFetch({ fetch: fetchFn, curlGet, env: {} });
    const res = await f('https://huggingface.co/api/daily_papers');
    expect(await res.text()).toBe('from-curl');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(curlGet).toHaveBeenCalledTimes(1);
  });

  it('rethrows the fetch error when curl also fails', async () => {
    const boom = new TypeError('fetch failed');
    const fetchFn = vi.fn(async () => {
      throw boom;
    });
    const curlGet = vi.fn(async () => {
      throw new Error('curl failed');
    });
    const f = createProxyAwareFetch({ fetch: fetchFn, curlGet, env: {} });
    await expect(f('https://example.com/x')).rejects.toBe(boom);
  });
});
