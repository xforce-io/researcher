import { execa } from 'execa';

export type Runner = (cwd: string, onLine: (line: string) => void) => Promise<number>;

export interface RunTask {
  id: string;
  slug: string;
  lines: string[];
  status: 'running' | 'done' | 'error';
  exitCode: number | null;
}

interface Listener { onLine: (line: string) => void; onEnd: (t: RunTask) => void; }

let globalSeq = 0;
const defaultIdSeq = () => `task-${++globalSeq}`;

/** Default runner: spawn this CLI's `run` as a subprocess and stream stdout lines. */
export function defaultRunner(cliEntry: string): Runner {
  return async (cwd, onLine) => {
    const child = execa(process.execPath, [cliEntry, 'run'], { cwd, all: true, reject: false });
    let buf = '';
    child.all?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    const res = await child;
    if (buf.length) onLine(buf);
    return res.exitCode ?? 0;
  };
}

export class TaskRegistry {
  private readonly runner: Runner;
  private readonly bufferLines: number;
  private readonly idSeq: () => string;
  private readonly tasks = new Map<string, RunTask>();
  private readonly busy = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(opts?: { runner?: Runner; bufferLines?: number; idSeq?: () => string }) {
    this.runner = opts?.runner ?? defaultRunner(process.argv[1] ?? '');
    this.bufferLines = opts?.bufferLines ?? 2000;
    this.idSeq = opts?.idSeq ?? defaultIdSeq;
  }

  isBusy(slug: string): boolean {
    return this.busy.has(slug);
  }

  start(slug: string, cwd: string): RunTask {
    if (this.isBusy(slug)) throw new Error('busy');
    const task: RunTask = { id: this.idSeq(), slug, lines: [], status: 'running', exitCode: null };
    this.tasks.set(task.id, task);
    this.busy.add(slug);
    this.listeners.set(task.id, new Set());

    const onLine = (line: string) => {
      task.lines.push(line);
      if (task.lines.length > this.bufferLines) task.lines.shift();
      for (const l of this.listeners.get(task.id) ?? []) l.onLine(line);
    };
    this.runner(cwd, onLine)
      .then((code) => this.finish(task, code))
      .catch(() => this.finish(task, 1));
    return task;
  }

  private finish(task: RunTask, code: number): void {
    task.exitCode = code;
    task.status = code === 0 ? 'done' : 'error';
    this.busy.delete(task.slug);
    for (const l of this.listeners.get(task.id) ?? []) l.onEnd(task);
  }

  get(id: string): RunTask | undefined {
    return this.tasks.get(id);
  }

  subscribe(id: string, onLine: (line: string) => void, onEnd: (t: RunTask) => void): () => void {
    const task = this.tasks.get(id);
    if (!task) return () => {};
    for (const l of task.lines) onLine(l);              // replay buffer
    if (task.status !== 'running') { onEnd(task); return () => {}; }
    const listener: Listener = { onLine, onEnd };
    this.listeners.get(id)!.add(listener);
    return () => this.listeners.get(id)?.delete(listener);
  }
}
