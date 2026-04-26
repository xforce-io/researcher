import { join } from 'node:path';
import { canonicalizeArxivId } from '../sources/arxiv.js';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { runStages } from '../pipeline/runner.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { packageStage } from '../pipeline/package.js';
import { Seen } from '../state/seen.js';
import type { RunContext } from '../pipeline/context.js';

export interface AddOptions { input: string; cwd: string; }

export async function runAdd(opts: AddOptions): Promise<void> {
  const id = canonicalizeArxivId(opts.input); // Plan 1: arxiv-only
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const seen = new Seen(join(researcherDir, 'state/seen.jsonl'));
  if (seen.has(id)) {
    process.stdout.write(`already seen: ${id} (decision=${seen.get(id)?.decision})\n`);
    return;
  }
  const adapter = new ClaudeCodeAdapter();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());
  let ctx: RunContext;
  await runStages(runDir, [
    {
      name: 'bootstrap',
      fn: async () => {
        ctx = await bootstrap({ projectRoot: opts.cwd, adapter, runDir, addArxivId: id });
      },
    },
    { name: 'read',        fn: async () => read(ctx!) },
    { name: 'synthesize',  fn: async () => synthesize(ctx!) },
    { name: 'package',     fn: async () => packageStage(ctx!) },
  ] as const);
  process.stdout.write(`done. run id: ${runDir.id}\n`);
}
