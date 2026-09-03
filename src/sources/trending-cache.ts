import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveResearcherHome } from '../paths.js';
import type { PapersItem } from './papers-radar.js';

/** Daily radar list. Layout: <RESEARCHER_HOME>/cache/trending/YYYY-MM-DD.json */

export function trendingCacheDir(): string {
  return join(resolveResearcherHome(), 'cache', 'trending');
}

export function trendingDay(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type Envelope = { day: string; papers: PapersItem[] };

export function readTrendingDayCache(day = trendingDay()): PapersItem[] | undefined {
  const p = join(trendingCacheDir(), `${day}.json`);
  if (!existsSync(p)) return undefined;
  try {
    const env = JSON.parse(readFileSync(p, 'utf8')) as Envelope;
    if (env.day !== day || !Array.isArray(env.papers) || env.papers.length === 0) return undefined;
    return env.papers;
  } catch {
    return undefined;
  }
}

export function writeTrendingDayCache(papers: PapersItem[], day = trendingDay()): void {
  if (papers.length === 0) return;
  const dir = trendingCacheDir();
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${day}.json`);
  const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ day, papers }));
  renameSync(tmp, finalPath);
}
