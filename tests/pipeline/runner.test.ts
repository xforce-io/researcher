import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStages } from '../../src/pipeline/runner.js';
import { RunDir, newRunId } from '../../src/state/runs.js';

describe('runStages', () => {
  it('runs each stage and writes start/done markers', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    const calls: string[] = [];
    await runStages(rd, [
      { name: 'bootstrap', fn: async () => { calls.push('bootstrap'); } },
      { name: 'read',      fn: async () => { calls.push('read'); } },
    ] as const);
    expect(calls).toEqual(['bootstrap', 'read']);
    expect(existsSync(rd.path('bootstrap.done'))).toBe(true);
    expect(existsSync(rd.path('read.done'))).toBe(true);
  });
  it('halts on stage error and leaves .start without .done', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    await expect(runStages(rd, [
      { name: 'bootstrap', fn: async () => { throw new Error('boom'); } },
    ] as const)).rejects.toThrow('boom');
    expect(existsSync(rd.path('bootstrap.start'))).toBe(true);
    expect(existsSync(rd.path('bootstrap.done'))).toBe(false);
  });
});
