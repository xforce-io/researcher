import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { registerAddInWorkspaceLibrary } from '../../src/pipeline/library_add_register.js';
import { PaperLibrary } from '../../src/library/store.js';
import { loadLibraryPaper } from '../../src/web/discovery.js';
import { renderLibraryPaper } from '../../src/web/views.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeResult } from '../../src/adapter/interface.js';

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
});
