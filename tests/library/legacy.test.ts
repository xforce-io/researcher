import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverLegacyPendingNotes } from '../../src/library/legacy.js';

describe('legacy pending note discovery', () => {
  it('finds topic-local pending notes without mutating them', () => {
    const topic = mkdtempSync(join(tmpdir(), 'r-topic-'));
    mkdirSync(join(topic, 'notes/pending'), { recursive: true });
    mkdirSync(join(topic, 'notes/active'), { recursive: true });
    writeFileSync(join(topic, 'notes/pending/01_pending.md'), '# Pending');
    writeFileSync(join(topic, 'notes/pending/00_ignore.md'), '# Ignore');
    writeFileSync(join(topic, 'notes/active/02_active.md'), '# Active');

    const got = discoverLegacyPendingNotes(topic);

    expect(got).toEqual([
      { topicRoot: topic, relPath: 'notes/pending/01_pending.md', filename: '01_pending.md', num: 1 },
    ]);
    expect(existsSync(join(topic, 'notes/pending/01_pending.md'))).toBe(true);
    expect(existsSync(join(topic, 'notes/active/02_active.md'))).toBe(true);
  });
});
