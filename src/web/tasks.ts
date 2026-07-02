import { fork } from 'node:child_process';
import type { RunEvent } from '../pipeline/events.js';
import type { Stage } from '../state/runs.js';

export type Runner = (
  cwd: string,
  onLine: (line: string) => void,
  onEvent: (ev: RunEvent) => void,
) => Promise<number>;

export type TaskJob = (
  onLine: (line: string) => void,
  onEvent: (ev: RunEvent) => void,
) => Promise<number>;

export interface RunTask {
  id: string;
  slug: string;
  lines: string[];
  status: 'running' | 'done' | 'error';
  exitCode: number | null;
  startedAt: number;
  plan: Stage[] | null;
  stage: Stage | null;
}

interface Listener {
  onLine: (line: string) => void;
  onEvent: (ev: RunEvent) => void;
  onEnd: (t: RunTask) => void;
}

let globalSeq = 0;
const defaultIdSeq = () => `task-${++globalSeq}`;

/**
 * Default runner: fork this CLI's `run` as a child process. stdout+stderr are
 * piped and split into log lines; structured stage/plan events arrive over the
 * Node IPC channel (the child calls process.send) — kept off stdout so the two
 * never collide and need no ordering guarantee.
 */
export function defaultRunner(cliEntry: string): Runner {
  return (cwd, onLine, onEvent) =>
    new Promise<number>((resolve) => {
      const child = fork(cliEntry, ['run'], { cwd, silent: true });
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('message', (msg) => onEvent(msg as RunEvent));
      child.on('exit', (code) => { if (buf.length) onLine(buf); resolve(code ?? 0); });
      child.on('error', () => { if (buf.length) onLine(buf); resolve(1); });
    });
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

  /** The running task for a slug, if any — used to reconnect after a page refresh. */
  activeTask(slug: string): RunTask | undefined {
    for (const t of this.tasks.values()) {
      if (t.slug === slug && t.status === 'running') return t;
    }
    return undefined;
  }

  start(slug: string, cwd: string): RunTask {
    return this.startJob(slug, (onLine, onEvent) => this.runner(cwd, onLine, onEvent));
  }

  startJob(slug: string, job: TaskJob): RunTask {
    if (this.isBusy(slug)) throw new Error('busy');
    const task: RunTask = {
      id: this.idSeq(), slug, lines: [], status: 'running', exitCode: null,
      startedAt: Date.now(), plan: null, stage: null,
    };
    this.tasks.set(task.id, task);
    this.busy.add(slug);
    this.listeners.set(task.id, new Set());

    const onLine = (line: string) => {
      task.lines.push(line);
      if (task.lines.length > this.bufferLines) task.lines.shift();
      for (const l of this.listeners.get(task.id) ?? []) l.onLine(line);
    };
    const onEvent = (ev: RunEvent) => {
      if (ev.type === 'plan') task.plan = ev.stages;
      else if (ev.type === 'stage') task.stage = ev.name;
      for (const l of this.listeners.get(task.id) ?? []) l.onEvent(ev);
    };
    job(onLine, onEvent).then(
      (code) => this.finish(task, code),
      () => this.finish(task, 1),
    );
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

  subscribe(
    id: string,
    onLine: (line: string) => void,
    onEvent: (ev: RunEvent) => void,
    onEnd: (t: RunTask) => void,
  ): () => void {
    const task = this.tasks.get(id);
    if (!task) return () => {};
    if (task.plan) onEvent({ type: 'plan', stages: task.plan });   // replay current
    if (task.stage) onEvent({ type: 'stage', name: task.stage });
    for (const l of task.lines) onLine(l);                          // replay buffer
    if (task.status !== 'running') { onEnd(task); return () => {}; }
    const listener: Listener = { onLine, onEvent, onEnd };
    this.listeners.get(id)!.add(listener);
    return () => this.listeners.get(id)?.delete(listener);
  }
}
