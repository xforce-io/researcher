import { describe, expect, it, vi } from 'vitest';
import { extractHtmlArticle, isBodyTooShort, previewReadability, UrlExtractError } from '../../src/sources/url-extract.js';
import { longParagraphs, longProse } from '../helpers/long-prose.js';

vi.mock('@mozilla/readability', () => ({
  Readability: class {
    parse() {
      return { title: 'Teaser', textContent: 'Short teaser, with commas. Still under the threshold.' };
    }
  },
}));

describe('extractHtmlArticle when Readability misses the threshold', () => {
  it('uses dom-fallback and keeps the passing semantic node', () => {
    const html = `<!doctype html><html><head><title>Teaser</title></head><body>
      <article>
        <p>This is a short teaser, with commas, periods, and enough class to look like an article to Readability.</p>
      </article>
      <div role="main">${longParagraphs('DOM_FALLBACK_WIN unique marker')}</div>
    </body></html>`;
    expect(isBodyTooShort(previewReadability(html).text)).toBe(true);
    const result = extractHtmlArticle(html);
    expect(result.extractionMethod).toBe('dom-fallback');
    expect(result.text).toContain('DOM_FALLBACK_WIN');
  });

  it('uses body only when it passes length and link-density', () => {
    const html = `<!doctype html><html><head><title>Body only</title></head><body>
      ${longParagraphs('BODY_ONLY_OK unique')}
    </body></html>`;
    expect(isBodyTooShort(previewReadability(html).text)).toBe(true);
    const result = extractHtmlArticle(html);
    expect(result.extractionMethod).toBe('dom-fallback');
    expect(result.text).toContain('BODY_ONLY_OK');
  });

  it('fails when the only body candidate is too link-dense', () => {
    const links = Array.from({ length: 12 }, (_, i) =>
      `<a href="/r${i}">${longProse(`dense link ${i}`, 40)}</a>`,
    ).join(' ');
    const html = `<!doctype html><html><head><title>Dense body</title></head><body>${links}</body></html>`;
    expect(() => extractHtmlArticle(html)).toThrow(UrlExtractError);
  });
});
