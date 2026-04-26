import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { synthesize } from '../../src/pipeline/synthesize.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    writeFileSync(join(opts.cwd, 'notes/00_research_landscape.md'), '# Updated landscape\n\n[1] Stub Paper\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('synthesize stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-syn-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty landscape\n');
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });
  it('updates landscape and records diff', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    ctx.newNoteFilename = '01_stub.md';
    ctx.newNoteContent = '# Stub';
    writeFileSync(join(proj, 'notes/01_stub.md'), '# Stub');
    await synthesize(ctx);
    expect(ctx.landscapeDiff).toContain('Updated landscape');
    expect(readFileSync(join(proj, 'notes/00_research_landscape.md'), 'utf8')).toContain('Stub Paper');
  });
});
