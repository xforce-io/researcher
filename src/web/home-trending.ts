import { normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import { fetchTrendingPapers, type PapersItem } from '../sources/papers-radar.js';
import { readTrendingDayCache, trendingDay, writeTrendingDayCache } from '../sources/trending-cache.js';

export const HOME_TRENDING_CAP = 5;
export const HOME_TRENDING_FETCH_LIMIT = 10;
/** Whole-load budget for GET /trending. Live Node HF is ~11s; 3s hid the panel. */
export const HOME_TRENDING_TIMEOUT_MS = 15_000;

export interface HomeTrendingItem {
  paperId: string;
  input: string;
  title: string;
  heatIndex: number;
  heatLevel: number;
  blurb: string;
  upvotes?: number;
}

export interface HomeTrendingPage {
  items: HomeTrendingItem[];
  nextOffset: number;
  total: number;
}

export type HomeTrendingLoader = () => Promise<PapersItem[]>;

export function trendingBlurb(item: PapersItem): string {
  const raw = (item.ai_summary || item.abstract || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;
}

export function selectHomeTrending(
  items: PapersItem[],
  libraryPaperIds: Set<string>,
  cap = HOME_TRENDING_CAP,
  offset = 0,
): HomeTrendingItem[] {
  return pageHomeTrending(items, libraryPaperIds, cap, offset).items;
}

export function pageHomeTrending(
  items: PapersItem[],
  libraryPaperIds: Set<string>,
  cap = HOME_TRENDING_CAP,
  offset = 0,
): HomeTrendingPage {
  const all: HomeTrendingItem[] = [];
  for (const item of items) {
    const paperId = paperIdForSource(normalizePaperInput(item.paper_id));
    if (libraryPaperIds.has(paperId)) continue;
    all.push({
      paperId,
      input: item.id,
      title: item.title,
      heatIndex: item.heat_index,
      heatLevel: item.heat_level,
      blurb: trendingBlurb(item),
      upvotes: item.upvotes,
    });
  }
  if (all.length === 0) return { items: [], nextOffset: 0, total: 0 };
  const start = ((offset % all.length) + all.length) % all.length;
  const page: HomeTrendingItem[] = [];
  for (let i = 0; i < Math.min(cap, all.length); i++) {
    page.push(all[(start + i) % all.length]);
  }
  return { items: page, nextOffset: (start + page.length) % all.length, total: all.length };
}

export function libraryPaperIdSet(root: string): Set<string> {
  return new Set(new PaperLibrary(root).listPapers().map((p) => p.id));
}

export async function loadHomeTrending(opts: {
  root: string;
  loader?: HomeTrendingLoader;
  timeoutMs?: number;
  offset?: number;
}): Promise<HomeTrendingPage> {
  const budget = opts.timeoutMs ?? HOME_TRENDING_TIMEOUT_MS;
  try {
    const items = await withTimeout((opts.loader ?? defaultTrendingLoader)(), budget);
    return pageHomeTrending(
      items,
      libraryPaperIdSet(opts.root),
      items.length,
      0,
    );
  } catch {
    return { items: [], nextOffset: 0, total: 0 };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('home trending timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function defaultTrendingLoader(opts?: {
  fetch?: typeof fetch;
  now?: Date;
}): Promise<PapersItem[]> {
  const day = trendingDay(opts?.now);
  const hit = readTrendingDayCache(day);
  if (hit) return hit;
  const papers = await fetchTrendingPapers({
    limit: HOME_TRENDING_FETCH_LIMIT,
    fetch: opts?.fetch ?? fetchWithTimeout(HOME_TRENDING_TIMEOUT_MS),
  });
  writeTrendingDayCache(papers, day);
  return papers;
}

function fetchWithTimeout(ms: number): typeof fetch {
  return async (input, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
