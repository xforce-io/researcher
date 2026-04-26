import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Seen } from '../../src/state/seen.js';

describe('Seen', () => {
  let p: string;
  beforeEach(() => {
    p = join(mkdtempSync(join(tmpdir(), 'r-seen-')), 'seen.jsonl');
  });
  it('creates empty when file does not exist', () => {
    const s = new Seen(p);
    expect(s.has('arxiv:2401.00001')).toBe(false);
  });
  it('appends and persists across instances', () => {
    const s1 = new Seen(p);
    s1.append({ id: 'arxiv:2401.00001', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'matches RQ1' });
    expect(s1.has('arxiv:2401.00001')).toBe(true);
    const s2 = new Seen(p);
    expect(s2.has('arxiv:2401.00001')).toBe(true);
    expect(s2.get('arxiv:2401.00001')?.decision).toBe('deep-read');
  });
  it('refuses duplicate id', () => {
    const s = new Seen(p);
    s.append({ id: 'a', source: 'arxiv', first_seen_run: 'r1', decision: 'reject', reason: 'x' });
    expect(() =>
      s.append({ id: 'a', source: 'arxiv', first_seen_run: 'r2', decision: 'reject', reason: 'y' }),
    ).toThrow();
  });
});
