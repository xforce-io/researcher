import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, urlPathSlug } from '../../src/sources/url.js';

describe('canonicalizeUrl', () => {
  it('accepts an http URL', () => {
    expect(canonicalizeUrl('http://example.com/foo')).toBe('url:http://example.com/foo');
  });
  it('accepts an https URL', () => {
    expect(canonicalizeUrl('https://example.com/foo')).toBe('url:https://example.com/foo');
  });
  it('lowercases the host', () => {
    expect(canonicalizeUrl('https://Example.COM/Path')).toBe('url:https://example.com/Path');
  });
  it('strips the URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/x#section')).toBe('url:https://example.com/x');
  });
  it('preserves query params', () => {
    expect(canonicalizeUrl('https://example.com/x?a=1&b=2')).toBe('url:https://example.com/x?a=1&b=2');
  });
  it('preserves trailing slash when present', () => {
    expect(canonicalizeUrl('https://example.com/foo/')).toBe('url:https://example.com/foo/');
  });
  it('trims whitespace', () => {
    expect(canonicalizeUrl('  https://example.com/x  ')).toBe('url:https://example.com/x');
  });
  it('is idempotent on already-prefixed canonical strings', () => {
    const once = canonicalizeUrl('https://example.com/foo');
    const bare = once.replace(/^url:/, '');
    expect(canonicalizeUrl(bare)).toBe(once);
  });
  it('rejects non-http(s) schemes', () => {
    expect(() => canonicalizeUrl('ftp://example.com/x')).toThrow();
    expect(() => canonicalizeUrl('file:///etc/passwd')).toThrow();
  });
  it('rejects malformed input', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow();
    expect(() => canonicalizeUrl('')).toThrow();
  });
});

describe('urlPathSlug', () => {
  it('returns the last non-empty path segment', () => {
    expect(urlPathSlug('url:https://facebookresearch.github.io/RAM/blogs/autodata')).toBe('autodata');
  });
  it('strips a trailing slash before picking the segment', () => {
    expect(urlPathSlug('url:https://facebookresearch.github.io/RAM/blogs/autodata/')).toBe('autodata');
  });
  it('falls back to host when path is "/"', () => {
    expect(urlPathSlug('url:https://example.com/')).toBe('example.com');
  });
  it('falls back to host when path is empty', () => {
    expect(urlPathSlug('url:https://example.com')).toBe('example.com');
  });
  it('falls back to host when last segment is literally "index"', () => {
    expect(urlPathSlug('url:https://example.com/index')).toBe('example.com');
  });
  it('keeps file-extension segments as-is', () => {
    expect(urlPathSlug('url:https://example.com/path/foo.html')).toBe('foo.html');
  });
  it('throws if input is not a url:-prefixed string', () => {
    expect(() => urlPathSlug('arxiv:2401.12345')).toThrow();
  });
});
