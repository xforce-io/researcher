import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/web/sanitize-html.js';
import { renderDoc, renderMarkdown } from '../../src/web/views.js';

describe('sanitizeHtml', () => {
  it('strips closed script tags', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script><p>x</p>');
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  it('strips unclosed script tags (no matching </script>)', () => {
    const out = sanitizeHtml('<p>before</p><script src=//evil.com/x.js><p>after</p>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('evil.com');
    // Content after unclosed script is consumed through end (safe failure mode).
    expect(out).toContain('<p>before</p>');
  });

  it('strips unclosed script with body and no close tag', () => {
    const out = sanitizeHtml('<div>x</div><script>alert(1)');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><a href="javascript:alert(2)">t</a>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript\s*:/i);
  });

  it('strips unquoted javascript: URLs', () => {
    const out = sanitizeHtml('<a href=javascript:alert(1)>click</a>');
    expect(out).not.toMatch(/javascript\s*:/i);
    expect(out).toMatch(/href\s*=\s*#/i);
  });

  it('strips case-variant JavaScript: URLs', () => {
    const out = sanitizeHtml('<a href="JavaScript:alert(9)">x</a>');
    expect(out).not.toMatch(/javascript\s*:/i);
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

  it('renderDoc strips unclosed script and unquoted javascript: payloads', () => {
    // Real serve path: marked → sanitizeHtml.
    const html = renderDoc([
      '---',
      'title: "XSS edge"',
      '---',
      '',
      '# Edge',
      '',
      '<script src=//evil.example/x.js>',
      '',
      '<a href=javascript:alert(42)>go</a>',
      '',
      'safe paragraph',
    ].join('\n'));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('evil.example');
    expect(html).not.toMatch(/javascript\s*:/i);
    expect(html).not.toContain('alert(42)');
  });

  it('sanitize path is used by renderMarkdown (serve thesis previews)', () => {
    const html = renderMarkdown('hi <script>evil()</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('evil()');
  });
});
