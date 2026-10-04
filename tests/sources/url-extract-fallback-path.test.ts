import { describe, expect, it, vi } from 'vitest';
import { extractHtmlArticle, isBodyTooShort, previewReadability } from '../../src/sources/url-extract.js';
import { longParagraphs } from '../helpers/long-prose.js';

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
});
