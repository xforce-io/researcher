import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { Seen } from '../state/seen.js';
import { writeWatermark, type Watermark } from '../state/watermark.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

export async function packageStage(ctx: RunContext): Promise<void> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent) throw new Error('package requires note context');
  if (!ctx.contradictionsPath) throw new Error('package requires contradictionsPath');
  if (!ctx.addArxivId) throw new Error('package (Plan 1, add mode) requires addArxivId');

  // 1. devil's-advocate / run summary via adapter
  const runSummaryPath = ctx.runDir.path('run-summary.md');
  const userPrompt = renderTemplate(loadPromptTemplate('stage-package.md'), {
    methodology_verification: ctx.methodology.get('05-verification.md') ?? '',
    methodology_writing: ctx.methodology.get('06-writing.md') ?? '',
    thesis: ctx.thesis.body,
    new_note_content: ctx.newNoteContent,
    landscape_diff: ctx.landscapeDiff ?? '(no diff)',
    contradictions: existsSync(ctx.contradictionsPath) ? readFileSync(ctx.contradictionsPath, 'utf8') : 'none',
    run_summary_path: runSummaryPath,
  });
  const systemPrompt = loadPromptTemplate('system-preamble.md');
  const r = await ctx.adapter.invoke({
    cwd: ctx.projectRoot,
    systemPrompt,
    userPrompt,
    timeoutMs: TIMEOUT_MS,
  });
  if (r.exitCode !== 0) throw new Error(`package stage agent exited ${r.exitCode}`);
  if (!existsSync(runSummaryPath)) {
    mkdirSync(dirname(runSummaryPath), { recursive: true });
    writeFileSync(runSummaryPath, '# Run summary\n\n_(adapter did not write a summary)_\n');
  }

  // 2. update state files
  const seen = new Seen(join(ctx.researcherDir, 'state/seen.jsonl'));
  if (!seen.has(ctx.addArxivId)) {
    seen.append({
      id: ctx.addArxivId,
      source: 'arxiv',
      first_seen_run: ctx.runDir.id,
      decision: 'deep-read',
      reason: 'manual feed via researcher add',
    });
  }
  const now = new Date().toISOString();
  const wm: Watermark = {
    last_run_completed_at: now,
    last_run_window: { from: now, to: now },
    last_run_id: ctx.runDir.id,
  };
  writeWatermark(join(ctx.researcherDir, 'state/watermark.json'), wm);

  // 3. git: branch, two commits, push, PR. Working tree stays on the new branch
  // so the next `researcher add` invocation reads the up-to-date seen.jsonl
  // (otherwise main's seen.jsonl would be stale until the PR merges, breaking
  // dedup for back-to-back runs of the same paper).
  const baseBranch = await gitops.getCurrentBranch({ cwd: ctx.projectRoot });
  const branch = `researcher/${ctx.runDir.id}`;
  await gitops.createBranch({ cwd: ctx.projectRoot, branch });
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: [join('notes', ctx.newNoteFilename), LANDSCAPE],
    message: `research: add note on ${ctx.newNoteFilename.replace(/\.md$/, '')} + landscape update`,
  });
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: ['.researcher/state/seen.jsonl', '.researcher/state/watermark.json'],
    message: `state: seen +1, watermark ${now}`,
  });
  await gitops.pushBranch({ cwd: ctx.projectRoot, branch });
  const prTitle = `research: add ${ctx.newNoteFilename.replace(/\.md$/, '')}`;
  await gitops.ghPrCreate({ cwd: ctx.projectRoot, title: prTitle, bodyFile: runSummaryPath });

  process.stdout.write(`\nworking tree is on branch ${branch}.\n`);
  process.stdout.write(`when you're done reviewing the PR, switch back: \`git checkout ${baseBranch}\`.\n`);
}
