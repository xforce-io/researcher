import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { runAdd } from '../../src/commands/add.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { registerAddInWorkspaceLibrary } from '../../src/pipeline/library_add_register.js';
import { PaperLibrary } from '../../src/library/store.js';
import { loadLibraryPaper } from '../../src/web/discovery.js';
import { renderLibraryPaper } from '../../src/web/views.js';
import { writeTextCache } from '../../src/sources/cache.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async (id: string) => ({
    id,
    title: 'Stub Paper For Library',
    authors: ['A'],
    abstract: 'abstract',
    abs_url: 'https://arxiv.org/abs/2401.55555',
    pdf_url: 'https://arxiv.org/pdf/2401.55555',
  }),
}));

class SilentAdapter implements AgentRuntime {
  id = 'silent';
  async invoke(): Promise<InvokeResult> {
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

const NOTE = `---
zone: active
tags: []
pin: false
score: 0
dwell: 0
---
# Recuris Memory

## Claims

- working memory grounds skill use.
`;

describe('registerAddInWorkspaceLibrary (#164)', () => {
  let home: string;
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'r-home-'));
    process.env.RESEARCHER_HOME = home;
    await runMethodologyInstall();
  });

  it('registers paper, topic link, and a completed read artifact after workspace add', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'r-ws-add-'));
    writeFileSync(join(ws, 'researcher.workspace.yml'),
      'version: 1\ntopics:\n  - { path: trace, active: true }\n');
    const topic = join(ws, 'trace');
    mkdirSync(topic, { recursive: true });
    execaSync('git', ['init', '-b', 'main'], { cwd: topic });
    await runInit({ targetDir: topic });
    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new SilentAdapter(),
      runDir: rd,
      addSourceId: 'arxiv:2401.55555',
    });
    ctx.newNoteFilename = '24_recuris_memory.md';
    ctx.newNoteRelPath = 'notes/active/24_recuris_memory.md';
    ctx.newNoteContent = NOTE;
    ctx.triageReason = 'manual feed via researcher add';

    registerAddInWorkspaceLibrary(ctx);

    const paperId = 'paper_arxiv_2401_55555';
    const lib = new PaperLibrary(ws);
    expect(lib.listPapers().filter((p) => p.id === paperId)).toHaveLength(1);
    expect(lib.listLinks(paperId)).toEqual([
      expect.objectContaining({
        paperId,
        surfaceType: 'topic',
        surfaceId: 'trace',
      }),
    ]);
    expect(lib.listReads(paperId)).toEqual([
      expect.objectContaining({ paperId, status: 'read' }),
    ]);

    const detail = loadLibraryPaper(ws, paperId);
    expect(detail).not.toBeNull();
    expect(detail!.paper.readStatus).not.toBe('unread');
    expect(detail!.latestReadArtifact?.markdown).toContain('working memory grounds skill use');
    const html = renderLibraryPaper(detail!);
    expect(html).not.toContain('No deep-read artifact yet');
    expect(html).not.toMatch(/class="status-badge unread"/);
    expect(html).toContain('trace');
  });

  it('is a no-op for a standalone topic repo', async () => {
    const topic = mkdtempSync(join(tmpdir(), 'r-solo-add-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: topic });
    await runInit({ targetDir: topic });
    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new SilentAdapter(),
      runDir: rd,
      addSourceId: 'arxiv:2401.55555',
    });
    ctx.newNoteFilename = '01_x.md';
    ctx.newNoteRelPath = 'notes/active/01_x.md';
    ctx.newNoteContent = NOTE;

    registerAddInWorkspaceLibrary(ctx);

    expect(new PaperLibrary(topic).listPapers()).toEqual([]);
  });

  it('runAdd on a workspace topic records Library paper, link, and non-unread detail (#164 S1–S3)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'r-ws-runadd-'));
    writeFileSync(join(ws, 'researcher.workspace.yml'),
      'version: 1\ntopics:\n  - { path: trace, active: true }\n');
    const topic = join(ws, 'trace');
    mkdirSync(topic, { recursive: true });
    execaSync('git', ['init', '-b', 'main'], { cwd: topic });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: topic });
    execaSync('git', ['config', 'user.name', 't'], { cwd: topic });
    await runInit({ targetDir: topic });
    execaSync('git', ['add', '.researcher', '.milkie', 'agents', '.gitignore'], { cwd: topic });
    execaSync('git', ['commit', '-m', 'init'], { cwd: topic });
    writeTextCache('2401.55555', 'CACHED PAPER BODY FOR ADD');

    const adapter: AgentRuntime = {
      id: 'add-stub',
      async invoke(opts: InvokeOptions): Promise<InvokeResult> {
        const noteFile = /Write a single new file at `(notes\/[^`]+)`/.exec(opts.userPrompt);
        if (noteFile) {
          mkdirSync(join(opts.cwd, noteFile[1], '..'), { recursive: true });
          writeFileSync(join(opts.cwd, noteFile[1]), NOTE);
          return { output: 'ok', modifiedFiles: [noteFile[1]], exitCode: 0 };
        }
        if (opts.userPrompt.includes('notes/00_research_landscape.md') || opts.userPrompt.includes('synthesis')) {
          const landscape = join(opts.cwd, 'notes/00_research_landscape.md');
          mkdirSync(join(opts.cwd, 'notes'), { recursive: true });
          const prev = existsSync(landscape) ? readFileSync(landscape, 'utf8') : '# Research landscape\n';
          writeFileSync(landscape, `${prev}\n- new entry\n`);
          const cm = /`([^`]+contradictions\.md)`/.exec(opts.userPrompt);
          if (cm) {
            mkdirSync(join(cm[1], '..'), { recursive: true });
            writeFileSync(cm[1], 'none\n');
          }
          return { output: 'ok', modifiedFiles: [], exitCode: 0 };
        }
        const summary = /`([^`]+run-summary\.md)`/.exec(opts.userPrompt);
        if (summary) {
          mkdirSync(join(summary[1], '..'), { recursive: true });
          writeFileSync(summary[1], '## Run summary\n\n## Devil\'s-advocate pass\n\n## Confidence labels\n\n## What would change my mind\n');
          return { output: 'ok', modifiedFiles: [], exitCode: 0 };
        }
        throw new Error(`unexpected add-stage prompt:\n${opts.userPrompt.slice(0, 200)}`);
      },
    };

    await runAdd({ cwd: topic, input: '2401.55555', adapter });

    const paperId = 'paper_arxiv_2401_55555';
    const lib = new PaperLibrary(ws);
    expect(lib.listPapers().filter((p) => p.id === paperId)).toHaveLength(1);
    expect(lib.listLinks(paperId).filter((l) => l.surfaceType === 'topic' && l.surfaceId === 'trace')).toHaveLength(1);
    const detail = loadLibraryPaper(ws, paperId)!;
    expect(detail.paper.readStatus).not.toBe('unread');
    const html = renderLibraryPaper(detail);
    expect(html).not.toContain('No deep-read artifact yet');
    expect(html).not.toMatch(/class="status-badge unread"/);
  });
});
