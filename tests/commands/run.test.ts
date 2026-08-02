import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import type { Triaged } from '../../src/config/triaged.js';
import { RUN_IPC_ENV } from '../../src/pipeline/events.js';
import { PaperLibrary } from '../../src/library/store.js';
import type { LibraryReadRunner } from '../../src/web/library-read.js';

// The read stage calls fetchArxivMetadata against the real network.
// In run tests the deep-read pick is a synthetic id; stub the metadata fetch
// (and the PDF download) so the stage runs offline.
vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async (id: string) => ({
    id,
    title: 'stub',
    authors: ['Test'],
    abstract: 'stubbed abstract',
    abs_url: `https://arxiv.org/abs/${id.replace(/^arxiv:/, '')}`,
    pdf_url: `https://arxiv.org/pdf/${id.replace(/^arxiv:/, '')}`,
  }),
}));

// We import runRun *inside* tests after monkey-patching the adapter module so
// that the real MilkieAdapter never gets instantiated.
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class ScriptedAdapter implements AgentRuntime {
  id = 'scripted';
  callCount = 0;
  constructor(private readonly script: Array<(opts: InvokeOptions) => InvokeResult | Promise<InvokeResult>>) {}
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    const step = this.script[this.callCount++];
    if (!step) throw new Error(`scripted adapter ran out of steps at call ${this.callCount}`);
    return step(opts);
  }
}

const triagedDeepRead: Triaged = {
  candidates: [
    {
      id: 'arxiv:2401.55555',
      title: 'Auto-picked deep read',
      url: 'https://arxiv.org/abs/2401.55555',
      source: 'arxiv',
      decision: 'deep-read',
      axes: { relevance: 3, alignment: 'extends', novelty: 'substantial', gravity: 'medium' },
      reason: 'RQ1: extends — exactly addresses RQ1',
    },
    {
      id: 'arxiv:2401.66666',
      title: 'Skim only',
      source: 'arxiv',
      decision: 'skim',
      axes: { relevance: 1, alignment: 'orthogonal', novelty: 'incremental', gravity: 'low' },
      reason: 'no RQ: skim — tangential',
    },
  ],
  search_summary: '2 searches, 5 candidates, 1 deep-read',
};

const triagedEmpty: Triaged = { candidates: [], search_summary: 'nothing relevant' };

function soulStep(): (opts: InvokeOptions) => InvokeResult {
  // Default: pretend the soul is already real (Case A — no writes).
  return () => ({ output: 'no changes needed\nSOUL_DECISION: skip\n', modifiedFiles: [], exitCode: 0 });
}
function collectStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    expect(opts.agentId).toBe('researcher-collect');
    const m = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt);
    if (!m) throw new Error('collect step: no discover-candidates path');
    writeFileSync(
      m[1],
      JSON.stringify({
        candidates: [{
          id: 'arxiv:2401.55555',
          title: 'Auto-picked deep read',
          url: 'https://arxiv.org/abs/2401.55555',
          abstract: 'A stub candidate abstract.',
          source: 'arxiv',
        }],
        search_summary: 'stubbed collection',
      }),
    );
    return { output: 'collected', modifiedFiles: [m[1]], exitCode: 0 };
  };
}
function triageStep(payload: Triaged): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    expect(opts.agentId).toBe('researcher-triage');
    return { output: JSON.stringify(payload), modifiedFiles: [], exitCode: 0 };
  };
}
function synthesizeStep(expectPromptIncludes?: string): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    if (expectPromptIncludes) expect(opts.userPrompt).toContain(expectPromptIncludes);
    const landscape = join(opts.cwd, 'notes/00_research_landscape.md');
    writeFileSync(landscape, readFileSync(landscape, 'utf8') + '\n- new entry\n');
    const cm = /`([^`]+contradictions\.md)`/.exec(opts.userPrompt);
    if (!cm) throw new Error('synthesize step: no contradictions path');
    writeFileSync(cm[1], 'none\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}
function packageStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    const m = /`([^`]+run-summary\.md)`/.exec(opts.userPrompt);
    if (!m) throw new Error('package step: no run_summary_path');
    mkdirSync(join(m[1], '..'), { recursive: true });
    writeFileSync(m[1], '## Run summary\n\n## Devil\'s-advocate pass\n\n## Confidence labels\n\n## What would change my mind\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}

describe('researcher run (autonomous)', () => {
  let proj: string;
  let _origSend: typeof process.send;
  let _origRunIpc: string | undefined;
  beforeEach(() => {
    _origSend = process.send;
    _origRunIpc = process.env[RUN_IPC_ENV];
    (process as { send?: unknown }).send = undefined;
    delete process.env[RUN_IPC_ENV];
  });

  const libraryPaperId = 'paper_arxiv_2401_55555';
  const libraryArtifactPath = `.researcher-workspace/library/papers/${libraryPaperId}/reads/read_${libraryPaperId}.md`;

  function upsertLibraryRead(root: string, body = '# Existing Library Read\n\nReusable library artifact body.\n'): void {
    const lib = new PaperLibrary(root, { now: () => '2026-07-04T00:00:00.000Z' });
    lib.upsertPaper({
      id: libraryPaperId,
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.55555', url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.55555', url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Auto-picked deep read',
      tags: ['reuse'],
    });
    mkdirSync(join(root, '.researcher-workspace/library/papers', libraryPaperId, 'reads'), { recursive: true });
    writeFileSync(join(root, libraryArtifactPath), body);
    lib.upsertRead({ id: `read_${libraryPaperId}`, paperId: libraryPaperId, status: 'read', artifactPath: libraryArtifactPath });
  }

  function fakeLibraryRead(body = '# New Library Read\n\nFresh library artifact body.\n'): LibraryReadRunner {
    return async ({ workspaceRoot, paper, readId }) => {
      const artifactPath = `.researcher-workspace/library/papers/${paper.id}/reads/${readId}.md`;
      mkdirSync(join(workspaceRoot, '.researcher-workspace/library/papers', paper.id, 'reads'), { recursive: true });
      writeFileSync(join(workspaceRoot, artifactPath), body);
      return { artifactPath, title: 'Auto-picked deep read' };
    };
  }
  afterEach(() => {
    (process as { send?: unknown }).send = _origSend;
    if (_origRunIpc === undefined) delete process.env[RUN_IPC_ENV];
    else process.env[RUN_IPC_ENV] = _origRunIpc;
  });
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-run-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    // delivery.mode defaults to local, so runs commit without push/PR.
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // Override placeholder query so the `hasRealQueries` check in run.ts passes.
    const pyPath = join(proj, '.researcher/project.yaml');
    writeFileSync(pyPath, readFileSync(pyPath, 'utf8').replace('your topic keyword', 'test query'));
    execaSync('git', ['add', '.researcher', '.milkie', 'agents', '.gitignore'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes', 'active'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
  });

  it('runs the full discover→read→synth→package chain when discover is explicitly enabled', async () => {
    const adapter = new ScriptedAdapter([
      soulStep(),
      collectStep(),
      triageStep(triagedDeepRead),
      synthesizeStep('Fresh library artifact body.'),
      packageStep(),
    ]);
    const sent: Array<{ type: string; stages?: string[]; name?: string; outcome?: string }> = [];
    const orig = process.send;
    process.env[RUN_IPC_ENV] = '1';
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m as never); return true; };
    const { runRun } = await import('../../src/commands/run.js');
    try {
      await runRun({
        cwd: proj,
        workspaceRoot: proj,
        adapter,
        libraryReadRunner: fakeLibraryRead(),
        discover: true,
      });
    } finally {
      (process as { send?: unknown }).send = orig;
    }

    expect(sent).toContainEqual({
      type: 'plan',
      stages: ['bootstrap', 'soul', 'discover', 'read', 'rebalance', 'synthesize', 'package'],
    });
    expect(sent).toContainEqual({ type: 'stage', name: 'synthesize' });

    expect(adapter.callCount).toBe(5);
    expect(readFileSync(join(proj, libraryArtifactPath), 'utf8')).toContain('Fresh library artifact body.');
    expect(readFileSync(join(proj, 'notes/active/01_auto_picked_deep_read.md'), 'utf8')).toContain(libraryArtifactPath);
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.55555'); // deep-read pick
    expect(seen).toContain('arxiv:2401.66666'); // skim
    const deepReadLine = seen.split('\n').find((l) => l.includes('arxiv:2401.55555'))!;
    expect(deepReadLine).toContain('RQ1: extends');
    expect(deepReadLine).not.toContain('manual feed');
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toMatch(/^researcher\//);
  });

  it('reuses an existing Library read artifact instead of reading source material again', async () => {
    upsertLibraryRead(proj);
    const adapter = new ScriptedAdapter([
      soulStep(),
      collectStep(),
      triageStep(triagedDeepRead),
      synthesizeStep('Reusable library artifact body.'),
      packageStep(),
    ]);

    const { runRun } = await import('../../src/commands/run.js');
    await runRun({
      cwd: proj,
      workspaceRoot: proj,
      adapter,
      discover: true,
      libraryReadRunner: async () => {
        throw new Error('Library read runner should not run when a read artifact already exists');
      },
    });

    expect(adapter.callCount).toBe(5);
    expect(readFileSync(join(proj, 'notes/active/01_auto_picked_deep_read.md'), 'utf8')).toContain('Reusable library artifact body.');
  });

  it('normalizes canonical url: source ids into Library papers', async () => {
    const { bootstrap } = await import('../../src/pipeline/bootstrap.js');
    const { libraryTopicRead } = await import('../../src/pipeline/library_topic_read.js');
    const { newRunId, RunDir } = await import('../../src/state/runs.js');
    const runDir = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new ScriptedAdapter([]),
      runDir,
      addSourceId: 'url:https://example.com/paper',
    });
    await libraryTopicRead(ctx, {
      workspaceRoot: proj,
      libraryReadRunner: fakeLibraryRead('# URL Read\n\nURL library artifact body.\n'),
    });
    const papers = new PaperLibrary(proj).listPapers();
    expect(papers).toHaveLength(1);
    expect(papers[0].canonicalSource).toEqual({
      kind: 'url',
      id: 'url:https://example.com/paper',
      url: 'https://example.com/paper',
    });
  });

  it('exits cleanly when discover returns no deep-read candidate (no commits, no branch)', async () => {
    const adapter = new ScriptedAdapter([soulStep(), collectStep(), triageStep(triagedEmpty)]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter, discover: true });

    expect(res.outcome).toBe('no-candidate');
    expect(adapter.callCount).toBe(3); // soul + collect + tool-free triage
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim()).toBe('main');
    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout.trim().split('\n');
    expect(log.length).toBe(1); // only the init commit
  });

  it('defaults to no discover and exits nothing-to-run without linked papers (#140)', async () => {
    const adapter = new ScriptedAdapter([soulStep(), collectStep(), triageStep(triagedDeepRead)]);
    const sent: Array<{ type: string; stages?: string[]; outcome?: string }> = [];
    const orig = process.send;
    process.env[RUN_IPC_ENV] = '1';
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m as never); return true; };
    const { runRun } = await import('../../src/commands/run.js');
    let res: { outcome: string };
    try {
      res = await runRun({ cwd: proj, workspaceRoot: proj, adapter });
    } finally {
      (process as { send?: unknown }).send = orig;
    }
    expect(res.outcome).toBe('nothing-to-run');
    expect(adapter.callCount).toBe(0); // no soul/collect — empty queue before LLM
    expect(sent).toContainEqual({ type: 'outcome', outcome: 'nothing-to-run' });
    expect(sent.find((e) => e.type === 'plan')?.stages).toEqual(['bootstrap']);
  });

  it('exits all-integrated when linked papers are done and discover is off (#140)', async () => {
    const lib = new PaperLibrary(proj, { now: () => '2026-08-02T00:00:00.000Z' });
    lib.upsertPaper({
      id: libraryPaperId,
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.55555', url: 'https://arxiv.org/abs/2401.55555' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.55555', url: 'https://arxiv.org/abs/2401.55555' }],
      identifiers: { arxiv: '2401.55555' },
      title: 'Already integrated',
      tags: [],
    });
    lib.upsertLink({
      paperId: libraryPaperId,
      surfaceType: 'topic',
      surfaceId: 'topic',
      relation: 'integrated',
    });
    lib.upsertIntegration({
      paperId: libraryPaperId,
      topicId: 'topic',
      notePath: 'notes/active/01_x.md',
      zone: 'active',
      integratedAt: '2026-08-02T00:00:00.000Z',
    });

    const adapter = new ScriptedAdapter([soulStep(), collectStep(), triageStep(triagedDeepRead)]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({
      cwd: proj,
      workspaceRoot: proj,
      topicPath: 'topic',
      adapter,
    });
    expect(res.outcome).toBe('all-integrated');
    expect(adapter.callCount).toBe(0);
  });

  it('migrates legacy managed contracts during a normal autonomous run', async () => {
    rmSync(join(proj, 'agents/researcher-collect.md'));
    rmSync(join(proj, 'agents/researcher-triage.md'));
    writeFileSync(
      join(proj, '.milkie/agents.json'),
      JSON.stringify({ agents: [{ id: 'researcher', file: '../agents/researcher.md' }] }, null, 2),
    );
    const adapter = new ScriptedAdapter([soulStep(), collectStep(), triageStep(triagedEmpty)]);
    const { runRun } = await import('../../src/commands/run.js');

    await runRun({ cwd: proj, adapter, discover: true });

    expect(existsSync(join(proj, 'agents/researcher-collect.md'))).toBe(true);
    expect(existsSync(join(proj, 'agents/researcher-triage.md'))).toBe(true);
    expect(readFileSync(join(proj, '.milkie/agents.json'), 'utf8')).toContain('researcher-collect');
    expect(readFileSync(join(proj, '.milkie/agents.json'), 'utf8')).toContain('researcher-triage');
  });

  it('commits legacy managed-contract migration on the deep-read branch', async () => {
    rmSync(join(proj, 'agents/researcher-collect.md'));
    rmSync(join(proj, 'agents/researcher-triage.md'));
    writeFileSync(
      join(proj, '.milkie/agents.json'),
      JSON.stringify({ agents: [{ id: 'researcher', file: '../agents/researcher.md' }] }, null, 2),
    );
    execaSync('git', ['add', '.milkie/agents.json', 'agents'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'legacy managed contracts'], { cwd: proj });
    const adapter = new ScriptedAdapter([
      soulStep(),
      collectStep(),
      triageStep(triagedDeepRead),
      synthesizeStep('Fresh library artifact body.'),
      packageStep(),
    ]);
    const { runRun } = await import('../../src/commands/run.js');

    await runRun({
      cwd: proj,
      workspaceRoot: proj,
      adapter,
      libraryReadRunner: fakeLibraryRead(),
      discover: true,
    });

    expect(execaSync('git', ['show', 'HEAD:agents/researcher-collect.md'], { cwd: proj }).stdout)
      .toContain('agentId: researcher-collect');
    expect(execaSync('git', ['show', 'HEAD:agents/researcher-triage.md'], { cwd: proj }).stdout)
      .toContain('agentId: researcher-triage');
    expect(execaSync('git', ['show', 'HEAD:.milkie/agents.json'], { cwd: proj }).stdout)
      .toContain('researcher-collect');
  });

  it('exits cleanly when soul_bootstrap writes open_questions.md (signal too thin)', async () => {
    const adapter = new ScriptedAdapter([
      (opts) => {
        writeFileSync(
          join(opts.cwd, '.researcher/open_questions.md'),
          '# Open questions\n\n- topic?\n',
        );
        return { output: 'SOUL_DECISION: open_questions\n', modifiedFiles: [], exitCode: 0 };
      },
    ]);
    const { runRun } = await import('../../src/commands/run.js');
    // discover on (or any non-empty path) so soul still runs; empty queue would skip soul.
    await runRun({ cwd: proj, adapter, discover: true });

    expect(adapter.callCount).toBe(1); // only soul ran
    expect(existsSync(join(proj, '.researcher/open_questions.md'))).toBe(true);
    expect(execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout.trim().split('\n').length).toBe(1);
  });

  it('marks Library integrated only after synthesize modifies landscape', async () => {
    const adapter = new ScriptedAdapter([
      soulStep(),
      collectStep(),
      triageStep(triagedDeepRead),
      synthesizeStep('Fresh library artifact body.'),
      packageStep(),
    ]);
    const { runRun } = await import('../../src/commands/run.js');
    await runRun({
      cwd: proj,
      workspaceRoot: proj,
      adapter,
      libraryReadRunner: fakeLibraryRead(),
      discover: true,
    });

    const lib = new PaperLibrary(proj);
    expect(lib.listIntegrations(libraryPaperId)).toEqual([
      expect.objectContaining({
        paperId: libraryPaperId,
        notePath: expect.stringMatching(/^notes\/active\/\d+_/),
        zone: 'active',
      }),
    ]);
    expect(lib.listLinks(libraryPaperId)).toEqual([
      expect.objectContaining({ relation: 'integrated' }),
    ]);
    expect(readFileSync(join(proj, 'notes/00_research_landscape.md'), 'utf8')).toContain('new entry');
  });

  it('does not mark integrated when synthesize leaves landscape unchanged', async () => {
    const adapter = new ScriptedAdapter([
      soulStep(),
      collectStep(),
      triageStep(triagedDeepRead),
      () => ({ output: 'ok', modifiedFiles: [], exitCode: 0 }), // synthesize no-op
    ]);
    const { runRun } = await import('../../src/commands/run.js');
    await expect(
      runRun({
        cwd: proj,
        workspaceRoot: proj,
        adapter,
        libraryReadRunner: fakeLibraryRead(),
        discover: true,
      }),
    ).rejects.toThrow(/did not modify.*00_research_landscape/i);

    const lib = new PaperLibrary(proj);
    expect(lib.listIntegrations(libraryPaperId)).toEqual([]);
    expect(lib.listLinks(libraryPaperId).some((l) => l.relation === 'integrated')).toBe(false);
    expect(existsSync(join(proj, 'notes/active/01_auto_picked_deep_read.md'))).toBe(true);
  });

  it('refuses to run a second concurrent autonomous tick (lock)', async () => {
    // Hold the lock manually — the second call should reject.
    const lockPath = join(proj, '.researcher/state/.lock');
    mkdirSync(join(lockPath, '..'), { recursive: true });
    writeFileSync(lockPath, '99999 stale\n');

    const adapter = new ScriptedAdapter([soulStep(), collectStep(), triageStep(triagedEmpty)]);
    const { runRun } = await import('../../src/commands/run.js');
    await expect(runRun({ cwd: proj, adapter })).rejects.toThrow(/lock|locked/i);
    expect(existsSync(lockPath)).toBe(true); // we did not delete a lock we didn't own
  });
});
