import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDigestMeta,
  digestId,
  digestSourceSlug,
  listDigestFiles,
  pickOldestUnconsumed,
} from '../../src/sources/inbox.js';

const DIGEST = `---
source: x-following
fetched_at: 2026-06-19T11:05:00.000Z
cursor_from: 100
cursor_to: 200
count: 2
---

## @a · 2026-06-19T11:00:00.000Z · https://x.com/a/status/200
hello
metrics: 👁1 ❤2 🔁3
`;

describe('parseDigestMeta', () => {
  it('parses the frontmatter block', () => {
    const m = parseDigestMeta(DIGEST);
    expect(m).toEqual({
      source: 'x-following',
      fetchedAt: '2026-06-19T11:05:00.000Z',
      cursorFrom: '100',
      cursorTo: '200',
      count: 2,
    });
  });

  it('treats an empty cursor_from as null (first-ever fetch)', () => {
    const m = parseDigestMeta(DIGEST.replace('cursor_from: 100', 'cursor_from:'));
    expect(m.cursorFrom).toBeNull();
  });

  it('throws on a file with no frontmatter', () => {
    expect(() => parseDigestMeta('## just a tweet\nbody')).toThrow();
  });
});

describe('digestId', () => {
  it('keys the digest by its cursor_to (the new high-water mark)', () => {
    expect(digestId(parseDigestMeta(DIGEST))).toBe('xfeed:200');
  });
});

describe('digestSourceSlug', () => {
  it('keeps a clean source unchanged (the note name stays source-derived, not hardcoded)', () => {
    expect(digestSourceSlug('x-following')).toBe('x-following');
  });

  it('normalizes an arbitrary source into a filesystem-safe slug', () => {
    expect(digestSourceSlug('Substack Newsletter!')).toBe('substack-newsletter');
    expect(digestSourceSlug('  Slack #invest  ')).toBe('slack-invest');
  });

  it('falls back to "feed" when the source has no usable characters', () => {
    expect(digestSourceSlug('')).toBe('feed');
    expect(digestSourceSlug('---')).toBe('feed');
  });
});

describe('listDigestFiles / pickOldestUnconsumed', () => {
  let inbox: string;
  beforeEach(() => {
    inbox = mkdtempSync(join(tmpdir(), 'r-inbox-'));
  });

  const write = (name: string, cursorTo: string) =>
    writeFileSync(join(inbox, name), DIGEST.replace('cursor_to: 200', `cursor_to: ${cursorTo}`));

  it('lists *.md oldest-first by filename, ignoring non-md', () => {
    write('x-following-20260619T120000Z.md', '300');
    write('x-following-20260619T110000Z.md', '200');
    writeFileSync(join(inbox, 'notes.txt'), 'ignore me');
    expect(listDigestFiles(inbox)).toEqual([
      'x-following-20260619T110000Z.md',
      'x-following-20260619T120000Z.md',
    ]);
  });

  it('returns null for a missing or empty inbox', () => {
    expect(pickOldestUnconsumed(join(inbox, 'nope'), () => false)).toBeNull();
    expect(pickOldestUnconsumed(inbox, () => false)).toBeNull();
  });

  it('picks the oldest digest whose id is not yet consumed', () => {
    write('x-following-20260619T110000Z.md', '200');
    write('x-following-20260619T120000Z.md', '300');
    const consumed = new Set(['xfeed:200']);
    const pick = pickOldestUnconsumed(inbox, (id) => consumed.has(id));
    expect(pick).not.toBeNull();
    expect(pick!.id).toBe('xfeed:300');
    expect(pick!.filename).toBe('x-following-20260619T120000Z.md');
    expect(pick!.content).toContain('cursor_to: 300');
  });

  it('returns null when every digest is already consumed', () => {
    write('x-following-20260619T110000Z.md', '200');
    const pick = pickOldestUnconsumed(inbox, () => true);
    expect(pick).toBeNull();
  });
});
