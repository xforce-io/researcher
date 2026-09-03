import { describe, expect, it } from 'vitest';
import type { PapersItem } from '../../src/sources/papers-radar.js';
import { paperIdForSource, normalizePaperInput } from '../../src/library/identity.js';
import { HOME_TRENDING_CAP, loadHomeTrending, selectHomeTrending } from '../../src/web/home-trending.js';

function item(paperId: string, title: string, heat: number, abstract = `${title} abstract.`): PapersItem {
  return {
    id: `arxiv:${paperId}`,
    paper_id: paperId,
    title,
    authors: [],
    abstract,
    arxiv_url: `https://arxiv.org/abs/${paperId}`,
    pdf_url: `https://arxiv.org/pdf/${paperId}`,
    source: 'arxiv',
    published_date: '2026-09-01',
    heat_index: heat,
    heat_level: 4,
  };
}

describe('selectHomeTrending', () => {
  it('keeps at most 5 not-in-library papers with title and heat', () => {
    const items = [10, 20, 30, 40, 50, 60, 70].map((n) =>
      item(`2609.0000${n}`, `Paper ${n}`, n),
    );
    const selected = selectHomeTrending(items, new Set());
    expect(HOME_TRENDING_CAP).toBe(5);
    expect(selected).toHaveLength(5);
    expect(selected.map((s) => s.title)).toEqual([
      'Paper 10', 'Paper 20', 'Paper 30', 'Paper 40', 'Paper 50',
    ]);
    expect(selected[0]).toEqual(expect.objectContaining({
      title: 'Paper 10',
      heatIndex: 10,
      blurb: 'Paper 10 abstract.',
      input: 'arxiv:2609.000010',
      paperId: paperIdForSource(normalizePaperInput('2609.000010')),
    }));
  });

  it('pages past the first five with offset', () => {
    const items = [10, 20, 30, 40, 50, 60, 70].map((n) =>
      item(`2609.0000${n}`, `Paper ${n}`, n),
    );
    expect(selectHomeTrending(items, new Set(), 5, 5).map((s) => s.title)).toEqual([
      'Paper 60', 'Paper 70', 'Paper 10', 'Paper 20', 'Paper 30',
    ]);
  });

  it('omits papers already in the Library', () => {
    const keep = item('2609.11111', 'Keep me', 90);
    const skip = item('2609.22222', 'Already in', 99);
    const inLibrary = new Set([paperIdForSource(normalizePaperInput(skip.paper_id))]);
    const selected = selectHomeTrending([skip, keep], inLibrary);
    expect(selected).toHaveLength(1);
    expect(selected[0].title).toBe('Keep me');
  });

  it('returns empty when every hit is already in Library or the source is empty', () => {
    const skip = item('2609.22222', 'Already in', 99);
    const inLibrary = new Set([paperIdForSource(normalizePaperInput(skip.paper_id))]);
    expect(selectHomeTrending([skip], inLibrary)).toEqual([]);
    expect(selectHomeTrending([], new Set())).toEqual([]);
  });
});

describe('loadHomeTrending', () => {
  it('returns an empty list when the loader throws', async () => {
    const rows = await loadHomeTrending({
      root: '/tmp/researcher-home-trending-missing',
      loader: async () => { throw new Error('huggingface down'); },
    });
    expect(rows).toEqual({ items: [], nextOffset: 0 });
  });

  it('returns an empty list when the loader exceeds the home budget', async () => {
    const rows = await loadHomeTrending({
      root: '/tmp/researcher-home-trending-timeout',
      timeoutMs: 20,
      loader: () => new Promise(() => {}),
    });
    expect(rows).toEqual({ items: [], nextOffset: 0 });
  });
});
