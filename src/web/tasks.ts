import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_IPC_ENV, type RunEvent } from '../pipeline/events.js';
import type { Stage } from '../state/runs.js';

export type Runner = (
  cwd: string,
  onLine: (line: string) => void,
  onEvent: (ev: RunEvent) => void,
  workspaceRoot?: string,
) => Promise<number>;

export type TaskJob = (
  onLine: (line: string) => void,
  onEvent: (ev: RunEvent) => void,
) => Promise<number>;

export type TaskStatus = 'running' | 'done' | 'error';

export interface RunTask {
  id: string;
  slug: string;
  lines: string[];
  status: TaskStatus;
  exitCode: number | null;
  startedAt: number;
  plan: Stage[] | null;
  stage: Stage | null;
  /** Why the task ended, when not a normal exit (e.g. unknown task id). */
  endReason?: 'unknown' | 'fork-error';
}

interface Listener {
  onLine: (line: string) => void;
  onEvent: (ev: RunEvent) => void;
  onEnd: (t: RunTask) => void;
}

let globalSeq = 0;
const defaultIdSeq = () => `task-${++globalSeq}`;

/**
 * Resolve the researcher CLI entry for forking `run`.
 * Prefer the compiled sibling of this module (`dist/cli.js`), not `process.argv[1]`
 * (which breaks when serve is started via `node -e` or other non-cli hosts).
 */
export function resolveCliEntry(metaUrl: string = import.meta.url): string {
  // dist/web/tasks.js → dist/cli.js ; src/web/tasks.ts under tsx → less common for serve
  const here = dirname(fileURLToPath(metaUrl));
  const candidates = [
    join(here, '../cli.js'),
    join(here, '../../dist/cli.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort: argv (normal `node dist/cli.js serve` / npm bin)
  if (process.argv[1] && existsSync(process.argv[1])) return process.argv[1];
  return candidates[0];
}

/**
 * Default runner: fork this CLI's `run` as a child process. stdout+stderr are
 * piped and split into log lines; structured stage/plan events arrive over the
 * Node IPC channel (the child calls process.send) — kept off stdout so the two
 * never collide and need no ordering guarantee.
 */
export function defaultRunner(cliEntry: string = resolveCliEntry()): Runner {
  return (cwd, onLine, onEvent, workspaceRoot) =>
    new Promise<number>((resolve) => {
      if (!cliEntry || !existsSync(cliEntry)) {
        onLine(`runner error: CLI entry not found: ${cliEntry || '(empty)'}`);
        onLine('hint: start serve via `researcher serve` / `node dist/cli.js serve`, not node -e');
        resolve(1);
        return;
      }
      const env: NodeJS.ProcessEnv = { ...process.env, [RUN_IPC_ENV]: '1' };
      if (workspaceRoot) env.RESEARCHER_WORKSPACE_ROOT = workspaceRoot;
      let child: ReturnType<typeof fork>;
      try {
        child = fork(cliEntry, ['run'], { cwd, silent: true, env });
      } catch (err) {
        onLine(`runner error: failed to fork: ${err instanceof Error ? err.message : String(err)}`);
        resolve(1);
        return;
      }
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
      child.on('error', (err) => {
        if (buf.length) onLine(buf);
        onLine(`runner error: ${err.message}`);
        resolve(1);
      });
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
    this.runner = opts?.runner ?? defaultRunner();
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

  start(slug: string, cwd: string, workspaceRoot?: string): RunTask {
    return this.startJob(slug, (onLine, onEvent) => this.runner(cwd, onLine, onEvent, workspaceRoot));
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

  /**
   * Subscribe to a task. Replays buffer / plan / stage.
   * If the task id is unknown, immediately ends with status error + endReason unknown
   * so SSE clients never hang in a false RUNNING state.
   */
  subscribe(
    id: string,
    onLine: (line: string) => void,
    onEvent: (ev: RunEvent) => void,
    onEnd: (t: RunTask) => void,
  ): () => void {
    const task = this.tasks.get(id);
    if (!task) {
      onEnd({
        id,
        slug: '',
        lines: [],
        status: 'error',
        exitCode: null,
        startedAt: 0,
        plan: null,
        stage: null,
        endReason: 'unknown',
      });
      return () => {};
    }
    if (task.plan) onEvent({ type: 'plan', stages: task.plan });
    if (task.stage) onEvent({ type: 'stage', name: task.stage });
    for (const l of task.lines) onLine(l);
    if (task.status !== 'running') { onEnd(task); return () => {}; }
    const listener: Listener = { onLine, onEvent, onEnd };
    this.listeners.get(id)!.add(listener);
    return () => this.listeners.get(id)?.delete(listener);
  }
}
