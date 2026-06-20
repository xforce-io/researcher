import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Stage =
  | 'bootstrap'
  | 'soul'
  | 'discover'
  | 'read'
  | 'synthesize'
  | 'package'
  | 'feed-synthesize'
  | 'feed-enrich';

export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = randomBytes(3).toString('hex');
  return `r-${ts}-${rand}`;
}

export class RunDir {
  readonly dir: string;
  constructor(stateRunsBase: string, public readonly id: string) {
    this.dir = join(stateRunsBase, id);
    mkdirSync(this.dir, { recursive: true });
  }
  path(name: string): string {
    return join(this.dir, name);
  }
  markStart(stage: Stage): void {
    writeFileSync(this.path(`${stage}.start`), new Date().toISOString() + '\n');
  }
  markDone(stage: Stage): void {
    writeFileSync(this.path(`${stage}.done`), new Date().toISOString() + '\n');
  }
  isDone(stage: Stage): boolean {
    return existsSync(this.path(`${stage}.done`));
  }
  /**
   * Persist a failed agent invocation to `<stage>.err` for post-hoc diagnosis.
   * Without this the run dir holds only `<stage>.start` and the exit code is the
   * only signal — too thin to tell a transient failure from a systemic one.
   * Returns the path written.
   */
  recordAgentFailure(
    stage: Stage,
    result: { exitCode: number; stderr?: string; output?: string },
  ): string {
    const TAIL = 50;
    const stdoutTail = (result.output ?? '').split('\n').slice(-TAIL).join('\n');
    const body =
      `exitCode: ${result.exitCode}\n\n` +
      `--- stderr ---\n${result.stderr || '(empty)'}\n\n` +
      `--- stdout (last ${TAIL} lines) ---\n${stdoutTail}\n`;
    const p = this.path(`${stage}.err`);
    writeFileSync(p, body);
    return p;
  }
}
