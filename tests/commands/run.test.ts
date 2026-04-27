import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import type { Triaged } from '../../src/config/triaged.js';

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
// that the real ClaudeCodeAdapter never gets instantiated.
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
function discoverStep(payload: Triaged) {
  return (opts: InvokeOptions): InvokeResult => {
    const m = /Write[^\n]*at `([^`]+triaged\.json)`/.exec(opts.userPrompt);
    if (!m) throw new Error('discover step: no triaged_path in prompt');
    writeFileSync(m[1], JSON.stringify(payload, null, 2));
    return { output: `done\n\nFILES_MODIFIED:\n${m[1]}\n`, modifiedFiles: [m[1]], exitCode: 0 };
  };
}
function readStep(): (opts: InvokeOptions) => InvokeResult {
  // Title in the mocked arxiv metadata is "stub" → slug "stub" → first new note is 01_stub.md.
  return (opts) => {
    writeFileSync(join(opts.cwd, 'notes/01_stub.md'), '# Stub note\n\n## Claims\n- something\n');
    return { output: 'done\n\nFILES_MODIFIED:\nnotes/01_stub.md\n', modifiedFiles: ['notes/01_stub.md'], exitCode: 0 };
  };
}
function synthesizeStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
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
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-run-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    process.env.RESEARCHER_NO_REMOTE = '1';
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // Override placeholder query so the `hasRealQueries` check in run.ts passes.
    const pyPath = join(proj, '.researcher/project.yaml');
    writeFileSync(pyPath, readFileSync(pyPath, 'utf8').replace('your topic keyword', 'test query'));
    execaSync('git', ['add', '.researcher'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
  });

  it('runs the full discover→read→synth→package chain when discover finds a deep-read pick', async () => {
    const adapter = new ScriptedAdapter([
      soulStep(),
      discoverStep(triagedDeepRead),
      readStep(),
      synthesizeStep(),
      packageStep(),
    ]);
    const { runRun } = await import('../../src/commands/run.js');
    await runRun({ cwd: proj, adapter });

    expect(adapter.callCount).toBe(5);
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.55555'); // deep-read pick
    expect(seen).toContain('arxiv:2401.66666'); // skim
    // The deep-read entry's reason is the discover-time reason, not "manual feed".
    const deepReadLine = seen.split('\n').find((l) => l.includes('arxiv:2401.55555'))!;
    expect(deepReadLine).toContain('RQ1: extends');
    expect(deepReadLine).not.toContain('manual feed');
    // Branch + 2 commits.
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toMatch(/^researcher\//);
  });

  it('exits cleanly when discover returns no deep-read candidate (no commits, no branch)', async () => {
    const adapter = new ScriptedAdapter([soulStep(), discoverStep(triagedEmpty)]);
    const { runRun } = await import('../../src/commands/run.js');
    await runRun({ cwd: proj, adapter });

    expect(adapter.callCount).toBe(2); // soul + discover only
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim()).toBe('main');
    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout.trim().split('\n');
    expect(log.length).toBe(1); // only the init commit
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
    await runRun({ cwd: proj, adapter });

    expect(adapter.callCount).toBe(1); // only soul ran
    expect(existsSync(join(proj, '.researcher/open_questions.md'))).toBe(true);
    expect(execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout.trim().split('\n').length).toBe(1);
  });

  it('refuses to run a second concurrent autonomous tick (lock)', async () => {
    // Hold the lock manually — the second call should reject.
    const lockPath = join(proj, '.researcher/state/.lock');
    mkdirSync(join(lockPath, '..'), { recursive: true });
    writeFileSync(lockPath, '99999 stale\n');

    const adapter = new ScriptedAdapter([soulStep(), discoverStep(triagedEmpty)]);
    const { runRun } = await import('../../src/commands/run.js');
    await expect(runRun({ cwd: proj, adapter })).rejects.toThrow(/lock|locked/i);
    expect(existsSync(lockPath)).toBe(true); // we did not delete a lock we didn't own
  });
});
