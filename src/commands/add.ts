import { join } from 'node:path';
import { canonicalizeArxivId } from '../sources/arxiv.js';
import { canonicalizeUrl } from '../sources/url.js';
import { MilkieAdapter } from '../adapter/milkie.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { runStages } from '../pipeline/runner.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { packageStage } from '../pipeline/package.js';
import { Seen } from '../state/seen.js';
import { withLock } from '../state/lock.js';
import type { RunContext } from '../pipeline/context.js';

export interface AddOptions { input: string; cwd: string; }

export async function runAdd(opts: AddOptions): Promise<void> {
  const id = canonicalizeAddInput(opts.input);
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const seen = new Seen(join(researcherDir, 'state/seen.jsonl'));
  if (seen.has(id)) {
    process.stdout.write(`already seen: ${id} (decision=${seen.get(id)?.decision})\n`);
    return;
  }
  const adapter = new MilkieAdapter();
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
  });
  process.stdout.write(`done. run id: ${runDir.id}\n`);
}

export function canonicalizeAddInput(input: string): string {
  try { return canonicalizeArxivId(input); } catch { /* fall through */ }
  try { return canonicalizeUrl(input); } catch { /* fall through */ }
  throw new Error(`unrecognized input (not an arxiv id and not an http(s) URL): ${input}`);
}
