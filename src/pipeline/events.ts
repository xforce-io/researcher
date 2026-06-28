import type { Stage } from '../state/runs.js';

/**
 * Structured progress events emitted by a run subprocess over the Node IPC
 * channel (process.send). When the run is not forked with an IPC channel
 * (a human running `researcher run` directly), `process.send` is undefined
 * and emitEvent is a no-op — no env var, no mode check.
 *
 * `plan`  — the ordered stage names this run intends to execute (authoritative
 *           denominator for the frontend `(i/n)`); emitted once mode is known.
 * `stage` — a stage just started.
 */
export type RunEvent =
  | { type: 'plan'; stages: Stage[] }
  | { type: 'stage'; name: Stage };

export function emitEvent(ev: RunEvent): void {
  process.send?.(ev);
}
