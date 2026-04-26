import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { discoverTriage } from '../../src/pipeline/discover_triage.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';
import type { Triaged } from '../../src/config/triaged.js';

class WriteTriagedAdapter implements AgentRuntime {
  id = 'stub';
  constructor(private readonly payload: Triaged) {}
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    // Tests look for the triaged_path placeholder in the user prompt and write there.
    const m = /triaged_path:\s*(\S+)/.exec(opts.userPrompt) ?? /Write[^\n]*at `([^`]+triaged\.json)`/.exec(opts.userPrompt);
    if (!m) throw new Error('stub: could not find triaged_path in prompt');
    writeFileSync(m[1], JSON.stringify(this.payload, null, 2));
    return { output: `done\n\nFILES_MODIFIED:\n${m[1]}\n`, modifiedFiles: [m[1]], exitCode: 0 };
  }
}

const sample = (overrides: Partial<Triaged> = {}): Triaged => ({
  candidates: [
    {
      id: 'arxiv:2401.11111',
      title: 'Top deep-read pick',
      url: 'https://arxiv.org/abs/2401.11111',
      source: 'arxiv',
      decision: 'deep-read',
      axes: { relevance: 3, alignment: 'extends', novelty: 'substantial', gravity: 'medium' },
      reason: 'RQ1: extends — direct hit',
    },
    {
      id: 'arxiv:2401.22222',
      title: 'Skim only',
      source: 'arxiv',
      decision: 'skim',
      axes: { relevance: 1, alignment: 'orthogonal', novelty: 'incremental', gravity: 'low' },
      reason: 'no RQ: skim — tangential',
    },
    {
      id: 'arxiv:2401.33333',
      title: 'Off-topic',
      source: 'arxiv',
      decision: 'reject',
      axes: { relevance: 0, alignment: 'orthogonal', novelty: 'incremental', gravity: 'low' },
      reason: 'no RQ: reject — wrong domain',
    },
  ],
  search_summary: '3 searches, 12 surveyed',
  ...overrides,
});

describe('discover_triage stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-disc-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty landscape\n');
  });

  it('sets ctx.addArxivId from the first deep-read pick and writes skim/reject to seen.jsonl', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new WriteTriagedAdapter(sample()),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addArxivId).toBe('arxiv:2401.11111');
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.22222');
    expect(seen).toContain('arxiv:2401.33333');
    // deep-read pick is NOT yet recorded in seen.jsonl (package stage will record it)
    expect(seen).not.toContain('arxiv:2401.11111');
  });

  it('leaves ctx.addArxivId undefined when no deep-read candidate is returned', async () => {
    const noDeepRead = sample({
      candidates: [
        {
          id: 'arxiv:2401.99999',
          title: 'Only a skim',
          source: 'arxiv',
          decision: 'skim',
          axes: { relevance: 1, alignment: 'orthogonal', novelty: 'incremental', gravity: 'low' },
          reason: 'no RQ: skim — tangential',
        },
      ],
    });
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new WriteTriagedAdapter(noDeepRead),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addArxivId).toBeUndefined();
    expect(readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8')).toContain('arxiv:2401.99999');
  });

  it('handles a fully empty candidates list (clean tick with nothing worth reading)', async () => {
    const empty = sample({ candidates: [] });
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new WriteTriagedAdapter(empty),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addArxivId).toBeUndefined();
    // file may or may not be touched, but should remain valid (likely just header line)
    const seenPath = join(proj, '.researcher/state/seen.jsonl');
    expect(existsSync(seenPath)).toBe(true);
  });

  it('silently skips a candidate whose id already lives in seen.jsonl', async () => {
    // Pre-seed the dedup ledger with the deep-read pick id.
    writeFileSync(
      join(proj, '.researcher/state/seen.jsonl'),
      JSON.stringify({
        id: 'arxiv:2401.11111',
        source: 'arxiv',
        first_seen_run: 'old-run',
        decision: 'deep-read',
        reason: 'previously read',
      }) + '\n',
    );
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new WriteTriagedAdapter(sample()),
      runDir: rd,
    });

    await discoverTriage(ctx);

    // We do NOT re-read a previously-decided paper.
    expect(ctx.addArxivId).toBeUndefined();
  });
});
