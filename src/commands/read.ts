import { join } from 'node:path';
import { MilkieAdapter } from '../adapter/milkie.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { read } from '../pipeline/read.js';
import { withLock } from '../state/lock.js';
import { newRunId, RunDir } from '../state/runs.js';
import { canonicalizeAddInput } from './add.js';
import { runStages } from '../pipeline/runner.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from '../pipeline/context.js';

export interface ReadCommandOptions {
  input: string;
  cwd: string;
}

export async function runRead(opts: ReadCommandOptions): Promise<void> {
  const id = canonicalizeAddInput(opts.input);
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
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
      { name: 'read', fn: async () => read(ctx!, { destinationZone: 'pending' }) },
    ] as const);
    if (!ctx!.newNoteRelPath) throw new Error('read command did not produce a pending note path');
    await gitops.commit({
      cwd: opts.cwd,
      paths: [ctx!.newNoteRelPath],
      message: `research: pending read ${ctx!.newNoteFilename!.replace(/\.md$/, '')}`,
    });
  });
  process.stdout.write(`done. run id: ${runDir.id}\n`);
}
