import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MilkieAdapter } from '../adapter/milkie.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { newRunId, RunDir } from '../state/runs.js';
import { withLock } from '../state/lock.js';
import { Seen } from '../state/seen.js';
import { runStages, type StageDef } from '../pipeline/runner.js';
import { emitEvent } from '../pipeline/events.js';
import { bootstrap } from '../pipeline/bootstrap.js';
import { soulBootstrap } from '../pipeline/soul_bootstrap.js';
import { discoverTriage } from '../pipeline/discover_triage.js';
import { read } from '../pipeline/read.js';
import { synthesize } from '../pipeline/synthesize.js';
import { feedSynthesize } from '../pipeline/feed_synthesize.js';
import { feedEnrich } from '../pipeline/feed_enrich.js';
import { rebalance } from '../pipeline/rebalance.js';
import { packageStage } from '../pipeline/package.js';
import { feedPackage } from '../pipeline/package_feed.js';
import { classifyContradictions } from '../pipeline/contradictions.js';
import { pickOldestUnconsumed } from '../sources/inbox.js';
import type { RunContext } from '../pipeline/context.js';

/** Resolve a configured inbox_dir, expanding a leading ~. */
function resolveInboxDir(p: string | undefined): string | null {
  if (!p) return null;
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export interface RunOptions {
  cwd: string;
  /** Injectable for tests. Production: MilkieAdapter. */
  adapter?: AgentRuntime;
}

/** What a single autonomous tick concluded — surfaced for workspace summaries. */
export type RunOutcome =
  | 'completed'      // deep-read a paper + synthesized + packaged (PR opened)
  | 'no-candidate'   // discover ran but nothing worth deep-reading this tick
  | 'thin-signal'    // soul too thin to draft; punted to open_questions.md
  | 'no-queries';    // no arxiv queries configured; discover skipped

export interface RunResult {
  outcome: RunOutcome;
  runId: string;
}

export async function runRun(opts: RunOptions): Promise<RunResult> {
  const researcherDir = resolveProjectResearcherDir(opts.cwd);
  const adapter = opts.adapter ?? new MilkieAdapter();
  const runDir = new RunDir(join(researcherDir, 'state/runs'), newRunId());

  let outcome: RunOutcome = 'completed';
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
      outcome = 'thin-signal';
      return;
    }

    // Feed mode: an x-inbox source side-mounts a second pipeline that consumes
    // the repo-external inbox queue. The arxiv/url discover→read path is untouched.
    const feedSource = ctx!.projectYaml.sources.find((s) => s.kind === 'x-inbox');
    if (feedSource) {
      const inboxDir = resolveInboxDir(feedSource.inbox_dir);
      if (!inboxDir) {
        process.stdout.write(
          `autonomous tick: x-inbox source has no inbox_dir configured — nothing to consume. (${runDir.id})\n`,
        );
        outcome = 'no-queries';
        return;
      }
      const seen = new Seen(join(researcherDir, 'state/seen.jsonl'));
      const pick = pickOldestUnconsumed(inboxDir, (id) => seen.has(id));
      if (!pick) {
        process.stdout.write(`autonomous tick: no unconsumed digest in ${inboxDir} (${runDir.id}).\n`);
        outcome = 'no-candidate';
        return;
      }
      ctx!.feedDigest = pick;
      // No semantic triage: the digest's items are already source-allowlisted upstream.
      // feed-synthesize weighs thesis-relevance while writing. One LLM call, not two.
      const feedStages: StageDef[] = [
        { name: 'rebalance', fn: async () => rebalance(ctx!) },
        { name: 'feed-synthesize', fn: async () => feedSynthesize(ctx!) },
      ];
      // #27: opt-in researcher-side enrich/verify pass — turns the report's "下一步:补 X 数据"
      // items into primary-sourced, confidence-tagged evidence. Off = synthesize-only (current).
      if (feedSource.enrich) {
        feedStages.push({ name: 'feed-enrich', fn: async () => feedEnrich(ctx!) });
      }
      // #25: feed commits in place to main (one commit/window), not the paper path's branch+PR.
      feedStages.push({ name: 'package', fn: async () => feedPackage(ctx!) });
      emitEvent({ type: 'plan', stages: ['bootstrap', 'soul', ...feedStages.map((s) => s.name)] });
      await runStages(runDir, feedStages);
      process.stdout.write(
        `done. run id: ${runDir.id} (feed digest: ${pick.filename}, ${pick.meta.count} item(s))\n`,
      );
      reportContradictions(ctx!);
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
      outcome = 'no-queries';
      return;
    }

    emitEvent({
      type: 'plan',
      stages: ['bootstrap', 'soul', 'discover', 'read', 'rebalance', 'synthesize', 'package'],
    });
    await runStages(runDir, [
      { name: 'discover', fn: async () => discoverTriage(ctx!) },
    ]);

    if (!ctx!.addSourceId) {
      process.stdout.write(`autonomous tick: no deep-read candidate this run (${runDir.id}).\n`);
      outcome = 'no-candidate';
      return;
    }

    await runStages(runDir, [
      { name: 'read',       fn: async () => read(ctx!) },
      { name: 'rebalance',  fn: async () => rebalance(ctx!) },
      { name: 'synthesize', fn: async () => synthesize(ctx!) },
      { name: 'package',    fn: async () => packageStage(ctx!) },
    ]);
    process.stdout.write(`done. run id: ${runDir.id} (deep-read: ${ctx!.addSourceId})\n`);
    reportContradictions(ctx!);
  });
  return { outcome, runId: runDir.id };
}

/** Surface contradiction/landscape/charter signals from this run's contradictions.md. */
function reportContradictions(ctx: RunContext): void {
  if (!ctx.contradictionsPath || !existsSync(ctx.contradictionsPath)) return;
  const report = classifyContradictions(readFileSync(ctx.contradictionsPath, 'utf8'));
  if (report.hasContradictions) {
    process.stdout.write(`\ncontradictions found — consider updating .researcher/thesis.md\n`);
  }
  if (report.hasTaxonomyProposal) {
    process.stdout.write(`\nlandscape proposal pending review — see contradictions.md §"Proposed taxonomy extension"\n`);
  }
  if (report.hasCharterTension) {
    process.stdout.write(`\ncharter tension surfaced — see contradictions.md §"Charter tension" (adjudicate: fix pillar or update super-repo CHARTER.md)\n`);
  }
}
