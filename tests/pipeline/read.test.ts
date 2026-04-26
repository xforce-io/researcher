import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { read } from '../../src/pipeline/read.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const noteContent = '# Stub note\n\n## Claims\n- something';
    writeFileSync(join(opts.cwd, 'notes', '01_stub_paper.md'), noteContent);
    return { output: 'done\n\nFILES_MODIFIED:\nnotes/01_stub_paper.md\n', modifiedFiles: ['notes/01_stub_paper.md'], exitCode: 0 };
  }
}

vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async () => ({
    id: 'arxiv:2401.00001', title: 'Stub Paper', authors: ['A'],
    abstract: 'abstract', abs_url: 'x', pdf_url: 'y',
  }),
}));

describe('read stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-read-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
  });
  it('writes a note file and records it in context', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addArxivId: 'arxiv:2401.00001' });
    await read(ctx);
    expect(ctx.newNoteFilename).toBe('01_stub_paper.md');
    expect(ctx.newNoteContent).toContain('Claims');
  });
});
