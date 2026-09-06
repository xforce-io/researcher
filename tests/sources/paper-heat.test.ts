import { describe, it, expect } from 'vitest';
import { calculateHeatIndex, calculateHeatLevel, hasCommunityHeat } from '../../src/sources/paper-heat.js';

describe('hasCommunityHeat', () => {
  it('is false when upvotes and stars are missing or zero', () => {
    expect(hasCommunityHeat({})).toBe(false);
    expect(hasCommunityHeat({ upvotes: 0 })).toBe(false);
    expect(hasCommunityHeat({ github_stars: 0 })).toBe(false);
    expect(hasCommunityHeat({ upvotes: 0, github_stars: 0 })).toBe(false);
  });

  it('is true when upvotes or stars are positive', () => {
    expect(hasCommunityHeat({ upvotes: 1 })).toBe(true);
    expect(hasCommunityHeat({ github_stars: 4 })).toBe(true);
    expect(hasCommunityHeat({ upvotes: 0, github_stars: 4 })).toBe(true);
  });
});

describe('calculateHeatIndex', () => {
  it('scores huggingface source with no other signals as 35', () => {
    // source +10, missing date +25
    expect(calculateHeatIndex({ source: 'huggingface' })).toBe(35);
  });

  it('scores arxiv source with no other signals as 30', () => {
    expect(calculateHeatIndex({ source: 'arxiv' })).toBe(30);
  });

  it('adds upvote and star contributions with freshness and caps at 100', () => {
    const score = calculateHeatIndex({
      source: 'huggingface',
      upvotes: 142,
      github_stars: 1200,
      published_date: '2099-01-01',
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(80);
  });

  it('applies freshness buckets', () => {
    const iso = (daysAgo: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const base = { source: 'arxiv' as const };
    expect(calculateHeatIndex({ ...base, published_date: iso(0) })).toBe(5 + 30);
    expect(calculateHeatIndex({ ...base, published_date: iso(2) })).toBe(5 + 25);
    expect(calculateHeatIndex({ ...base, published_date: iso(6) })).toBe(5 + 20);
    expect(calculateHeatIndex({ ...base, published_date: iso(10) })).toBe(5 + 10);
    expect(calculateHeatIndex({ ...base, published_date: iso(30) })).toBe(5 + 5);
  });
});

describe('calculateHeatLevel', () => {
  it('maps heat_index bands to 1–5', () => {
    expect(calculateHeatLevel(0)).toBe(1);
    expect(calculateHeatLevel(19)).toBe(1);
    expect(calculateHeatLevel(20)).toBe(2);
    expect(calculateHeatLevel(40)).toBe(3);
    expect(calculateHeatLevel(60)).toBe(4);
    expect(calculateHeatLevel(80)).toBe(5);
  });
});
