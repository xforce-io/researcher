import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

vi.mock('../../src/sources/url-fetch.js', async (orig) => ({
  ...(await orig() as object),
  fetchUrlMaterial: async () => ({
    title: 'Internal Design Doc',
    text: 'We chose event sourcing for the audit log. Tradeoff: complexity vs replayability.',
    contentType: 'text/html',
    docType: 'design-doc' as const,
    url: 'https://example.com/design/event-sourcing',
  }),
}));

class StubAdapter implements AgentRuntime {
  id = 'stub';
  lastPrompt = '';
  lastMaxTokens: number | undefined;
  lastTimeoutMs: number | undefined;

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.lastPrompt = opts.userPrompt;
    this.lastMaxTokens = opts.maxTokens;
    this.lastTimeoutMs = opts.timeoutMs;
    return {
      output: [
        '# Library Read Paper',
        '',
        '> Frame.',
        '',
        '## Brief',
        '',
        'This is the brief.',
        '',
        '## Claims',
        '',
        '- x',
        '',
        '## Assumptions',
        '',
        '- y',
        '',
        '## Method',
        '',
        '- z',
        '',
        '## Eval',
        '',
        '- e',
        '',
        '## Weaknesses',
        '',
        '- w',
        '',
        '## Relations',
        '',
        '- standalone [low]: test.',
      ].join('\n'),
      modifiedFiles: [],
      exitCode: 0,
    };
  }
}

class EmptyStubAdapter implements AgentRuntime {
  id = 'empty-stub';

  async invoke(): Promise<InvokeResult> {
    return { output: '', modifiedFiles: [], exitCode: 0 };
  }
}

class TruncatedStubAdapter implements AgentRuntime {
  id = 'truncated-stub';

  async invoke(): Promise<InvokeResult> {
    return { output: '', modifiedFiles: [], exitCode: 0, finishReason: 'length' };
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
    expect(adapter.lastPrompt).toContain('None. Read this source as a standalone Library artifact.');
    expect(adapter.lastPrompt).toContain('CACHED PAPER BODY');
    expect(adapter.lastPrompt).toContain('title: "Library Read Paper"');
    expect(adapter.lastPrompt).toContain('authors: ["A"]');
    expect(adapter.lastPrompt).toContain('paper_id: "paper_arxiv_2401_12345"');
    expect(adapter.lastPrompt).toContain('source_kind: "arxiv"');
    expect(adapter.lastPrompt).toContain('source_id: "arxiv:2401.12345"');
    expect(adapter.lastPrompt).toContain('source_url: "https://arxiv.org/abs/2401.12345"');
    expect(adapter.lastPrompt).toContain('pdf_url: "https://arxiv.org/pdf/2401.12345"');
    expect(adapter.lastPrompt).toContain('read_id: "read_paper_arxiv_2401_12345"');
    const artifact = join(root, result.artifactPath);
    expect(existsSync(artifact)).toBe(true);
    const body = readFileSync(artifact, 'utf8');
    expect(body).toContain('kind: library-read');
    expect(body).toContain('title: "Library Read Paper"');
    expect(body).toContain('## Brief');
    expect(body).toContain('- x');
    expect(adapter.lastMaxTokens).toBeGreaterThan(4096);
    expect(adapter.lastTimeoutMs).toBeGreaterThan(0);
    expect(adapter.lastPrompt).toContain('Return only the Markdown artifact body');
    expect(adapter.lastPrompt).not.toContain('run_command');
    expect(adapter.lastPrompt).not.toContain('FILES_MODIFIED:\n');
    expect(adapter.lastPrompt.indexOf('## Brief')).toBeLessThan(adapter.lastPrompt.indexOf('## Claims'));
    expect(existsSync(join(root, '.milkie/agents.json'))).toBe(true);
    expect(existsSync(join(root, 'agents/researcher.md'))).toBe(true);
  });

  it('fails when a completed agent run returns no artifact content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rsw-lib-read-missing-'));
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeTextCache('2401.12345', 'CACHED PAPER BODY');
    const paper: Paper = {
      id: 'paper_arxiv_2401_12345',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' }],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    await expect(runLibraryRead({
      workspaceRoot: root,
      paper,
      readId: 'read_paper_arxiv_2401_12345',
      adapter: new EmptyStubAdapter(),
    })).rejects.toThrow('produced no Library read content');
  });

  it('fails clearly when the model output is truncated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rsw-lib-read-truncated-'));
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeTextCache('2401.12345', 'CACHED PAPER BODY');
    const paper: Paper = {
      id: 'paper_arxiv_2401_12345',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' }],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    await expect(runLibraryRead({
      workspaceRoot: root,
      paper,
      readId: 'read_paper_arxiv_2401_12345',
      adapter: new TruncatedStubAdapter(),
    })).rejects.toThrow('truncated');
  });

  it('deep-reads a URL document with runner-owned text and non-paper sections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rsw-lib-read-doc-'));
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    const adapter = new StubAdapter();
    const paper: Paper = {
      id: 'paper_url_deadbeef',
      canonicalSource: {
        kind: 'url',
        id: 'url:https://example.com/design/event-sourcing',
        url: 'https://example.com/design/event-sourcing',
      },
      sources: [{
        kind: 'url',
        id: 'url:https://example.com/design/event-sourcing',
        url: 'https://example.com/design/event-sourcing',
      }],
      identifiers: { url: 'https://example.com/design/event-sourcing' },
      tags: [],
      docType: 'design-doc',
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    const result = await runLibraryRead({
      workspaceRoot: root,
      paper,
      readId: 'read_paper_url_deadbeef',
      adapter,
    });

    expect(adapter.lastPrompt).toContain('event sourcing');
    expect(adapter.lastPrompt).toContain('Key takeaways');
    expect(adapter.lastPrompt).not.toContain('## Eval');
    const body = readFileSync(join(root, result.artifactPath), 'utf8');
    expect(body).toContain('doc_type: "design-doc"');
    expect(body).toContain('kind: library-read');
    expect(result.title).toBe('Internal Design Doc');
  });

  it('emits fetch progress and draft-read heartbeats while waiting on the model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rsw-lib-read-hb-'));
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeTextCache('2401.12345', 'CACHED PAPER BODY');
    const lines: string[] = [];
    const paper: Paper = {
      id: 'paper_arxiv_2401_12345',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' }],
      identifiers: { arxiv: '2401.12345' },
      tags: [],
      createdAt: '2026-07-02T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
    };

    class SlowAdapter implements AgentRuntime {
      id = 'slow-stub';
      async invoke(): Promise<InvokeResult> {
        await new Promise((r) => setTimeout(r, 60));
        return {
          output: '# Library Read Paper\n\n> Frame.\n\n## Brief\n\nok\n\n## Claims\n\n- x\n\n## Assumptions\n\n- y\n\n## Method\n\n- z\n\n## Eval\n\n- e\n\n## Weaknesses\n\n- w\n\n## Relations\n\n- standalone [low]: test.\n',
          modifiedFiles: [],
          exitCode: 0,
        };
      }
    }

    await runLibraryRead({
      workspaceRoot: root,
      paper,
      readId: 'read_paper_arxiv_2401_12345',
      adapter: new SlowAdapter(),
      heartbeatMs: 20,
      onLine: (line) => lines.push(line),
    });

    expect(lines.some((l) => /fetch-source/i.test(l))).toBe(true);
    expect(lines.some((l) => /draft-read still waiting/i.test(l))).toBe(true);
  });
});
