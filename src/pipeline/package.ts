import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPromptTemplate, renderTemplate } from '../prompts/load.js';
import { Seen } from '../state/seen.js';
import { writeWatermark, type Watermark } from '../state/watermark.js';
import * as gitops from '../git/ops.js';
import type { RunContext } from './context.js';
import { assertAgentOk } from './runner.js';
import { listIntegratedNotes, ZONE_DIRS } from '../state/note_index.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const LANDSCAPE = 'notes/00_research_landscape.md';

/**
 * Shared packaging head for the paper path: guard the context, reject unrelated
 * dirty files, then run the devil's-advocate / run-summary adapter pass.
 * Returns the run-summary path.
 */
export async function packageReview(ctx: RunContext, extraAllowedPrefixes: string[] = []): Promise<string> {
  if (!ctx.newNoteFilename || !ctx.newNoteContent || !ctx.newNoteRelPath) throw new Error('package requires note context');
  if (!ctx.contradictionsPath) throw new Error('package requires contradictionsPath');
  if (!ctx.addSourceId) throw new Error('package (Plan 1, add mode) requires addSourceId');

  // 0. fail fast if user has unrelated uncommitted changes — otherwise they get
  //    swept into the researcher branch when we stage workshop docs.
  //    Allowed: workshop docs the agent actually maintains (landscape + the current paper's note,
  //    README.md, report.md, papers/, references/) and .researcher/ project metadata.
  //    rebalance runs before package and legitimately rewrites
  //    frontmatter on — and relocates — prior notes inside those zone dirs.
  //    notes/ is allowed wholesale so flat→zone migration deletes (notes/01_*.md) don't fail package.
  //    .milkie/ + agents/ are the milkie runtime scaffold/cwd state — never research content;
  //    runs/objects/sqlite must not block packaging (also gitignored by ensureMilkieGitignore).
  //    Truly unrelated dirty files (anything outside the allow-list, e.g. src/foo.txt) still fail fast.
  const dirty = await gitops.dirtyPathsOutside({
    cwd: ctx.projectRoot,
    allowedPrefixes: [
      '.researcher/', 'README.md', 'report.md', 'papers/', 'references/',
      '.researcher-workspace/',
      '.milkie/',
      'agents/',
      'notes/',
      '.gitignore', // ensureMilkieGitignore may create/update this at repo root
      LANDSCAPE,
      ctx.newNoteRelPath,
      ...extraAllowedPrefixes,
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
 * that merge is how the corpus accumulates.
 */
export async function packageStage(ctx: RunContext): Promise<void> {
  const runSummaryPath = await packageReview(ctx, ZONE_DIRS.map((z) => z + '/'));
  // packageReview already asserted these are present; narrow for the rest of the stage.
  const newNoteFilename = ctx.newNoteFilename!;
  const addSourceId = ctx.addSourceId!;

  // 2. snapshot the to-be-committed files into memory before the branch dance.
  //    We branch from main to keep each PR independent, but synthesize/read just wrote into the
  //    working tree on the previous branch. After we switch to main, those files will revert
  //    to main's content — so we capture the cumulative content here and restore on the new branch.
  //    Snapshot ALL live notes (not just the current one) so rebalance moves survive the branch dance.
  const noteRelPaths = listIntegratedNotes(ctx.projectRoot).map((n) => n.relPath);
  // Discover may idempotently migrate legacy repos with these managed contracts.
  // Snapshot and commit only managed files, never arbitrary user agent contracts.
  const managedRuntimePaths = [
    '.milkie/agents.json',
    'agents/researcher-collect.md',
    'agents/researcher-triage.md',
  ];
  const candidatePaths = [
    ...noteRelPaths,
    LANDSCAPE,
    'README.md',
    'report.md',
    'papers/README.md',
    ...listFilesRecursive(join(ctx.projectRoot, '.researcher-workspace'), '.researcher-workspace'),
    '.researcher/project.yaml',
    '.researcher/thesis.md',
    '.researcher/.gitignore',
    ...managedRuntimePaths,
  ];
  const currentNoteRels = new Set(noteRelPaths.concat(LANDSCAPE));
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
  //    #77: never stashDrop until the branch dance succeeds; on failure restore base + stash pop.
  const baseBranch = await gitops.getCurrentBranch({ cwd: ctx.projectRoot });
  // Branch name = the note filename (without .md). Readable PR titles when the
  // user opens a PR via the GitHub UI; collisions are blocked by seen.jsonl.
  const branch = `researcher/${newNoteFilename.replace(/\.md$/, '')}`;
  const stashMsg = `researcher-pkg-${ctx.runDir.id}`;
  let stashed = false;
  try {
    stashed = await gitops.stash({ cwd: ctx.projectRoot, message: stashMsg });
    await gitops.checkout({ cwd: ctx.projectRoot, branch: 'main' });
    await gitops.pullFastForward({ cwd: ctx.projectRoot, branch: 'main', remote: ctx.pushRemote });
    await gitops.createBranch({ cwd: ctx.projectRoot, branch });
    if (stashed) {
      await gitops.stashDrop({ cwd: ctx.projectRoot });
      stashed = false;
    }
  } catch (err) {
    await recoverPackageBranchDance({
      cwd: ctx.projectRoot,
      baseBranch,
      stashed,
    });
    throw err;
  }

  // 4a. remove note files that exist on main's tree but were relocated this run.
  //     listIntegratedNotes reads the current working tree (now on main's state), so it sees the old paths.
  //     Any path not in currentNoteRels was moved away by rebalance; delete it so the note
  //     doesn't appear at two locations after we restore snapshots.
  for (const stale of listIntegratedNotes(ctx.projectRoot).map((n) => n.relPath)) {
    if (!currentNoteRels.has(stale)) {
      const abs = join(ctx.projectRoot, stale);
      if (existsSync(abs)) rmSync(abs);
    }
  }

  // 4b. restore snapshots — everything except state files. State gets the cumulative content
  //     plus this run's append below.
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
      source: addSourceId.startsWith('arxiv:') ? 'arxiv' : 'url',
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
  // Use 'notes' directory (not per-file paths) so git add -A covers both new and deleted note
  // paths produced by rebalance moves. filter by existsSync for optional paths.
  const researchPaths = [
    'notes',
    'README.md',
    'report.md',
    'papers/README.md',
    '.researcher-workspace',
    '.researcher/project.yaml',
    '.researcher/thesis.md',
    '.researcher/.gitignore',
    ...managedRuntimePaths,
  ].filter((p) => existsSync(join(ctx.projectRoot, p)));
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

function listFilesRecursive(absDir: string, relDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = `${relDir}/${name}`;
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

/**
 * After a failed branch dance: return to the pre-package branch and restore the stash
 * if we still hold one. Best-effort — rethrows nothing; caller rethrows the original error.
 * Exported for tests that inject mid-dance failures.
 */
export async function recoverPackageBranchDance(o: {
  cwd: string;
  baseBranch: string;
  stashed: boolean;
}): Promise<void> {
  try {
    const cur = await gitops.getCurrentBranch({ cwd: o.cwd });
    if (cur !== o.baseBranch) {
      await gitops.checkout({ cwd: o.cwd, branch: o.baseBranch });
    }
  } catch {
    /* best-effort */
  }
  if (o.stashed) {
    try {
      await gitops.stashPop({ cwd: o.cwd });
    } catch {
      /* leave stash for the user rather than drop */
    }
  }
}
