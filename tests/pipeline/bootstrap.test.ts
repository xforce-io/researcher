import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { ClaudeCodeAdapter } from '../../src/adapter/claude-code.js';
import { newRunId, RunDir } from '../../src/state/runs.js';

describe('bootstrap stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-bs-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
  });
  it('loads yaml + thesis + 7 methodology files', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new ClaudeCodeAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    expect(ctx.projectYaml.research_questions.length).toBeGreaterThan(0);
    expect(ctx.thesis.sections.has('Working thesis')).toBe(true);
    expect(ctx.methodology.size).toBe(7);
  });
});
