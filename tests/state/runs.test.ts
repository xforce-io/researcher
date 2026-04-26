import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newRunId, RunDir } from '../../src/state/runs.js';

describe('runs', () => {
  it('newRunId is unique-ish', () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^r-/);
  });
  it('RunDir creates start/done markers', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runs-'));
    const id = newRunId();
    const rd = new RunDir(base, id);
    rd.markStart('bootstrap');
    expect(existsSync(rd.path('bootstrap.start'))).toBe(true);
    expect(rd.isDone('bootstrap')).toBe(false);
    rd.markDone('bootstrap');
    expect(rd.isDone('bootstrap')).toBe(true);
  });
});
