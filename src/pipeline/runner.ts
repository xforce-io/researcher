import type { RunDir, Stage } from '../state/runs.js';
import type { InvokeResult } from '../adapter/interface.js';
import { emitEvent } from './events.js';

export interface StageDef {
  name: Stage;
  fn: () => Promise<void>;
}

export async function runStages(rd: RunDir, stages: readonly StageDef[]): Promise<void> {
  for (const s of stages) {
    rd.markStart(s.name);
    emitEvent({ type: 'stage', name: s.name });
    await s.fn();
    rd.markDone(s.name);
  }
}

/**
 * Guard an agent invocation result: on non-zero exit, persist stderr + stdout
 * tail to `<stage>.err` and throw an error that includes a short failure
 * detail (so UI/logs show the real provider error, not only exit code).
 * No-op on success.
 */
export function assertAgentOk(rd: RunDir, stage: Stage, result: InvokeResult): void {
  if (result.exitCode === 0) return;
  const errPath = rd.recordAgentFailure(stage, result);
  const detail = summarizeAgentFailure(result);
  throw new Error(
    detail
      ? `${stage} stage agent exited ${result.exitCode}: ${detail} (stderr saved to ${errPath})`
      : `${stage} stage agent exited ${result.exitCode} (stderr saved to ${errPath})`,
  );
}

/** Prefer structured error, then output, then stderr; one short line for throws. */
function summarizeAgentFailure(result: InvokeResult): string {
  const structured = result.error?.message?.trim() ?? '';
  const raw = (structured || result.output || result.stderr || '').trim();
  if (!raw) return '';
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? raw;
  const oneLine = line.replace(/\s+/g, ' ');
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
}
