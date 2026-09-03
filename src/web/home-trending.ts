import { normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import { fetchTrendingPapers, type PapersItem } from '../sources/papers-radar.js';

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
}

export type HomeTrendingLoader = () => Promise<PapersItem[]>;

export function selectHomeTrending(
  items: PapersItem[],
  libraryPaperIds: Set<string>,
  cap = HOME_TRENDING_CAP,
): HomeTrendingItem[] {
  const out: HomeTrendingItem[] = [];
  for (const item of items) {
    const paperId = paperIdForSource(normalizePaperInput(item.paper_id));
    if (libraryPaperIds.has(paperId)) continue;
    out.push({
      paperId,
      input: item.id,
      title: item.title,
      heatIndex: item.heat_index,
      heatLevel: item.heat_level,
    });
    if (out.length >= cap) break;
  }
  return out;
}

export function libraryPaperIdSet(root: string): Set<string> {
  return new Set(new PaperLibrary(root).listPapers().map((p) => p.id));
}

export async function loadHomeTrending(opts: {
  root: string;
  loader?: HomeTrendingLoader;
  timeoutMs?: number;
}): Promise<HomeTrendingItem[]> {
  const budget = opts.timeoutMs ?? HOME_TRENDING_TIMEOUT_MS;
  try {
    const items = await withTimeout((opts.loader ?? defaultTrendingLoader)(), budget);
    return selectHomeTrending(items, libraryPaperIdSet(opts.root));
  } catch {
    return [];
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

export function defaultTrendingLoader(): Promise<PapersItem[]> {
  return fetchTrendingPapers({
    limit: HOME_TRENDING_FETCH_LIMIT,
    fetch: fetchWithTimeout(HOME_TRENDING_TIMEOUT_MS),
  });
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
