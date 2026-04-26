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
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
    writeFileSync(join(proj, 'notes/01_stub.md'), '# Stub');
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
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
