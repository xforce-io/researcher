import type { Stage } from '../state/runs.js';

/**
 * Structured progress events emitted by a run subprocess over the Node IPC
 * channel (process.send). Only the web runner opts in with RUN_IPC_ENV, so
 * generic test runners that also expose process.send do not receive these events.
 *
 * `plan`  — the ordered stage names this run intends to execute (authoritative
 *           denominator for the frontend `(i/n)`); emitted once mode is known.
 * `stage` — a stage just started.
 */
export type RunEvent =
  | { type: 'plan'; stages: Stage[] }
  | { type: 'stage'; name: Stage };

export const RUN_IPC_ENV = 'RESEARCHER_RUN_IPC';

export function emitEvent(ev: RunEvent): void {
  if (process.env[RUN_IPC_ENV] !== '1') return;
  process.send?.(ev);
}
