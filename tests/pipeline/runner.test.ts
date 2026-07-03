import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStages, assertAgentOk } from '../../src/pipeline/runner.js';
import { RunDir, newRunId } from '../../src/state/runs.js';
import { RUN_IPC_ENV } from '../../src/pipeline/events.js';

describe('runStages', () => {
  let _origSend: typeof process.send;
  let _origRunIpc: string | undefined;
  beforeEach(() => {
    _origSend = process.send;
    _origRunIpc = process.env[RUN_IPC_ENV];
    (process as { send?: unknown }).send = undefined;
    delete process.env[RUN_IPC_ENV];
  });
  afterEach(() => {
    (process as { send?: unknown }).send = _origSend;
    if (_origRunIpc === undefined) delete process.env[RUN_IPC_ENV];
    else process.env[RUN_IPC_ENV] = _origRunIpc;
  });

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

  it('emits a {type:"stage"} event for each stage via process.send', async () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runner-'));
    const rd = new RunDir(base, newRunId());
    const sent: unknown[] = [];
    const orig = process.send;
    process.env[RUN_IPC_ENV] = '1';
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m); return true; };
    try {
      await runStages(rd, [
        { name: 'bootstrap', fn: async () => {} },
        { name: 'discover', fn: async () => {} },
      ] as const);
    } finally {
      (process as { send?: unknown }).send = orig;
    }
    expect(sent).toEqual([
      { type: 'stage', name: 'bootstrap' },
      { type: 'stage', name: 'discover' },
    ]);
  });
});

describe('assertAgentOk', () => {
  it('throws and persists <stage>.err when exitCode != 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-assert-'));
    const rd = new RunDir(base, newRunId());
    expect(() =>
      assertAgentOk(rd, 'read', { output: 'o', modifiedFiles: [], exitCode: 1, stderr: 'detail' }),
    ).toThrow(/read stage agent exited 1.*read\.err/s);
    expect(existsSync(rd.path('read.err'))).toBe(true);
  });

  it('is a no-op (no throw, no .err file) when exitCode is 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-assert-'));
    const rd = new RunDir(base, newRunId());
    expect(() =>
      assertAgentOk(rd, 'read', { output: 'o', modifiedFiles: [], exitCode: 0, stderr: '' }),
    ).not.toThrow();
    expect(existsSync(rd.path('read.err'))).toBe(false);
  });
});
