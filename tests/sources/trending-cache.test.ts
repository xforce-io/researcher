import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readTrendingDayCache,
  trendingCacheDir,
  trendingDay,
  writeTrendingDayCache,
} from '../../src/sources/trending-cache.js';
import { defaultTrendingLoader } from '../../src/web/home-trending.js';
import type { PapersItem } from '../../src/sources/papers-radar.js';

function sample(id: string, title: string): PapersItem {
  return {
    id: `arxiv:${id}`,
    paper_id: id,
    title,
    authors: [],
    abstract: `${title} abstract`,
    arxiv_url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}`,
    source: 'arxiv',
    published_date: '2026-09-03',
    heat_index: 35,
    heat_level: 2,
  };
}

describe('trending day cache', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'r-trend-cache-'));
    process.env.RESEARCHER_HOME = home;
  });

  afterEach(() => {
    delete process.env.RESEARCHER_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('puts the daily file under <RESEARCHER_HOME>/cache/trending', () => {
    expect(trendingCacheDir()).toBe(join(home, 'cache', 'trending'));
    expect(trendingDay(new Date('2026-09-03T15:00:00'))).toBe('2026-09-03');
  });

  it('round-trips a non-empty list for that calendar day', () => {
    const papers = [sample('2609.00001', 'Cached paper')];
    writeTrendingDayCache(papers, '2026-09-03');
    expect(readTrendingDayCache('2026-09-03')).toEqual(papers);
    expect(JSON.parse(readFileSync(join(home, 'cache', 'trending', '2026-09-03.json'), 'utf8')).day)
      .toBe('2026-09-03');
    expect(readTrendingDayCache('2026-09-04')).toBeUndefined();
  });

  it('does not write an empty list', () => {
    writeTrendingDayCache([], '2026-09-03');
    expect(readTrendingDayCache('2026-09-03')).toBeUndefined();
  });

  it('reuses the daily cache and does not hit the network', async () => {
    writeTrendingDayCache([sample('2609.00001', 'From disk')], '2026-09-03');
    const papers = await defaultTrendingLoader({
      now: new Date('2026-09-03T18:00:00'),
      fetch: async () => { throw new Error('network should not run'); },
    });
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe('From disk');
  });
});
