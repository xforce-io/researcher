import { describe, it, expect, beforeEach } from 'vitest';
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
      relation: 'candidate',
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
    // Embedded library-read system frontmatter must not appear in the note body.
    expect(noteMd).not.toContain('paper_id');
    expect(noteMd).not.toContain('read_id');
    expect(noteMd).not.toContain('kind: library-read');
    expect(noteMd).not.toContain('source_kind');
    // Only the outer note fence + title once (no second H1 under Library read).
    expect(noteMd.match(/^---$/gm)?.length).toBe(2);
    expect(noteMd.match(/^# Timing Paper$/gm)?.length).toBe(1);

    const after = new PaperLibrary(root);
    expect(after.listIntegrations(paperId)).toEqual([]);
    expect(after.listLinks(paperId)).toEqual([
      expect.objectContaining({ surfaceId: 'trace', relation: 'candidate' }),
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
      relation: 'candidate',
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
      expect.objectContaining({ surfaceId: 'trace', relation: 'integrated' }),
    ]);
  });
});
