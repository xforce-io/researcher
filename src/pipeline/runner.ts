import type { RunDir, Stage } from '../state/runs.js';

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
