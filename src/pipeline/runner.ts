import type { RunDir, Stage } from '../state/runs.js';
import type { InvokeResult } from '../adapter/interface.js';

export interface StageDef {
  name: Stage;
  fn: () => Promise<void>;
}

export async function runStages(rd: RunDir, stages: readonly StageDef[]): Promise<void> {
  for (const s of stages) {
    rd.markStart(s.name);
    await s.fn();
    rd.markDone(s.name);
  }
}

/**
 * Guard an agent invocation result: on non-zero exit, persist stderr + stdout
 * tail to `<stage>.err` and throw an error pointing at it. No-op on success.
 * Replaces the bare `if (exitCode !== 0) throw` each stage used to hand-write.
 */
export function assertAgentOk(rd: RunDir, stage: Stage, result: InvokeResult): void {
  if (result.exitCode === 0) return;
  const errPath = rd.recordAgentFailure(stage, result);
  throw new Error(`${stage} stage agent exited ${result.exitCode} (stderr saved to ${errPath})`);
}
