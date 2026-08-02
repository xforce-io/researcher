import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntime } from '../adapter/interface.js';
import { runRun, type RunOptions, type RunResult } from '../commands/run.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { activeTopics, loadWorkspaceManifest, resolveWorkspaceManifestPath } from './manifest.js';
import { syncCharterToTopic } from './charter.js';

export type TopicStatus = 'ok' | 'error';

export interface TopicResult {
  path: string;
  status: TopicStatus;
  outcome?: RunResult['outcome'];
  charterSynced: boolean;
  message?: string;
}

export interface WorkspaceRunResult {
  /** Attempted (active) topics only, in manifest order. */
  topics: TopicResult[];
  /** Paths skipped because active:false — never touched. */
  dormant: string[];
}

export interface WorkspaceRunOptions {
  cwd: string;
  adapter?: AgentRuntime;
  /** Injectable for tests; defaults to the real per-topic runRun. */
  runTopic?: (opts: RunOptions) => Promise<RunResult>;
  /** Forwarded to each topic run (#140). Default off. */
  discover?: boolean;
}

/**
 * Workspace-aware run: from a super-repo root, serially advance every active
 * topic (each in its own submodule repo), syncing the CHARTER.md slice in
 * first. Dormant topics are never touched. One topic failing does not abort
 * the rest — errors are collected and reported in the summary.
 */
export async function runWorkspace(opts: WorkspaceRunOptions): Promise<WorkspaceRunResult> {
  const runTopic = opts.runTopic ?? runRun;
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(opts.cwd));

  const charterPath = join(opts.cwd, 'CHARTER.md');
  const charter = existsSync(charterPath) ? readFileSync(charterPath, 'utf8') : null;

  const actives = activeTopics(manifest);
  const dormant = manifest.topics.filter((t) => !t.active).map((t) => t.path);

  process.stdout.write(
    `workspace: ${actives.length} active topic(s), ${dormant.length} dormant — ` +
    (charter ? 'charter anchoring on.\n' : 'no CHARTER.md, running unanchored.\n'),
  );

  const results: TopicResult[] = [];
  for (const t of actives) {
    const topicDir = join(opts.cwd, t.path);

    if (!existsSync(topicDir)) {
      results.push({ path: t.path, status: 'error', charterSynced: false, message: 'submodule directory missing (run `git submodule update --init`?)' });
      process.stdout.write(`  [${t.path}] SKIP — directory missing\n`);
      continue;
    }
    if (!existsSync(resolveProjectResearcherDir(topicDir))) {
      results.push({ path: t.path, status: 'error', charterSynced: false, message: 'no .researcher/ — not a researcher topic' });
      process.stdout.write(`  [${t.path}] SKIP — no .researcher/\n`);
      continue;
    }

    let charterSynced = false;
    if (charter) {
      try {
        charterSynced = syncCharterToTopic(opts.cwd, t.path, charter) !== null;
      } catch (err) {
        process.stdout.write(`  [${t.path}] charter sync failed: ${errMsg(err)} (continuing unanchored)\n`);
      }
    }

    process.stdout.write(`\n=== [${t.path}] tick${charterSynced ? ' (charter synced)' : ''} ===\n`);
    try {
      const res = await runTopic({
        cwd: topicDir,
        workspaceRoot: opts.cwd,
        topicPath: t.path,
        adapter: opts.adapter,
        discover: opts.discover,
      });
      results.push({ path: t.path, status: 'ok', outcome: res.outcome, charterSynced });
    } catch (err) {
      results.push({ path: t.path, status: 'error', charterSynced, message: errMsg(err) });
      process.stdout.write(`  [${t.path}] ERROR — ${errMsg(err)} (continuing with next topic)\n`);
    }
  }

  printSummary(results, dormant);
  return { topics: results, dormant };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printSummary(topics: TopicResult[], dormant: string[]): void {
  process.stdout.write('\n──── workspace run summary ────\n');
  for (const r of topics) {
    const mark = r.status === 'ok' ? '✓' : '✗';
    const detail = r.status === 'ok' ? r.outcome : r.message;
    process.stdout.write(`  ${mark} ${r.path}: ${detail}${r.charterSynced ? '' : '  [no charter]'}\n`);
  }
  if (dormant.length) process.stdout.write(`  · dormant (untouched): ${dormant.join(', ')}\n`);
}
