import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { packageStage } from '../../src/pipeline/package.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    writeFileSync(opts.cwd + '/.researcher/state/runs/RUN/run-summary.md', '# summary');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('package stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-pkg-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    // delivery.mode defaults to local, so the package stage commits without push/PR.
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // Commit project config + milkie provider config as the initial main-branch state.
    // notes/ are created uncommitted so the package stage actually commits them.
    execaSync('git', ['add', '.researcher', '.milkie', 'agents'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes', 'active'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
    writeFileSync(join(proj, 'notes/active/01_stub.md'), '# Stub');
  });
  it('refuses to run when working tree is dirty outside notes/, .researcher/, and the workshop docs', async () => {
    // Simulate a user with uncommitted edits in src/ — those must not get swept into the researcher PR.
    // Note: README.md and papers/README.md are workshop docs the agent maintains, so they ARE allowed.
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src/unrelated.ts'), 'export const x = 1;\n');
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteRelPath = 'notes/active/01_stub.md';
    ctx.newNoteContent = '# Stub';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');

    await expect(packageStage(ctx)).rejects.toThrow(/working tree|dirty|uncommitted/i);
  });

  it('allows README.md and papers/README.md to be dirty (synthesize maintains them)', async () => {
    // Synthesize edits these workshop docs; the package stage must not flag them.
    writeFileSync(join(proj, 'README.md'), '# Topic\n\n| # | paper |\n|---|---|\n| 9 | new |\n');
    mkdirSync(join(proj, 'papers'), { recursive: true });
    writeFileSync(join(proj, 'papers/README.md'), '| # | paper |\n|---|---|\n| 9 | new |\n');
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteRelPath = 'notes/active/01_stub.md';
    ctx.newNoteContent = '# Stub';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });

    await packageStage(ctx); // must NOT throw

    // README + papers/README rode in alongside the research commit.
    const last = execaSync('git', ['show', '--stat', 'HEAD~1'], { cwd: proj }).stdout;
    expect(last).toContain('README.md');
    expect(last).toContain('papers/README.md');
  });

  it('forks the second paper branch from main, not from the previous paper branch', async () => {
    // Bug 2 regression: previously the new branch was created with `git checkout -b` from the
    // current HEAD, which after the first packageStage run is `researcher/01_stub`. The next
    // run would then stack on top of it, polluting the second PR with the first PR's commits.
    // Expected behaviour: each paper branch is rooted at main's tip.
    const rd1 = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx1 = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd1, addSourceId: 'arxiv:2401.00001' });
    ctx1.newNoteFilename = '01_stub.md';
    ctx1.newNoteRelPath = 'notes/active/01_stub.md';
    ctx1.newNoteContent = '# Stub';
    ctx1.landscapeDiff = '+stub';
    ctx1.contradictionsPath = rd1.path('contradictions.md');
    writeFileSync(ctx1.contradictionsPath, 'none');
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });
    await packageStage(ctx1);

    const mainTip = execaSync('git', ['rev-parse', 'main'], { cwd: proj }).stdout.trim();

    // Stage paper #2 in the working tree (still on researcher/01_stub branch).
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    writeFileSync(join(proj, 'notes/active/02_second.md'), '# Second');
    const rd2 = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx2 = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd2, addSourceId: 'arxiv:2401.00002' });
    ctx2.newNoteFilename = '02_second.md';
    ctx2.newNoteRelPath = 'notes/active/02_second.md';
    ctx2.newNoteContent = '# Second';
    ctx2.landscapeDiff = '+second';
    ctx2.contradictionsPath = rd2.path('contradictions.md');
    writeFileSync(ctx2.contradictionsPath, 'none');
    await packageStage(ctx2);

    // After fix: researcher/02_second has exactly 2 commits beyond main (research + state).
    const commitsAhead = execaSync('git', ['rev-list', '--count', `main..researcher/02_second`], { cwd: proj }).stdout.trim();
    expect(commitsAhead).toBe('2');

    // And researcher/02_second's "research" commit's parent IS main's tip.
    const researchCommitParent = execaSync('git', ['rev-parse', 'researcher/02_second^^'], { cwd: proj }).stdout.trim();
    expect(researchCommitParent).toBe(mainTip);
  });

  it('zone-dir notes from rebalance are allowed for the paper path (dirty check no longer rejects them)', async () => {
    // Post-fix: rebalance runs before synthesize/package on the paper path and may produce
    // additional zone-dir dirty files (moved/modified prior notes). The paper path now
    // allow-lists all note zone dirs so these legitimate rebalance outputs don't trip the
    // dirty check. A note at any notes/<zone>/ path is now accepted even if untracked.
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    writeFileSync(join(proj, 'notes/active/05_rebalanced_note.md'), '# Note written by rebalance');
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteRelPath = 'notes/active/01_stub.md';
    ctx.newNoteContent = '# Stub';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });

    // Must NOT throw: zone dirs are now allow-listed for the paper path too.
    await packageStage(ctx);
  });

  it('new note at notes/active/ survives packageStage and lands in the committed tree', async () => {
    // Regression for: candidatePaths used join('notes', newNoteFilename) instead of
    // ctx.newNoteRelPath, so the note was never snapshotted, never restored on the new
    // branch, and never committed — it was silently lost from disk.
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteRelPath = 'notes/active/01_stub.md';
    ctx.newNoteContent = '# Stub note content';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });
    // Overwrite the file with known content so we can confirm it was committed exactly.
    writeFileSync(join(proj, 'notes/active/01_stub.md'), '# Stub note content');

    await packageStage(ctx);

    // 1. File must exist on disk at the active/ path (not lost after branch dance).
    const { existsSync: fsExists } = await import('node:fs');
    expect(fsExists(join(proj, 'notes/active/01_stub.md'))).toBe(true);

    // 2. File must be in the research commit (HEAD~1, since HEAD is the state commit).
    const { execaSync: sync } = await import('execa');
    const treeContent = sync(
      'git', ['show', 'HEAD~1:notes/active/01_stub.md'],
      { cwd: proj }
    ).stdout;
    expect(treeContent).toContain('Stub note content');

    // 3. notes/active/01_stub.md must appear in the research commit's diff.
    const stat = sync('git', ['show', '--stat', 'HEAD~1'], { cwd: proj }).stdout;
    expect(stat).toContain('notes/active/01_stub.md');
  });

  it('produces 2 commits and updates state files', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteRelPath = 'notes/active/01_stub.md';
    ctx.newNoteContent = '# Stub';
    ctx.landscapeDiff = '+stub';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    // pre-create dir for stub adapter's hardcoded path:
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });

    await packageStage(ctx);

    // packageStage stays on the researcher branch after exit.
    // Branch name uses the note filename (not the runDir.id) for human-readable PR titles.
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toBe('researcher/01_stub');

    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout;
    const lines = log.split('\n').filter(Boolean);
    // before: 1 commit; after package: +2
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatch(/^[a-f0-9]+ state:/);
    expect(lines[1]).toMatch(/^[a-f0-9]+ research:/);
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.00001');
  });

  it('move-aware: rebalance-moved note lands at new zone path on researcher branch', async () => {
    // Regression for move-unawareness: before this fix, candidatePaths only contained the
    // current note, so a note moved by rebalance (e.g. active→history) was neither snapshotted
    // nor cleaned up. After the branch dance, the old path still existed on main's tree and the
    // new path was absent — the move was silently lost.
    //
    // Setup: commit landscape + 01_stub.md (the "old" note) to main so it appears in
    // main's working tree during the branch dance.
    execaSync('git', ['add', 'notes'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'add initial note'], { cwd: proj });

    // Simulate rebalance: move 01_stub.md from active → history, update zone frontmatter.
    mkdirSync(join(proj, 'notes', 'history'), { recursive: true });
    writeFileSync(
      join(proj, 'notes/history/01_stub.md'),
      '---\nzone: history\npin: false\nscore: 0\ndwell: 0\n---\n# Stub\n',
    );
    rmSync(join(proj, 'notes/active/01_stub.md'));

    // The new note being packaged this run.
    writeFileSync(
      join(proj, 'notes/active/02_new.md'),
      '---\nzone: active\npin: false\nscore: 0\ndwell: 0\n---\n# New note\n',
    );

    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00002' });
    ctx.newNoteFilename = '02_new.md';
    ctx.newNoteRelPath = 'notes/active/02_new.md';
    ctx.newNoteContent = '# New note';
    ctx.landscapeDiff = '+new';
    ctx.contradictionsPath = rd.path('contradictions.md');
    writeFileSync(ctx.contradictionsPath, 'none');
    mkdirSync(join(proj, '.researcher/state/runs/RUN'), { recursive: true });

    await packageStage(ctx);

    // On-disk: moved note must exist at the new path, NOT the old path.
    expect(existsSync(join(proj, 'notes/history/01_stub.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/active/01_stub.md'))).toBe(false);

    // In the research commit tree: new path present, old path absent.
    const committedFiles = execaSync('git', ['ls-tree', '-r', '--name-only', 'HEAD~1'], { cwd: proj }).stdout;
    expect(committedFiles).toContain('notes/history/01_stub.md');
    expect(committedFiles).not.toContain('notes/active/01_stub.md');
    // The new note for this run is also committed.
    expect(committedFiles).toContain('notes/active/02_new.md');
  });
});
