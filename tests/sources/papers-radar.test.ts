import { describe, it, expect } from 'vitest';
import {
  fetchTrendingPapers,
  searchPapers,
  showPaper,
  PapersRadarError,
  type PapersItem,
} from '../../src/sources/papers-radar.js';

const HF_DAILY = 'https://huggingface.co/api/daily_papers';
const HF_PAPER = 'https://huggingface.co/api/papers/';
const ARXIV = 'https://export.arxiv.org/api/query';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/xml' } });
}

const atomEntry = (id: string, title: string, summary: string, published = '2026-01-02T00:00:00Z') => `
<entry>
  <id>http://arxiv.org/abs/${id}v1</id>
  <title>${title}</title>
  <summary>${summary}</summary>
  <published>${published}</published>
  <author><name>Ada</name></author>
</entry>`;

const atomFeed = (...entries: string[]) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;

function requiredFields(item: PapersItem) {
  expect(item.id).toMatch(/^arxiv:\d{4}\.\d{4,5}$/);
  expect(item.paper_id).toMatch(/^\d{4}\.\d{4,5}$/);
  expect(item.title.length).toBeGreaterThan(0);
  expect(item.arxiv_url).toBe(`https://arxiv.org/abs/${item.paper_id}`);
  expect(item.pdf_url).toBe(`https://arxiv.org/pdf/${item.paper_id}`);
  expect(item.source === 'huggingface' || item.source === 'arxiv').toBe(true);
  expect(typeof item.abstract).toBe('string');
  expect(typeof item.published_date).toBe('string');
  expect(item.heat_index).toBeGreaterThanOrEqual(0);
  expect(item.heat_index).toBeLessThanOrEqual(100);
  expect(item.heat_level).toBeGreaterThanOrEqual(1);
  expect(item.heat_level).toBeLessThanOrEqual(5);
}

describe('fetchTrendingPapers', () => {
  it('maps HuggingFace daily papers to the JSON contract and caps limit', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain(HF_DAILY);
      expect(url).toContain('limit=2');
      return jsonResponse([
        {
          paper: {
            id: '2401.00001',
            title: 'High Heat',
            authors: [{ name: 'A' }, { name: 'B' }],
            summary: 'Full abstract one that is longer than five hundred characters. '.repeat(20),
            publishedAt: '2026-01-15T12:00:00.000Z',
            upvotes: 80,
            ai_summary: 'AI one',
            ai_keywords: ['LLM', 'agents'],
          },
          githubRepo: { url: 'https://github.com/x/y', stars: 500 },
        },
        {
          paper: {
            id: '2401.00002',
            title: 'Low Heat',
            authors: [{ name: 'C' }],
            summary: 'Short abstract.',
            publishedAt: '2020-01-01T00:00:00.000Z',
            upvotes: 0,
          },
        },
        {
          paper: {
            id: '2401.00003',
            title: 'Dropped by limit',
            summary: 'x',
            publishedAt: '2026-01-01T00:00:00.000Z',
            upvotes: 1,
          },
        },
      ]);
    };

    const papers = await fetchTrendingPapers({ limit: 2, source: 'huggingface', fetch: fetchImpl });
    expect(papers).toHaveLength(2);
    papers.forEach(requiredFields);
    expect(papers[0].paper_id).toBe('2401.00001');
    expect(papers[0].id).toBe('arxiv:2401.00001');
    expect(papers[0].authors).toEqual(['A', 'B']);
    expect(papers[0].abstract.length).toBeGreaterThan(500);
    expect(papers[0].upvotes).toBe(80);
    expect(papers[0].hf_url).toBe('https://huggingface.co/papers/2401.00001');
    expect(papers[0].github_repo).toBe('https://github.com/x/y');
    expect(papers[0].github_stars).toBe(500);
    expect(papers[0].ai_summary).toBe('AI one');
    expect(papers[0].ai_keywords).toEqual(['LLM', 'agents']);
    expect(papers[0].source).toBe('huggingface');
    expect(papers[0].heat_index).toBeGreaterThan(papers[1].heat_index);
  });

  it('falls back to arXiv when HuggingFace fails', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('huggingface.co')) return jsonResponse({ error: 'nope' }, 502);
      expect(url).toContain(ARXIV);
      expect(url).toMatch(/cat(:|%3A)cs\.AI/);
      return textResponse(atomFeed(atomEntry('2401.55555', 'Arxiv Only', 'From arxiv.')));
    };
    const papers = await fetchTrendingPapers({ limit: 5, source: 'huggingface', fetch: fetchImpl });
    expect(papers).toHaveLength(1);
    expect(papers[0].paper_id).toBe('2401.55555');
    expect(papers[0].source).toBe('arxiv');
    expect(papers[0].abstract).toContain('From arxiv');
    requiredFields(papers[0]);
  });

  it('throws when every source fails', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({}, 500);
    await expect(fetchTrendingPapers({ fetch: fetchImpl })).rejects.toBeInstanceOf(PapersRadarError);
  });
});

describe('searchPapers', () => {
  it('searches arXiv by title and returns contract items', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain(ARXIV);
      expect(url).toContain(encodeURIComponent('ti:"SkillCraft"'));
      return textResponse(atomFeed(atomEntry('2501.00009', 'SkillCraft Rocks', 'A paper about SkillCraft.')));
    };
    const papers = await searchPapers({ query: 'SkillCraft', limit: 5, fetch: fetchImpl });
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe('SkillCraft Rocks');
    requiredFields(papers[0]);
  });

  it('throws on no hits', async () => {
    const fetchImpl: typeof fetch = async () => textResponse(atomFeed());
    await expect(searchPapers({ query: 'zzzz-no-such', fetch: fetchImpl })).rejects.toBeInstanceOf(PapersRadarError);
  });
});

describe('showPaper', () => {
  it('prefers HuggingFace paper API then falls back to arXiv', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes(HF_PAPER + '2401.12345')) {
        return jsonResponse({
          id: '2401.12345',
          title: 'From HF',
          authors: [{ name: 'Zed' }],
          summary: 'HF abstract',
          publishedAt: '2026-03-01T00:00:00.000Z',
          upvotes: 3,
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const papers = await showPaper({ arxivId: '2401.12345', fetch: fetchImpl });
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe('From HF');
    expect(papers[0].authors).toEqual(['Zed']);
    requiredFields(papers[0]);
  });

  it('falls back to arXiv id_list when HuggingFace misses', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('huggingface.co')) return jsonResponse({}, 404);
      expect(url).toContain('id_list=2401.12345');
      return textResponse(atomFeed(atomEntry('2401.12345', 'From Arxiv', 'Abs')));
    };
    const papers = await showPaper({ arxivId: 'https://arxiv.org/abs/2401.12345v2', fetch: fetchImpl });
    expect(papers[0].title).toBe('From Arxiv');
    expect(papers[0].source).toBe('arxiv');
  });

  it('throws when the id is unknown', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({}, 404);
    await expect(showPaper({ arxivId: '2401.00000', fetch: fetchImpl })).rejects.toBeInstanceOf(PapersRadarError);
  });
});
