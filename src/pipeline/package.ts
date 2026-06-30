import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { Seen } from '../state/seen.js';
import { writeWatermark, type Watermark } from '../state/watermark.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';
import { assertAgentOk } from './runner.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

/**
 * Shared packaging head used by both the paper path (`packageStage`) and the feed path
 * (`feedPackage`): guard the context, reject unrelated dirty files, then run the
 * devil's-advocate / run-summary adapter pass. Returns the run-summary path. The two paths
 * diverge only in how they commit (PR branch vs. in-place on main).
 */
export async function packageReview(ctx: RunContext): Promise<string> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent) throw new Error('package requires note context');
  if (!ctx.contradictionsPath) throw new Error('package requires contradictionsPath');
  if (!ctx.addSourceId) throw new Error('package (Plan 1, add mode) requires addSourceId');

  // 0. fail fast if user has unrelated uncommitted changes — otherwise they get
  //    swept into the researcher branch when we stage workshop docs.
  //    Allowed: workshop docs the agent actually maintains (landscape + the current paper's note,
  //    README.md, report.md, papers/, references/) and .researcher/ project metadata.
  //    Notes other than the current one are rejected on purpose: they're orphans from a
  //    previous failed run, and silently sweeping them up here would mask that failure.
  const dirty = await gitops.dirtyPathsOutside({
    cwd: ctx.projectRoot,
    allowedPrefixes: [
      '.researcher/', 'README.md', 'report.md', 'papers/', 'references/',
      LANDSCAPE,
      ctx.newNoteRelPath,
    ],
  });
  if (dirty.length > 0) {
    throw new Error(
      `working tree has uncommitted changes outside the agent's workshop surface:\n  ${dirty.join('\n  ')}\n` +
      `commit or stash them before running researcher.`,
    );
  }

  // 1. devil's-advocate / run summary via adapter
  const runSummaryPath = ctx.runDir.path('run-summary.md');
  const userPrompt = renderTemplate(loadPromptTemplate('stage-package.md'), {
    language: ctx.language,
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
  assertAgentOk(ctx.runDir, 'package', r);
  if (!existsSync(runSummaryPath)) {
    mkdirSync(dirname(runSummaryPath), { recursive: true });
    writeFileSync(runSummaryPath, '# Run summary\n\n_(adapter did not write a summary)_\n');
  }
  return runSummaryPath;
}

/**
 * Paper-path packaging: branch FROM MAIN, two commits, push, open a PR for human review.
 * Each paper run produces an independent PR; the human merges it to main between runs, and
 * that merge is how the corpus accumulates. The feed path can't rely on that (an autonomous
 * high-frequency stream has nobody merging PRs), so it uses `feedPackage` instead.
 */
export async function packageStage(ctx: RunContext): Promise<void> {
  const runSummaryPath = await packageReview(ctx);
  // packageReview already asserted these are present; narrow for the rest of the stage.
  const newNoteFilename = ctx.newNoteFilename!;
  const addSourceId = ctx.addSourceId!;

  // 2. snapshot the to-be-committed files into memory before the branch dance.
  //    We branch from main to keep each PR independent, but synthesize/read just wrote into the
  //    working tree on the previous branch. After we switch to main, those files will revert
  //    to main's content — so we capture the cumulative content here and restore on the new branch.
  const candidatePaths = [
    join('notes', newNoteFilename),
    LANDSCAPE,
    'README.md',
    'report.md',
    'papers/README.md',
    '.researcher/project.yaml',
    '.researcher/thesis.md',
    '.researcher/.gitignore',
  ];
  const snapshots = new Map<string, string>();
  for (const rel of candidatePaths) {
    const abs = join(ctx.projectRoot, rel);
    if (existsSync(abs)) snapshots.set(rel, readFileSync(abs, 'utf8'));
  }
  // Cumulative state from previous branch's working tree (= main + every un-merged paper PR).
  const seenPath = join(ctx.researcherDir, 'state/seen.jsonl');
  const wmPath = join(ctx.researcherDir, 'state/watermark.json');
  const cumulativeSeen = existsSync(seenPath) ? readFileSync(seenPath, 'utf8') : '';

  // 3. git: branch FROM MAIN, two commits, push, PR. Stash → checkout main → branch → drop stash
  //    → restore snapshots. Working tree stays on the new branch so the next `researcher add`
  //    invocation reads the cumulative seen.jsonl (otherwise main's seen.jsonl would be stale
  //    until the PR merges, breaking dedup for back-to-back runs of the same paper).
  const baseBranch = await gitops.getCurrentBranch({ cwd: ctx.projectRoot });
  // Branch name = the note filename (without .md). Readable PR titles when the
  // user opens a PR via the GitHub UI; collisions are blocked by seen.jsonl.
  const branch = `researcher/${newNoteFilename.replace(/\.md$/, '')}`;
  const stashMsg = `researcher-pkg-${ctx.runDir.id}`;
  const stashed = await gitops.stash({ cwd: ctx.projectRoot, message: stashMsg });
  await gitops.checkout({ cwd: ctx.projectRoot, branch: 'main' });
  await gitops.pullFastForward({ cwd: ctx.projectRoot, branch: 'main', remote: ctx.pushRemote });
  await gitops.createBranch({ cwd: ctx.projectRoot, branch });
  if (stashed) await gitops.stashDrop({ cwd: ctx.projectRoot });

  // 4. restore snapshots — everything except state files. State gets the cumulative content
  //    plus this run's append below.
  for (const [rel, content] of snapshots) {
    const abs = join(ctx.projectRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  mkdirSync(dirname(seenPath), { recursive: true });
  writeFileSync(seenPath, cumulativeSeen);

  // 5. update state files (Seen.append + watermark) on the new branch's checked-out tree.
  const seen = new Seen(seenPath);
  if (!seen.has(addSourceId)) {
    seen.append({
      id: addSourceId,
      source: addSourceId.startsWith('arxiv:')
        ? 'arxiv'
        : addSourceId.startsWith('xfeed:')
        ? 'x-inbox'
        : 'url',
      first_seen_run: ctx.runDir.id,
      decision: 'deep-read',
      reason: ctx.triageReason ?? 'manual feed via researcher add',
    });
  }
  const now = new Date().toISOString();
  const wm: Watermark = {
    last_run_completed_at: now,
    last_run_window: { from: now, to: now },
    last_run_id: ctx.runDir.id,
  };
  writeWatermark(wmPath, wm);

  // 6. commit research, then state, then push + PR.
  // git add fails fatally on a missing pathspec; filter by existsSync (some are optional).
  const researchPaths = candidatePaths.filter((p) => existsSync(join(ctx.projectRoot, p)));
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: researchPaths,
    message: `research: add note on ${newNoteFilename.replace(/\.md$/, '')} + landscape update`,
  });
  await gitops.commit({
    cwd: ctx.projectRoot,
    paths: ['.researcher/state/seen.jsonl', '.researcher/state/watermark.json'],
    message: `state: seen +1, watermark ${now}`,
  });
  await gitops.pushBranch({ cwd: ctx.projectRoot, branch, remote: ctx.pushRemote });
  const prTitle = `research: add ${newNoteFilename.replace(/\.md$/, '')}`;
  await gitops.ghPrCreate({ cwd: ctx.projectRoot, title: prTitle, bodyFile: runSummaryPath, remote: ctx.pushRemote });

  process.stdout.write(`\nworking tree is on branch ${branch}.\n`);
  const reviewTarget = ctx.pushRemote ? 'the PR' : 'this branch';
  process.stdout.write(`when you're done reviewing ${reviewTarget}, switch back: \`git checkout ${baseBranch}\`.\n`);
}
