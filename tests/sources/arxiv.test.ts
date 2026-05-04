import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeArxivId, arxivAbsUrl, arxivPdfUrl, fetchArxivMetadata } from '../../src/sources/arxiv.js';
import { writeJsonCache } from '../../src/sources/cache.js';

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
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-arxiv-'));
    process.env.RESEARCHER_HOME = home;
  });
  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

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

  it('retries on transient 5xx and succeeds when the next attempt returns ok', async () => {
    vi.useFakeTimers();
    try {
      const ok = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2604.17658v1</id>
    <title>Towards Self-Improving Error Diagnosis</title>
    <summary>abstract</summary>
    <author><name>X</name></author>
  </entry>
</feed>`;
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        calls++;
        if (calls < 3) return new Response('Service Unavailable', { status: 503 });
        return new Response(ok, { status: 200 });
      }));

      const promise = fetchArxivMetadata('arxiv:2604.17658');
      await vi.runAllTimersAsync();
      const meta = await promise;
      expect(meta.title).toBe('Towards Self-Improving Error Diagnosis');
      expect(calls).toBe(3); // two retries before success
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the retry budget is exhausted on persistent 5xx', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream', { status: 503 })));
      const promise = fetchArxivMetadata('arxiv:2604.17658');
      promise.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/arxiv api 503/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry on 4xx (no point — the id is wrong)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('not found', { status: 404 });
    }));
    await expect(fetchArxivMetadata('arxiv:9999.99999')).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('throws when entry is missing', async () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(atom, { status: 200 })));
    await expect(fetchArxivMetadata('arxiv:2401.12345')).rejects.toThrow(/no entry/i);
  });
});

describe('fetchArxivMetadata 429 backoff', () => {
  let home: string;
  beforeEach(() => {
    vi.useFakeTimers();
    home = mkdtempSync(join(tmpdir(), 'r-arxiv-429-'));
    process.env.RESEARCHER_HOME = home;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.RESEARCHER_HOME;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const ok = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2602.02475v1</id>
    <title>Sample</title>
    <summary>abstract</summary>
    <author><name>X</name></author>
  </entry>
</feed>`;

  it('retries on 429 and succeeds on later attempt', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls < 4) return new Response('rate limited', { status: 429 });
      return new Response(ok, { status: 200 });
    }));

    const promise = fetchArxivMetadata('arxiv:2602.02475');
    await vi.runAllTimersAsync();
    const meta = await promise;
    expect(meta.title).toBe('Sample');
    expect(calls).toBe(4);
  });

  it('honors Retry-After header (seconds form)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '7' },
        });
      }
      return new Response(ok, { status: 200 });
    }));

    const promise = fetchArxivMetadata('arxiv:2602.02475');
    await vi.advanceTimersByTimeAsync(6_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    await promise;
    expect(calls).toBe(2);
  });

  it('gives up after exhausting the 429 retry budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const promise = fetchArxivMetadata('arxiv:2602.02475');
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/arxiv api 429/i);
  });
});

describe('fetchArxivMetadata cache', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-arxiv-cache-'));
    process.env.RESEARCHER_HOME = home;
  });

  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns cached metadata without calling fetch', async () => {
    writeJsonCache('2401.12345', {
      id: 'arxiv:2401.12345',
      title: 'Cached Title',
      authors: ['A', 'B'],
      abstract: 'cached abstract',
      abs_url: 'https://arxiv.org/abs/2401.12345',
      pdf_url: 'https://arxiv.org/pdf/2401.12345',
    });
    const fetchMock = vi.fn(async () => new Response('should not happen', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const meta = await fetchArxivMetadata('arxiv:2401.12345');
    expect(meta.title).toBe('Cached Title');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes cache on a fresh fetch', async () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.99999v1</id>
    <title>Fresh Paper</title>
    <summary>fresh abstract</summary>
    <author><name>Z</name></author>
  </entry>
</feed>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(atom, { status: 200 })));

    await fetchArxivMetadata('arxiv:2401.99999');

    // Second call should not hit fetch — cache is warm.
    const fetchSpy = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const meta = await fetchArxivMetadata('arxiv:2401.99999');
    expect(meta.title).toBe('Fresh Paper');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
