import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { libraryTopicRead } from '../../src/pipeline/library_topic_read.js';
import { finalizeLibraryIntegration } from '../../src/pipeline/library_topic_read.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import { PaperLibrary } from '../../src/library/store.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';
import type { LibraryReadRunner } from '../../src/web/library-read.js';

const defaultLibraryReadRunner = vi.hoisted(() =>
  vi.fn<LibraryReadRunner>(async ({ workspaceRoot, paper, readId }) => {
    const artifactPath = `.researcher-workspace/library/papers/${paper.id}/reads/${readId}.md`;
    mkdirSync(join(workspaceRoot, '.researcher-workspace/library/papers', paper.id, 'reads'), {
      recursive: true,
    });
    writeFileSync(join(workspaceRoot, artifactPath), '# Lib\n\nbody\n');
    return { artifactPath, title: 'Timing Paper' };
  }),
);

vi.mock('../../src/web/library-read.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/web/library-read.js')>();
  return {
    ...actual,
    defaultLibraryReadRunner,
  };
});

class SilentAdapter implements AgentRuntime {
  id = 'silent';
  async invoke(_opts: InvokeOptions): Promise<InvokeResult> {
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('libraryTopicRead integration timing', () => {
  let root: string;
  let topic: string;

  const paperId = 'paper_arxiv_2401_55555';
  const sourceId = 'arxiv:2401.55555';

  function fakeLibraryRead(body = '# Lib\n\nbody\n'): LibraryReadRunner {
    return async ({ workspaceRoot, paper, readId }) => {
      const artifactPath = `.researcher-workspace/library/papers/${paper.id}/reads/${readId}.md`;
      mkdirSync(join(workspaceRoot, '.researcher-workspace/library/papers', paper.id, 'reads'), { recursive: true });
      writeFileSync(join(workspaceRoot, artifactPath), body);
      return { artifactPath, title: 'Timing Paper' };
    };
  }

  const fullLibraryArtifact = [
    '---',
    'title: "Timing Paper"',
    'authors: ["Ada"]',
    'paper_id: "paper_arxiv_2401_55555"',
    'source_kind: "arxiv"',
    'source_id: "arxiv:2401.55555"',
    'source_url: "https://arxiv.org/abs/2401.55555"',
    'pdf_url: "https://arxiv.org/pdf/2401.55555"',
    'read_id: "read_paper_arxiv_2401_55555"',
    'kind: library-read',
    'doc_type: "paper"',
    'tags: []',
    '---',
    '',
    '# Timing Paper',
    '',
    '> frame lede',
    '',
    '## Essence',
    '',
    'body',
    '',
  ].join('\n');

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-ltr-'));
    topic = join(root, 'trace');
    mkdirSync(topic, { recursive: true });
    execaSync('git', ['init', '-b', 'main'], { cwd: topic });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: topic });
    execaSync('git', ['config', 'user.name', 't'], { cwd: topic });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: topic });
    await runMethodologyInstall();
    mkdirSync(join(topic, 'notes/active'), { recursive: true });
    writeFileSync(join(topic, 'notes/00_research_landscape.md'), '# Empty\n');
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: trace, active: true }\n');
  });

  it('writes the topic note but does not mark Library integrated before landscape synthesize', async () => {
    const lib = new PaperLibrary(root);
    lib.upsertPaper({
      id: paperId,
      canonicalSource: { kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Timing Paper',
      tags: [],
    });
    lib.upsertLink({
      paperId,
      surfaceType: 'topic',
      surfaceId: 'trace',
      rationale: 'pre-linked',
    });

    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new SilentAdapter(),
      runDir: rd,
      addSourceId: sourceId,
    });
    ctx.triageReason = 'library-linked candidate (not yet in landscape)';

    await libraryTopicRead(ctx, {
      workspaceRoot: root,
      topicPath: 'trace',
      libraryReadRunner: fakeLibraryRead(fullLibraryArtifact),
    });

    expect(ctx.newNoteRelPath).toMatch(/^notes\/active\/\d+_timing_paper\.md$/);
    expect(existsSync(join(topic, ctx.newNoteRelPath!))).toBe(true);
    expect(readFileSync(join(topic, ctx.newNoteRelPath!), 'utf8')).toContain('body');
    const noteMd = readFileSync(join(topic, ctx.newNoteRelPath!), 'utf8');
    expect(noteMd).toContain('## Library read');
    expect(noteMd).toContain('> frame lede');
    expect(noteMd).toContain('## Essence');
    // Compact identity kept; system frontmatter keys must not appear.
    expect(noteMd).toContain('kind: library-read-identity');
    expect(noteMd).toContain('authors: ["Ada"]');
    expect(noteMd).toContain('source_id: "arxiv:2401.55555"');
    expect(noteMd).toContain('pdf_url: "https://arxiv.org/pdf/2401.55555"');
    expect(noteMd).not.toContain('paper_id');
    expect(noteMd).not.toContain('read_id');
    expect(noteMd).not.toContain('kind: library-read\n');
    expect(noteMd).not.toContain('source_kind');
    expect(noteMd).not.toContain('doc_type');
    // Outer note fence + compact identity fence; title once.
    expect(noteMd.match(/^---$/gm)?.length).toBe(4);
    expect(noteMd.match(/^# Timing Paper$/gm)?.length).toBe(1);

    const after = new PaperLibrary(root);
    expect(after.listIntegrations(paperId)).toEqual([]);
    expect(after.listLinks(paperId)).toEqual([
      expect.objectContaining({ surfaceId: 'trace' }),
    ]);
  });

  it('finalizeLibraryIntegration marks integrated only when called after successful synthesize', async () => {
    const lib = new PaperLibrary(root);
    lib.upsertPaper({
      id: paperId,
      canonicalSource: { kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Timing Paper',
      tags: [],
    });
    lib.upsertLink({
      paperId,
      surfaceType: 'topic',
      surfaceId: 'trace',
    });

    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new SilentAdapter(),
      runDir: rd,
      addSourceId: sourceId,
    });
    ctx.triageReason = 'ready for landscape';
    await libraryTopicRead(ctx, {
      workspaceRoot: root,
      topicPath: 'trace',
      libraryReadRunner: fakeLibraryRead(),
    });
    expect(new PaperLibrary(root).listIntegrations(paperId)).toEqual([]);

    finalizeLibraryIntegration(ctx, { workspaceRoot: root, topicPath: 'trace' });

    const after = new PaperLibrary(root);
    expect(after.listIntegrations(paperId)).toEqual([
      expect.objectContaining({
        paperId,
        topicId: 'trace',
        notePath: ctx.newNoteRelPath,
        zone: 'active',
        summary: 'ready for landscape',
      }),
    ]);
    expect(after.listLinks(paperId)).toEqual([
      expect.objectContaining({ surfaceId: 'trace' }),
    ]);
  });

  it('defaults library-read to OpenAI runner, not topic runtime adapter (#136)', async () => {
    defaultLibraryReadRunner.mockClear();
    let topicAdapterCalls = 0;
    class TopicRuntimeAdapter implements AgentRuntime {
      id = 'topic-runtime-spy';
      async invoke(_opts: InvokeOptions): Promise<InvokeResult> {
        topicAdapterCalls += 1;
        throw new Error('topic runtime must not run library-read');
      }
    }

    const lib = new PaperLibrary(root);
    lib.upsertPaper({
      id: paperId,
      canonicalSource: { kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Timing Paper',
      tags: [],
    });

    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new TopicRuntimeAdapter(),
      runDir: rd,
      addSourceId: sourceId,
    });

    await libraryTopicRead(ctx, {
      workspaceRoot: root,
      topicPath: 'trace',
      // no libraryReadRunner — production default path
    });

    expect(topicAdapterCalls).toBe(0);
    expect(defaultLibraryReadRunner).toHaveBeenCalledTimes(1);
    expect(existsSync(join(topic, ctx.newNoteRelPath!))).toBe(true);
  });

  it('persists lastError when library-read fails (#136)', async () => {
    const lib = new PaperLibrary(root);
    lib.upsertPaper({
      id: paperId,
      canonicalSource: { kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: sourceId, url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Timing Paper',
      tags: [],
    });

    const rd = new RunDir(join(topic, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: topic,
      adapter: new SilentAdapter(),
      runDir: rd,
      addSourceId: sourceId,
    });

    await expect(
      libraryTopicRead(ctx, {
        workspaceRoot: root,
        topicPath: 'trace',
        libraryReadRunner: async () => {
          throw new Error('library read agent exited 1 [GROK_CLI_TIMEOUT]: Grok CLI timed out.');
        },
      }),
    ).rejects.toThrow(/GROK_CLI_TIMEOUT|timed out/i);

    const failed = new PaperLibrary(root).listReads(paperId).find((r) => r.status === 'failed');
    expect(failed?.lastError).toMatch(/GROK_CLI_TIMEOUT|timed out/i);
  });
});
