import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runLibraryRead } from '../../src/web/library-read.js';
import { writeTextCache } from '../../src/sources/cache.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';
import type { Paper } from '../../src/library/model.js';

vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async () => ({
    id: 'arxiv:2401.12345', title: 'Library Read Paper', authors: ['A'],
    abstract: 'abstract', abs_url: 'https://arxiv.org/abs/2401.12345', pdf_url: 'https://arxiv.org/pdf/2401.12345',
  }),
}));

class StubAdapter implements AgentRuntime {
  id = 'stub';
  lastPrompt = '';

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.lastPrompt = opts.userPrompt;
    const match = /Write a single new file at `([^`]+)`/.exec(opts.userPrompt);
    const artifact = match?.[1] ?? '.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md';
    mkdirSync(dirname(join(opts.cwd, artifact)), { recursive: true });
    writeFileSync(join(opts.cwd, artifact), '# Library read\n\n## Claims\n- x');
    return { output: `done\n\nFILES_MODIFIED:\n${artifact}\n`, modifiedFiles: [artifact], exitCode: 0 };
  }
}

describe('runLibraryRead', () => {
  it('writes a standalone workspace library read without topic context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rsw-lib-read-'));
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeTextCache('2401.12345', 'CACHED PAPER BODY');
    const adapter = new StubAdapter();
    const paper: Paper = {
      id: 'paper_arxiv_2401_12345',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' }],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    const result = await runLibraryRead({
      workspaceRoot: root,
      paper,
      readId: 'read_paper_arxiv_2401_12345',
      adapter,
    });

    expect(result.artifactPath).toBe('.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md');
    expect(adapter.lastPrompt).toContain('None. Read this paper as a standalone Library artifact.');
    expect(adapter.lastPrompt).toContain('CACHED PAPER BODY');
  });
});
