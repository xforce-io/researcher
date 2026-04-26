import { describe, it, expect, vi, afterEach } from 'vitest';
import { canonicalizeArxivId, arxivAbsUrl, arxivPdfUrl, fetchArxivMetadata } from '../../src/sources/arxiv.js';

describe('arxiv', () => {
  it('canonicalizes bare id', () => {
    expect(canonicalizeArxivId('2401.12345')).toBe('arxiv:2401.12345');
  });
  it('canonicalizes URL', () => {
    expect(canonicalizeArxivId('https://arxiv.org/abs/2401.12345v2')).toBe('arxiv:2401.12345');
  });
  it('rejects bogus input', () => {
    expect(() => canonicalizeArxivId('foo')).toThrow();
  });
  it('builds abs/pdf URLs', () => {
    expect(arxivAbsUrl('arxiv:2401.12345')).toBe('https://arxiv.org/abs/2401.12345');
    expect(arxivPdfUrl('arxiv:2401.12345')).toBe('https://arxiv.org/pdf/2401.12345');
  });
});

describe('fetchArxivMetadata', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses title, authors, and abstract from arxiv Atom API', async () => {
    const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: id_list=2401.12345</title>
  <id>http://arxiv.org/api/query?id_list=2401.12345</id>
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id>
    <title>Attention Is All You
      Need Again</title>
    <summary>We revisit attention. The result is
      a 2-line abstract with whitespace.</summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Sample</name></author>
  </entry>
</feed>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(atom, { status: 200 })));

    const meta = await fetchArxivMetadata('arxiv:2401.12345');

    expect(meta.id).toBe('arxiv:2401.12345');
    expect(meta.title).toBe('Attention Is All You Need Again');
    expect(meta.authors).toEqual(['Alice Example', 'Bob Sample']);
    expect(meta.abstract).toBe('We revisit attention. The result is a 2-line abstract with whitespace.');
    expect(meta.abs_url).toBe('https://arxiv.org/abs/2401.12345');
    expect(meta.pdf_url).toBe('https://arxiv.org/pdf/2401.12345');
  });

  it('decodes XML entities in title and abstract', async () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>A &amp; B &lt;in&gt; &quot;C&quot;</title>
    <summary>x &amp; y</summary>
    <author><name>X</name></author>
  </entry>
</feed>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(atom, { status: 200 })));

    const meta = await fetchArxivMetadata('arxiv:2401.00001');
    expect(meta.title).toBe('A & B <in> "C"');
    expect(meta.abstract).toBe('x & y');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    await expect(fetchArxivMetadata('arxiv:9999.99999')).rejects.toThrow(/arxiv api/i);
  });

  it('throws when entry is missing', async () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(atom, { status: 200 })));
    await expect(fetchArxivMetadata('arxiv:2401.12345')).rejects.toThrow(/no entry/i);
  });
});
