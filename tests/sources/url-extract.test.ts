import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countBodyStats,
  extractDomFallback,
  extractHtmlArticle,
  UrlExtractError,
} from '../../src/sources/url-extract.js';
import { extractHtmlMainText } from '../helpers/legacy-html-extract.js';
import { longParagraphs, longProse } from '../helpers/long-prose.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/url-extract');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

describe('countBodyStats', () => {
  it('counts Han characters inside a token as words', () => {
    const stats = countBodyStats('汉字测试与 English mix');
    expect(stats.chars).toBeGreaterThan(0);
    expect(stats.words).toBeGreaterThanOrEqual(4 + 2);
  });
});

describe('every.to fixture path', () => {
  it('extracts real prose via readability and keeps fallback off the rec card', () => {
    const html = loadFixture('everyto-codex-graded.html');
    const result = extractHtmlArticle(html);
    const stats = countBodyStats(result.text);
    // Actual path on this saved page: Readability, not the DOM fallback.
    expect(result.extractionMethod).toBe('readability');
    expect(stats.chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toMatch(/blank slate/i);
    expect(result.text).toMatch(/Eight Levels/i);
    const legacy = extractHtmlMainText(html);
    expect(legacy.text).toMatch(/Vibe Check|post-preview|Related Essays/i);
    expect(legacy.text.length).toBeLessThan(stats.chars);
    const fallback = extractDomFallback(html);
    expect(fallback.text).toMatch(/blank slate/i);
    expect(fallback.text).toMatch(/Eight Levels/i);
    expect(fallback.text).not.toBe(legacy.text);
    expect(fallback.text).not.toMatch(/^Vibe Check: GPT-5\.6 Sol/);
  });
});

describe('regression fixtures', () => {
  it('blog-article.html keeps the article body', () => {
    const result = extractHtmlArticle(loadFixture('blog-article.html'));
    expect(result.title).toMatch(/Cache design/i);
    expect(countBodyStats(result.text).chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toContain('LRU');
  });

  it('github-readme.html keeps the README prose', () => {
    const result = extractHtmlArticle(loadFixture('github-readme.html'));
    expect(result.title).toMatch(/Spatiotemporal/i);
    expect(countBodyStats(result.text).chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toContain('Spatiotemporal');
  });

  it('docs-page.html keeps the main docs copy', () => {
    const result = extractHtmlArticle(loadFixture('docs-page.html'));
    expect(result.title).toMatch(/API Overview/i);
    expect(countBodyStats(result.text).chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toContain('paste_too_short');
  });
});

describe('Knox fallback path', () => {
  it('fails closed when both paths miss the threshold', () => {
    const html = `<!doctype html><html><head><title>Tiny</title></head>
      <body><article><p>too short</p></article><main><p>also short</p></main></body></html>`;
    expect(() => extractHtmlArticle(html)).toThrow(UrlExtractError);
    try {
      extractHtmlArticle(html);
    } catch (err) {
      expect(err).toBeInstanceOf(UrlExtractError);
      expect((err as UrlExtractError).failureCode).toBe('extract_too_short');
    }
  });

  it('picks the deeper semantic node when article is nested in main', () => {
    const html = `<!doctype html><html><head><title>Nested</title></head><body>
      <main>
        ${longParagraphs('SHALLOW_MAIN unique')}
        <article>${longParagraphs('DEEP_ARTICLE_MARKER unique')}</article>
      </main>
    </body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.text).toContain('DEEP_ARTICLE_MARKER');
    expect(fallback.text).not.toContain('SHALLOW_MAIN');
  });

  it('picks the longer sibling when article and main share a depth', () => {
    const html = `<!doctype html><html><head><title>Siblings</title></head><body>
      <main>${longParagraphs('SIBLING_MAIN unique')}</main>
      <article>${longParagraphs('SIBLING_ARTICLE unique', 8)}</article>
    </body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.text).toContain('SIBLING_ARTICLE');
    expect(fallback.text).not.toContain('SIBLING_MAIN');
  });

  it('does not score body against a passing article', () => {
    const html = `<!doctype html><html><head><title>Body trap</title></head><body>
      <article>${longParagraphs('ONLY_ARTICLE unique')}</article>
      ${longParagraphs('BODY_NOISE unique', 8)}
    </body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.text).toContain('ONLY_ARTICLE');
    expect(fallback.text).not.toContain('BODY_NOISE');
  });

  it('drops high-density rec cards without class/id keyword matching', () => {
    const rec = `<article><a href="/a">${longProse('Rec card one', 40)}</a> <a href="/b">${longProse('Rec card two', 40)}</a></article>`;
    const html = `<!doctype html><html><head><title>Mix</title></head><body>
      ${rec}
      <main>${longParagraphs('REAL_PROSE unique')}</main>
    </body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.text).toContain('REAL_PROSE');
    expect(fallback.text).not.toMatch(/Rec card one/);
  });
});
