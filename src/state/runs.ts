import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Stage = 'bootstrap' | 'soul' | 'discover' | 'read' | 'synthesize' | 'package';

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
}
