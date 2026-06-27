import { describe, it, expect } from 'vitest';
import { TaskRegistry, type Runner } from '../../src/web/tasks.js';

// A controllable fake runner: emits the given lines then exits with `code`.
function fakeRunner(lines: string[], code = 0, delayMs = 0): Runner {
  return async (_cwd, onLine) => {
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
    const got: string[] = []; let ended = false;
    reg.subscribe(task.id, (l) => got.push(l), () => { ended = true; });
    expect(got).toEqual(['one', 'two']);
    expect(ended).toBe(true);
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
});
