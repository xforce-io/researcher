import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatermark, writeWatermark } from '../../src/state/watermark.js';

describe('watermark', () => {
  it('returns null when file is absent', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'r-wm-')), 'watermark.json');
    expect(readWatermark(p)).toBeNull();
  });
  it('round-trips a value', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'r-wm-')), 'watermark.json');
    const w = { last_run_completed_at: '2026-04-26T00:00:00Z', last_run_window: { from: '2026-04-19T00:00:00Z', to: '2026-04-26T00:00:00Z' }, last_run_id: 'r-abc' };
    writeWatermark(p, w);
    expect(readWatermark(p)).toEqual(w);
  });
});
