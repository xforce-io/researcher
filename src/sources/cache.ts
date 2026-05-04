import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveResearcherHome } from '../paths.js';

// Per-machine cache for arxiv artifacts (metadata + extracted text).
// Layout: <RESEARCHER_HOME>/cache/arxiv/<bareId>.<ext>
//   <bareId>.meta.json — parsed ArxivMetadata
//   <bareId>.txt       — pdftotext output
//
// arxiv content at a given canonical id is effectively immutable, so we cache
// indefinitely. To force a refetch, delete the file or the cache dir.

export function arxivCacheDir(): string {
  return join(resolveResearcherHome(), 'cache', 'arxiv');
}

function pathFor(bareId: string, ext: string): string {
  return join(arxivCacheDir(), `${bareId}.${ext}`);
}

export function readJsonCache<T>(bareId: string, ext = 'meta.json'): T | undefined {
  const p = pathFor(bareId, ext);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return undefined; // Corrupt cache entry — treat as miss.
  }
}

export function writeJsonCache<T>(bareId: string, value: T, ext = 'meta.json'): void {
  writeAtomic(pathFor(bareId, ext), JSON.stringify(value));
}

export function readTextCache(bareId: string, ext = 'txt'): string | undefined {
  const p = pathFor(bareId, ext);
  if (!existsSync(p)) return undefined;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

export function writeTextCache(bareId: string, content: string, ext = 'txt'): void {
  writeAtomic(pathFor(bareId, ext), content);
}

function writeAtomic(finalPath: string, content: string): void {
  mkdirSync(arxivCacheDir(), { recursive: true });
  const tmp = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, finalPath);
}
