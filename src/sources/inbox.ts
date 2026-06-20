import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Reads digest files produced by the preprocessing layer (researcher-invest-feeds)
// from a repo-external inbox queue. This module is the code that the `x-inbox`
// source needs — unlike arxiv/rss, the data is local files, not agent-discovered.

export interface DigestMeta {
  source: string;
  fetchedAt: string;
  /** null on a first-ever fetch (empty cursor_from). */
  cursorFrom: string | null;
  cursorTo: string;
  count: number;
}

/** Parse the leading `---` frontmatter block of an inbox digest. */
export function parseDigestMeta(content: string): DigestMeta {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error('inbox digest has no frontmatter block');
  const fields: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const required = (k: string): string => {
    const v = fields[k];
    if (v === undefined) throw new Error(`inbox digest frontmatter missing ${k}`);
    return v;
  };
  return {
    source: required('source'),
    fetchedAt: required('fetched_at'),
    cursorFrom: fields.cursor_from ? fields.cursor_from : null,
    cursorTo: required('cursor_to'),
    count: parseInt(required('count'), 10),
  };
}

/** Stable id for a digest = its high-water mark, so consumption is idempotent. */
export function digestId(meta: DigestMeta): string {
  return `xfeed:${meta.cursorTo}`;
}

/**
 * Filesystem-safe slug derived from a digest's `source` field, used to name the
 * window note. The slug — not a hardcoded "x-following" — keeps the feed path
 * source-agnostic: any source (newsletter, slack, rss) flows through unchanged.
 */
export function digestSourceSlug(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'feed';
}

/** All digest markdown files, oldest-first (filenames are timestamp-keyed). */
export function listDigestFiles(inboxDir: string): string[] {
  if (!existsSync(inboxDir)) return [];
  return readdirSync(inboxDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

export interface PickedDigest {
  path: string;
  filename: string;
  content: string;
  id: string;
  meta: DigestMeta;
}

/** Oldest digest whose id is not yet consumed, or null. One per tick (mirrors arxiv's "deep-read one"). */
export function pickOldestUnconsumed(
  inboxDir: string,
  isConsumed: (id: string) => boolean,
): PickedDigest | null {
  for (const filename of listDigestFiles(inboxDir)) {
    const path = join(inboxDir, filename);
    const content = readFileSync(path, 'utf8');
    const meta = parseDigestMeta(content);
    const id = digestId(meta);
    if (!isConsumed(id)) return { path, filename, content, id, meta };
  }
  return null;
}
