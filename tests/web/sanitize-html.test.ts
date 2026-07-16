import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/web/sanitize-html.js';
import { renderDoc, renderMarkdown } from '../../src/web/views.js';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script><p>x</p>');
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><a href="javascript:alert(2)">t</a>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('renderDoc / renderMarkdown XSS (#77)', () => {
  it('does not emit executable script from note markdown via renderDoc', () => {
    const html = renderDoc([
      '---',
      'title: "Safe"',
      '---',
      '',
      '# Safe',
      '',
      '<script>alert("xss")</script>',
      '',
      'Normal **text**.',
      '',
      '<img src=x onerror=alert(1)>',
    ].join('\n'));
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toContain('alert("xss")');
    expect(html).not.toMatch(/onerror\s*=/i);
    expect(html).toContain('Normal');
    expect(html).toContain('<strong>text</strong>');
  });

  it('sanitize path is used by renderMarkdown (serve thesis previews)', () => {
    const html = renderMarkdown('hi <script>evil()</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('evil()');
  });
});
