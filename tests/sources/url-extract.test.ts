import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countBodyStats,
  extractDomFallback,
  extractHtmlArticle,
  isBodyTooShort,
  previewReadability,
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
  it('extracts real prose and records the path that actually ran', () => {
    const html = loadFixture('everyto-codex-graded.html');
    const result = extractHtmlArticle(html);
    const stats = countBodyStats(result.text);
    expect(['readability', 'dom-fallback']).toContain(result.extractionMethod);
    expect(stats.chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toMatch(/blank slate/i);
    expect(result.text).toMatch(/Eight Levels/i);
    const legacy = extractHtmlMainText(html);
    expect(legacy.text).toMatch(/Vibe Check|post-preview|Related Essays/i);
    expect(legacy.text.length).toBeLessThan(stats.chars);
    if (result.extractionMethod === 'dom-fallback') {
      expect(result.text).not.toBe(legacy.text);
      expect(result.text).not.toMatch(/^Vibe Check: GPT-5\.6 Sol/);
    }
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
  it('uses dom-fallback when Readability misses the threshold and the deep node passes', () => {
    const html = `<!doctype html><html><head><title>Teaser</title></head><body>
      <article>
        <p>This is a short teaser, with commas, periods, and enough class to look like an article to Readability.</p>
        <p>Second teaser paragraph, also with punctuation, still short of the body threshold.</p>
      </article>
      <div role="main">${longParagraphs('DOM_FALLBACK_WIN unique marker')}</div>
    </body></html>`;
    expect(isBodyTooShort(previewReadability(html).text)).toBe(true);
    const fallback = extractDomFallback(html);
    expect(fallback.text).toContain('DOM_FALLBACK_WIN');
    expect(isBodyTooShort(fallback.text)).toBe(false);
    const result = extractHtmlArticle(html);
    expect(result.extractionMethod).toBe('dom-fallback');
    expect(result.text).toContain('DOM_FALLBACK_WIN');
  });

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
