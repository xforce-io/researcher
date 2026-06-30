import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Seen } from '../state/seen.js';
import { writeWatermark, type Watermark } from '../state/watermark.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';
import { packageReview } from './package.js';

const LANDSCAPE = 'notes/00_research_landscape.md';

/**
 * Feed-path packaging (#25): commit one feed window IN PLACE to the current branch (main),
 * as a single commit, with NO branch / PR / snapshot dance.
 *
 * The paper path forks a PR per run and relies on a human merging it to main between runs to
 * accumulate the corpus. An autonomous, high-frequency feed has nobody merging PRs, so that
 * model fans each window into an isolated branch off an empty main — notes scatter, main stays
 * empty. Committing straight to main keeps main the single accumulating truth, and lets the feed
 * path skip package.ts's snapshot/fork/restore machinery entirely (we never leave this branch,
 * so it always already holds the cumulative state — no snapshot needed).
 *
 * Tradeoff: no PR review gate. Acceptable here because the output is a revertible, read-only
 * evidence report — one commit per window means a bad run is a precise `git revert`.
 */
export async function feedPackage(ctx: RunContext): Promise<void> {
  await packageReview(ctx); // guards + dirty-check + devil's-advocate run summary

  // State updates in place: seen.jsonl already holds every prior window (we never branched away),
  // so a plain append is cumulative. Both helpers create their own dirs.
  const seenPath = join(ctx.researcherDir, 'state/seen.jsonl');
  const wmPath = join(ctx.researcherDir, 'state/watermark.json');
  const seen = new Seen(seenPath);
  if (!seen.has(ctx.addSourceId!)) {
    seen.append({
      id: ctx.addSourceId!,
      source: 'x-inbox',
      first_seen_run: ctx.runDir.id,
      decision: 'deep-read',
      reason: ctx.triageReason ?? 'feed digest',
    });
  }
  const now = new Date().toISOString();
  const wm: Watermark = {
    last_run_completed_at: now,
    last_run_window: { from: now, to: now },
    last_run_id: ctx.runDir.id,
  };
  writeWatermark(wmPath, wm);

  // ONE commit: window note + landscape/report/README + state, together (not the paper
  // path's research-then-state two-commit split).
  const paths = [
    ctx.newNoteRelPath!,
    LANDSCAPE,
    'README.md',
    'report.md',
    'papers/README.md',
    '.researcher/state/seen.jsonl',
    '.researcher/state/watermark.json',
  ].filter((p) => existsSync(join(ctx.projectRoot, p)));
  const slug = ctx.newNoteFilename!.replace(/\.md$/, '');
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths,
    message: `feed: ${slug} + landscape/report`,
  });

  const branch = await gitops.getCurrentBranch({ cwd: ctx.projectRoot });
  process.stdout.write(`\nfeed window committed in place on ${branch} (${slug}).\n`);
}
