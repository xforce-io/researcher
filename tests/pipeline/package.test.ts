import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
    process.env.RESEARCHER_NO_REMOTE = '1';
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // Commit only .researcher/ as the initial main-branch state.
    // notes/ are created uncommitted so the package stage actually commits them.
    execaSync('git', ['add', '.researcher'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
    writeFileSync(join(proj, 'notes/01_stub.md'), '# Stub');
  });
  it('refuses to run when working tree is dirty outside notes/, .researcher/, and the workshop docs', async () => {
    // Simulate a user with uncommitted edits in src/ — those must not get swept into the researcher PR.
    // Note: README.md and papers/README.md are workshop docs the agent maintains, so they ARE allowed.
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src/unrelated.ts'), 'export const x = 1;\n');
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
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
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
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

  it('produces 2 commits and updates state files', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
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
});
