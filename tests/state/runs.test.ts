import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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

describe('RunDir.recordAgentFailure', () => {
  it('writes <stage>.err containing exitCode, stderr, and the stdout tail', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runs-err-'));
    const rd = new RunDir(base, newRunId());
    const out = Array.from({ length: 80 }, (_, i) => `line${i}`).join('\n');
    const p = rd.recordAgentFailure('read', {
      output: out,
      modifiedFiles: [],
      exitCode: 1,
      stderr: 'the real failure reason',
    });
    expect(p).toBe(rd.path('read.err'));
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('exitCode: 1');
    expect(content).toContain('the real failure reason');
    expect(content).toContain('line79');        // stdout tail is present
    expect(content).not.toContain('line0\n');    // early stdout is truncated (tail only)
  });

  it('handles an empty stderr without crashing', () => {
    const base = mkdtempSync(join(tmpdir(), 'r-runs-err-'));
    const rd = new RunDir(base, newRunId());
    const p = rd.recordAgentFailure('synthesize', { output: '', modifiedFiles: [], exitCode: 2, stderr: '' });
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('exitCode: 2');
  });
});
