import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../adapter/claude-code.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { withLock } from '../state/lock.js';
import { runStages } from '../pipeline/runner.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { soulBootstrap } from '../pipeline/soul_bootstrap.js';
import { discoverTriage } from '../pipeline/discover_triage.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { packageStage } from '../pipeline/package.js';
import type { RunContext } from '../pipeline/context.js';

export interface RunOptions {
  cwd: string;
  /** Injectable for tests. Production: ClaudeCodeAdapter. */
  adapter?: AgentRuntime;
}

export async function runRun(opts: RunOptions): Promise<void> {
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const adapter = opts.adapter ?? new ClaudeCodeAdapter();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());

  await withLock(join(researcherDir, 'state/.lock'), async () => {
    let ctx: RunContext;
    await runStages(runDir, [
      {
        name: 'bootstrap',
        fn: async () => {
          ctx = await bootstrap({ projectRoot: opts.cwd, adapter, runDir });
        },
      },
      { name: 'soul',     fn: async () => soulBootstrap(ctx!) },
    ]);

    if (ctx!.needsHumanInput) {
      process.stdout.write(
        `autonomous tick: signal too thin to draft project soul. ` +
        `see .researcher/open_questions.md, fill it in, then re-run. (${runDir.id})\n`,
      );
      return;
    }

    const hasRealQueries = ctx!.projectYaml.sources.some(
      (s) => s.queries && s.queries.some((q) => q.trim() !== '' && q !== 'your topic keyword')
    );
    if (!hasRealQueries) {
      process.stdout.write(
        `autonomous tick: no arxiv keywords configured — skipping discover stage.\n` +
        `Add queries to .researcher/project.yaml sources[].queries, or use \`researcher add <arxiv-id>\`.\n`
      );
      return;
    }

    await runStages(runDir, [
      { name: 'discover', fn: async () => discoverTriage(ctx!) },
    ]);

    if (!ctx!.addArxivId) {
      process.stdout.write(`autonomous tick: no deep-read candidate this run (${runDir.id}).\n`);
      return;
    }

    await runStages(runDir, [
      { name: 'read',       fn: async () => read(ctx!) },
      { name: 'synthesize', fn: async () => synthesize(ctx!) },
      { name: 'package',    fn: async () => packageStage(ctx!) },
    ]);
    process.stdout.write(`done. run id: ${runDir.id} (deep-read: ${ctx!.addArxivId})\n`);
  });
}
