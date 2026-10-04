import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  countBodyStats,
  extractDomFallback,
  extractHtmlArticle,
  isBodyTooShort,
  loadUrlExtractThreshold,
  UrlExtractError,
} from '../../src/sources/url-extract.js';
import { extractHtmlMainText } from '../helpers/legacy-html-extract.js';
import { longParagraphs, longProse } from '../helpers/long-prose.js';

/** Exact char/word counts for threshold boundary tests. */
function textWithStats(chars: number, words: number): string {
  if (words < 1) return 'x'.repeat(chars);
  const spaces = words - 1;
  if (chars < words + spaces) {
    throw new Error(`cannot fit ${words} words into ${chars} chars`);
  }
  const letters = chars - spaces;
  const base = Math.floor(letters / words);
  const extra = letters % words;
  const tokens = Array.from({ length: words }, (_, i) => 'x'.repeat(base + (i < extra ? 1 : 0)));
  const out = tokens.join(' ');
  const stats = countBodyStats(out);
  if (stats.chars !== chars || stats.words !== words) {
    throw new Error(`textWithStats wanted ${chars}/${words}, got ${stats.chars}/${stats.words}`);
  }
  return out;
}

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
    expect(result.extractionMethod).toBe('readability');
    expect(stats.chars).toBeGreaterThanOrEqual(1000);
    expect(result.text).toMatch(/blank slate/i);
    expect(result.text).toMatch(/Eight Levels/i);
    const fallback = extractDomFallback(html);
    expect(fallback.text).toMatch(/blank slate/i);
    expect(fallback.text).toMatch(/Eight Levels/i);
    expect(fallback.text).not.toMatch(/^Vibe Check: GPT-5\.6 Sol/);
  });

  it('legacy first-article regex grabs the rec card and would fail the prose assertions', () => {
    const html = loadFixture('everyto-codex-graded.html');
    const legacy = extractHtmlMainText(html);
    expect(legacy.text).toMatch(/Vibe Check|post-preview|Related Essays/i);
    expect(legacy.text).not.toMatch(/blank slate/i);
    expect(legacy.text).not.toMatch(/Eight Levels/i);
    expect(countBodyStats(legacy.text).chars).toBeLessThan(1000);
    const current = extractHtmlArticle(html);
    expect(legacy.text).not.toBe(current.text);
    expect(legacy.text.length).toBeLessThan(current.text.length);
  });
});

describe('body threshold boundaries', () => {
  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
  });

  it('fails at 999 chars with 150 words', () => {
    expect(isBodyTooShort(textWithStats(999, 150))).toBe(true);
  });

  it('passes at 1000 chars with 150 words', () => {
    expect(isBodyTooShort(textWithStats(1000, 150))).toBe(false);
  });

  it('fails at 149 words with 1000 chars', () => {
    expect(isBodyTooShort(textWithStats(1000, 149))).toBe(true);
  });

  it('passes at 150 words with 1000 chars', () => {
    expect(isBodyTooShort(textWithStats(1000, 150))).toBe(false);
  });

  it('counts mixed Han-English so a 1000-Han token passes both gates', () => {
    const han = '字'.repeat(1000);
    expect(countBodyStats(han)).toEqual({ chars: 1000, words: 1000 });
    expect(isBodyTooShort(han)).toBe(false);
    expect(isBodyTooShort(`${han} English mix`)).toBe(false);
    expect(isBodyTooShort('字'.repeat(999))).toBe(true);
  });

  it('honors urlExtract minChars/minWords from RESEARCHER_HOME config', () => {
    const home = mkdtempSync(join(tmpdir(), 'r-extract-cfg-'));
    process.env.RESEARCHER_HOME = home;
    writeFileSync(join(home, 'config.yaml'), 'urlExtract:\n  minChars: 400\n  minWords: 60\n');
    const threshold = loadUrlExtractThreshold();
    expect(threshold).toEqual({ minChars: 400, minWords: 60 });
    const html = `<!doctype html><html><head><title>Cfg</title></head><body><article><p>${textWithStats(400, 60)}</p></article></body></html>`;
    expect(() => extractHtmlArticle(html)).toThrow(UrlExtractError);
    const result = extractHtmlArticle(html, threshold);
    expect(result.text.length).toBeGreaterThan(0);
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

  it('accepts a body-only fallback that passes length and link-density', () => {
    const html = `<!doctype html><html><head><title>Body only</title></head><body>
      ${longParagraphs('BODY_ONLY_OK unique')}
    </body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.accepted).toBe(true);
    expect(fallback.text).toContain('BODY_ONLY_OK');
    expect(isBodyTooShort(fallback.text)).toBe(false);
  });

  it('rejects a body-only fallback when link density exceeds the cap', () => {
    const links = Array.from({ length: 12 }, (_, i) =>
      `<a href="/r${i}">${longProse(`dense link ${i}`, 40)}</a>`,
    ).join(' ');
    const html = `<!doctype html><html><head><title>Dense body</title></head><body>${links}</body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.accepted).toBe(false);
  });

  it('rejects a body-only fallback when the body misses the min-length gate', () => {
    const html = `<!doctype html><html><head><title>Short body</title></head><body><p>tiny body</p></body></html>`;
    const fallback = extractDomFallback(html);
    expect(fallback.accepted).toBe(false);
    expect(() => extractHtmlArticle(html)).toThrow(UrlExtractError);
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
