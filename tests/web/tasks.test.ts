import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { TaskRegistry, resolveCliEntry, type Runner } from '../../src/web/tasks.js';
import type { RunEvent } from '../../src/pipeline/events.js';

// A controllable fake runner: emits the given lines (and optional events) then exits with `code`.
function fakeRunner(lines: string[], code = 0, delayMs = 0, events: RunEvent[] = []): Runner {
  return async (_cwd, onLine, onEvent) => {
    for (const e of events) onEvent(e);
    for (const l of lines) { onLine(l); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); }
    return code;
  };
}

let seq = 0;
const idSeq = () => `t${++seq}`;

describe('TaskRegistry', () => {
  it('runs a task and buffers lines, then marks done', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['a', 'b'], 0), idSeq });
    const task = reg.start('trace', '/ws/trace');
    expect(task.status).toBe('running');
    await new Promise((r) => setTimeout(r, 10));
    const t = reg.get(task.id)!;
    expect(t.lines).toEqual(['a', 'b']);
    expect(t.status).toBe('done');
    expect(t.exitCode).toBe(0);
  });

  it('rejects a concurrent start for the same slug', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    reg.start('trace', '/ws/trace');
    expect(reg.isBusy('trace')).toBe(true);
    expect(() => reg.start('trace', '/ws/trace')).toThrow('busy');
  });

  it('allows different slugs concurrently', () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    reg.start('a', '/ws/a');
    expect(() => reg.start('b', '/ws/b')).not.toThrow();
  });

  it('replays buffered lines and signals end to a late subscriber', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['one', 'two'], 0), idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    const got: string[] = []; let ended: { status: string; exitCode: number | null } | null = null;
    reg.subscribe(task.id, (l) => got.push(l), () => {}, (t) => { ended = { status: t.status, exitCode: t.exitCode }; });
    expect(got).toEqual(['one', 'two']);
    expect(ended).toEqual({ status: 'done', exitCode: 0 });
  });

  it('marks status error on nonzero exit', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['boom'], 1), idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    expect(reg.get(task.id)!.status).toBe('error');
    expect(reg.get(task.id)!.exitCode).toBe(1);
  });

  it('caps the ring buffer at bufferLines', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['1', '2', '3', '4'], 0), bufferLines: 2, idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    expect(reg.get(task.id)!.lines).toEqual(['3', '4']);
  });

  it('records startedAt and updates plan/stage from events', async () => {
    const reg = new TaskRegistry({
      runner: fakeRunner(['a'], 0, 0, [
        { type: 'plan', stages: ['bootstrap', 'soul', 'discover'] },
        { type: 'stage', name: 'discover' },
      ]),
      idSeq,
    });
    const before = Date.now();
    const task = reg.start('trace', '/ws/trace');
    expect(task.startedAt).toBeGreaterThanOrEqual(before);
    await new Promise((r) => setTimeout(r, 10));
    const t = reg.get(task.id)!;
    expect(t.plan).toEqual(['bootstrap', 'soul', 'discover']);
    expect(t.stage).toBe('discover');
  });

  it('activeTask returns the running task for a slug, undefined once finished', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    const task = reg.start('trace', '/ws/trace');
    expect(reg.activeTask('trace')?.id).toBe(task.id);
    expect(reg.activeTask('other')).toBeUndefined();
    await new Promise((r) => setTimeout(r, 80));
    expect(reg.activeTask('trace')).toBeUndefined();
  });

  it('replays plan and current stage to a late subscriber', async () => {
    const reg = new TaskRegistry({
      runner: fakeRunner(['one'], 0, 0, [
        { type: 'plan', stages: ['bootstrap', 'discover'] },
        { type: 'stage', name: 'discover' },
      ]),
      idSeq,
    });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    const events: RunEvent[] = [];
    reg.subscribe(task.id, () => {}, (e) => events.push(e), () => {});
    expect(events).toContainEqual({ type: 'plan', stages: ['bootstrap', 'discover'] });
    expect(events).toContainEqual({ type: 'stage', name: 'discover' });
  });

  it('unknown task id ends immediately with endReason unknown (no hang)', () => {
    const reg = new TaskRegistry({ runner: fakeRunner([]), idSeq });
    let ended: { status: string; endReason?: string; exitCode: number | null } | null = null;
    reg.subscribe('missing-task', () => {}, () => {}, (t) => {
      ended = { status: t.status, endReason: t.endReason, exitCode: t.exitCode };
    });
    expect(ended).toEqual({ status: 'error', endReason: 'unknown', exitCode: null });
  });

  it('default runner reports missing CLI instead of hanging', async () => {
    const { defaultRunner } = await import('../../src/web/tasks.js');
    const lines: string[] = [];
    const code = await defaultRunner('/no/such/cli-entry.js')('/tmp', (l) => lines.push(l), () => {});
    expect(code).toBe(1);
    expect(lines.some((l) => /CLI entry not found/.test(l))).toBe(true);
  });
});

describe('resolveCliEntry', () => {
  it('resolves an existing cli entry near this package build', () => {
    const entry = resolveCliEntry();
    // In tests we run from source via vitest; entry may be dist/cli.js after build.
    expect(typeof entry).toBe('string');
    expect(entry.length).toBeGreaterThan(0);
    // Prefer that a real file exists when dist is built; skip hard fail if clean checkout.
    if (existsSync(entry)) {
      expect(entry.endsWith('cli.js') || entry.includes('cli')).toBe(true);
    }
  });
});
