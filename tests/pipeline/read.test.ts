import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { read } from '../../src/pipeline/read.js';
import { writeTextCache } from '../../src/sources/cache.js';
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
    const ctx = await bootstrap({ projectRoot: proj, adapter: new StubAdapter(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    await read(ctx);
    expect(ctx.newNoteFilename).toBe('01_stub_paper.md');
    expect(ctx.newNoteContent).toContain('Claims');
  });

  it('computes 01_ for a fresh topic with no notes/ dir yet', async () => {
    // brand-new pillar repo: no notes/ directory until the first note is written
    rmSync(join(proj, 'notes'), { recursive: true, force: true });
    class FreshStub implements AgentRuntime {
      id = 'fresh';
      async invoke(opts: InvokeOptions): Promise<InvokeResult> {
        mkdirSync(join(opts.cwd, 'notes'), { recursive: true });
        writeFileSync(join(opts.cwd, 'notes', '01_stub_paper.md'), '# n\n\n## Claims\n- x');
        return { output: 'done', modifiedFiles: ['notes/01_stub_paper.md'], exitCode: 0 };
      }
    }
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter: new FreshStub(), runDir: rd, addSourceId: 'arxiv:2401.00001' });
    await read(ctx);
    expect(ctx.newNoteFilename).toBe('01_stub_paper.md');
  });

  it('uses cached paper text instead of refetching when cache is warm', async () => {
    writeTextCache('2401.00001', 'CACHED PDF BODY MARKER');

    class CapturingAdapter implements AgentRuntime {
      id = 'capture';
      lastPrompt = '';
      async invoke(opts: InvokeOptions): Promise<InvokeResult> {
        this.lastPrompt = opts.userPrompt;
        const noteContent = '# Stub note\n\n## Claims\n- something';
        writeFileSync(join(opts.cwd, 'notes', '01_stub_paper.md'), noteContent);
        return { output: 'done\n\nFILES_MODIFIED:\nnotes/01_stub_paper.md\n', modifiedFiles: ['notes/01_stub_paper.md'], exitCode: 0 };
      }
    }
    const adapter = new CapturingAdapter();
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd, addSourceId: 'arxiv:2401.00001' });
    await read(ctx);
    expect(adapter.lastPrompt).toContain('CACHED PDF BODY MARKER');
  });

  it('renders source_fetch_instruction and url-derived slug for url: source', async () => {
    class CapturingAdapter implements AgentRuntime {
      id = 'capture-url';
      lastPrompt = '';
      async invoke(opts: InvokeOptions): Promise<InvokeResult> {
        this.lastPrompt = opts.userPrompt;
        // The read stage reads back the file the agent is supposed to write.
        // Mirror the filename it computes from the url path slug.
        const noteContent = '# Autodata\n\n## Claims\n- something';
        writeFileSync(join(opts.cwd, 'notes', '01_autodata.md'), noteContent);
        return { output: 'done\n\nFILES_MODIFIED:\nnotes/01_autodata.md\n', modifiedFiles: ['notes/01_autodata.md'], exitCode: 0 };
      }
    }
    const adapter = new CapturingAdapter();
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter,
      runDir: rd,
      addSourceId: 'url:https://facebookresearch.github.io/RAM/blogs/autodata/',
    });
    await read(ctx);
    expect(adapter.lastPrompt).toContain('### Source acquisition');
    expect(adapter.lastPrompt).toContain('https://facebookresearch.github.io/RAM/blogs/autodata/');
    expect(ctx.newNoteFilename).toBe('01_autodata.md');
  });

});
