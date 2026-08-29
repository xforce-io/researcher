import { join } from 'node:path';
import { canonicalizeArxivId } from '../sources/arxiv.js';
import { canonicalizeUrl } from '../sources/url.js';
import { createAgentRuntime } from '../adapter/runtime.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { runStages } from '../pipeline/runner.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { packageStage } from '../pipeline/package.js';
import { registerAddInWorkspaceLibrary } from '../pipeline/library_add_register.js';
import { Seen } from '../state/seen.js';
import { withLock } from '../state/lock.js';
import type { AgentRuntime } from '../adapter/interface.js';
import type { RunContext } from '../pipeline/context.js';

export interface AddOptions { input: string; cwd: string; adapter?: AgentRuntime; }

export async function runAdd(opts: AddOptions): Promise<void> {
  const id = canonicalizeAddInput(opts.input);
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const seen = new Seen(join(researcherDir, 'state/seen.jsonl'));
  if (seen.has(id)) {
    process.stdout.write(`already seen: ${id} (decision=${seen.get(id)?.decision})\n`);
    return;
  }
  const adapter = opts.adapter ?? createAgentRuntime();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());
  await withLock(join(researcherDir, 'state/.lock'), async () => {
    let ctx: RunContext;
    await runStages(runDir, [
      {
        name: 'bootstrap',
        fn: async () => {
          ctx = await bootstrap({ projectRoot: opts.cwd, adapter, runDir, addSourceId: id });
        },
      },
      { name: 'read',        fn: async () => read(ctx!) },
      { name: 'synthesize',  fn: async () => synthesize(ctx!) },
      { name: 'package',     fn: async () => packageStage(ctx!) },
    ] as const);
    registerAddInWorkspaceLibrary(ctx!);
  });
  process.stdout.write(`done. run id: ${runDir.id}\n`);
}

export function canonicalizeAddInput(input: string): string {
  try { return canonicalizeArxivId(input); } catch { /* fall through */ }
  try { return canonicalizeUrl(input); } catch { /* fall through */ }
  throw new Error(`unrecognized input (not an arxiv id and not an http(s) URL): ${input}`);
}
