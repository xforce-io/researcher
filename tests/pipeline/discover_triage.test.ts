import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { discoverTriage } from '../../src/pipeline/discover_triage.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';
import type { DiscoverCandidates } from '../../src/config/discover-candidates.js';
import type { Triaged } from '../../src/config/triaged.js';

class CollectThenTriageAdapter implements AgentRuntime {
  id = 'stub';
  calls: InvokeOptions[] = [];

  constructor(
    private readonly collected: DiscoverCandidates,
    private readonly triaged: Triaged,
  ) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.calls.push(opts);
    if (opts.agentId === 'researcher-collect') {
      const candidatePath = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt)?.[1];
      if (!candidatePath) throw new Error('stub: could not find discover-candidates path');
      writeFileSync(candidatePath, JSON.stringify(this.collected, null, 2));
      return { output: 'collected', modifiedFiles: [candidatePath], exitCode: 0 };
    }
    if (opts.agentId === 'researcher-triage') {
      return { output: JSON.stringify(this.triaged), modifiedFiles: [], exitCode: 0 };
    }

    // Lets the pre-split implementation complete so the assertions below prove
    // the requested two-agent boundary rather than failing from fixture setup.
    const triagedPath = /`([^`]+triaged\.json)`/.exec(opts.userPrompt)?.[1];
    if (!triagedPath) throw new Error('stub: unexpected generic agent invocation');
    writeFileSync(triagedPath, JSON.stringify(this.triaged, null, 2));
    return { output: 'legacy', modifiedFiles: [triagedPath], exitCode: 0 };
  }
}

/** Returns length once from triage, then a valid text JSON recovery response. */
class TriageLengthRecoveryAdapter implements AgentRuntime {
  id = 'stub-retry';
  calls: InvokeOptions[] = [];
  private triageCalls = 0;

  constructor(
    private readonly collected: DiscoverCandidates,
    private readonly triaged: Triaged,
  ) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.calls.push(opts);
    if (opts.agentId === 'researcher-collect') {
      const candidatePath = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt)?.[1];
      if (!candidatePath) throw new Error('stub: could not find discover-candidates path');
      writeFileSync(candidatePath, JSON.stringify(this.collected, null, 2));
      return { output: 'collected', modifiedFiles: [candidatePath], exitCode: 0 };
    }
    if (opts.agentId === 'researcher-triage') {
      this.triageCalls += 1;
      if (this.triageCalls === 1) {
        return { output: '', modifiedFiles: [], exitCode: 0, finishReason: 'length' };
      }
      return { output: JSON.stringify(this.triaged), modifiedFiles: [], exitCode: 0 };
    }

    // The old one-agent implementation must remain observable as a red test.
    return { output: '', modifiedFiles: [], exitCode: 0, finishReason: 'length' };
  }
}

class LengthWithJsonAdapter implements AgentRuntime {
  id = 'stub-length-json';
  calls: InvokeOptions[] = [];

  constructor(
    private readonly collected: DiscoverCandidates,
    private readonly triaged: Triaged,
  ) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.calls.push(opts);
    if (opts.agentId === 'researcher-collect') {
      const candidatePath = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt)?.[1];
      if (!candidatePath) throw new Error('stub: could not find discover-candidates path');
      writeFileSync(candidatePath, JSON.stringify(this.collected, null, 2));
      return { output: 'collected', modifiedFiles: [candidatePath], exitCode: 0 };
    }
    if (opts.agentId === 'researcher-triage') {
      return {
        output: JSON.stringify(this.triaged),
        modifiedFiles: [],
        exitCode: 0,
        finishReason: 'length',
      };
    }
    throw new Error('stub: unexpected generic agent invocation');
  }
}

class NeverWriteAdapter implements AgentRuntime {
  id = 'stub-never';
  calls: InvokeOptions[] = [];

  constructor(private readonly collected: DiscoverCandidates) {}

  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.calls.push(opts);
    if (opts.agentId === 'researcher-collect') {
      const candidatePath = /`([^`]+discover-candidates\.json)`/.exec(opts.userPrompt)?.[1];
      if (!candidatePath) throw new Error('stub: could not find discover-candidates path');
      writeFileSync(candidatePath, JSON.stringify(this.collected, null, 2));
      return { output: 'collected', modifiedFiles: [candidatePath], exitCode: 0 };
    }
    return { output: '', modifiedFiles: [], exitCode: 0, finishReason: 'length' };
  }
}
class TerminalErrorAdapter implements AgentRuntime {
  id = 'stub-terminal-error';
  calls = 0;
  async invoke(_opts: InvokeOptions): Promise<InvokeResult> {
    this.calls += 1;
    return {
      output: 'agent failed before writing triaged.json',
      modifiedFiles: [],
      exitCode: 1,
      stderr: 'intentional terminal failure',
    };
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

const collected = (): DiscoverCandidates => ({
  candidates: [
    {
      id: 'arxiv:2401.11111',
      title: 'Top deep-read pick',
      url: 'https://arxiv.org/abs/2401.11111',
      abstract: 'A directly relevant result.',
      source: 'arxiv',
    },
    {
      id: 'arxiv:2401.22222',
      title: 'Skim only',
      url: 'https://arxiv.org/abs/2401.22222',
      abstract: 'A tangential result.',
      source: 'arxiv',
    },
    {
      id: 'arxiv:2401.33333',
      title: 'Off-topic',
      url: 'https://arxiv.org/abs/2401.33333',
      abstract: 'An unrelated result.',
      source: 'arxiv',
    },
  ],
  search_summary: '3 searches, 12 surveyed',
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

  it('collects candidates before tool-free triage and writes host-owned triaged.json', async () => {
    const adapter = new CollectThenTriageAdapter(collected(), sample());
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await discoverTriage(ctx);

    expect(adapter.calls.map((call) => call.agentId)).toEqual(['researcher-collect', 'researcher-triage']);
    expect(adapter.calls[1].userPrompt).not.toContain('run_command');
    expect(adapter.calls[1].systemPrompt).not.toContain('working directory');
    expect(adapter.calls[1].systemPrompt).not.toContain('read files');
    expect(adapter.calls[1].systemPrompt).not.toContain('write');
    expect(adapter.calls[1].userPrompt).toContain('"abstract": "A directly relevant result."');
    expect(readFileSync(rd.path('triaged.json'), 'utf8')).toContain('"candidates"');
  });

  it('deduplicates canonical candidate IDs before applying the 30-candidate cap', async () => {
    const candidates = Array.from({ length: 31 }, (_, index) => ({
      id: `arxiv:2401.${String(10000 + index)}`,
      title: `Candidate ${index}`,
      url: `https://arxiv.org/abs/2401.${String(10000 + index)}`,
      abstract: `Abstract ${index}`,
      source: 'arxiv',
    }));
    candidates.splice(1, 0, { ...candidates[0], id: 'ARXIV:2401.10000' });
    const adapter = new CollectThenTriageAdapter(
      { candidates, search_summary: 'duplicate boundary fixture' },
      sample({ candidates: [] }),
    );
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await discoverTriage(ctx);

    const normalized = JSON.parse(readFileSync(rd.path('discover-candidates.json'), 'utf8')) as DiscoverCandidates;
    expect(normalized.candidates).toHaveLength(30);
    expect(new Set(normalized.candidates.map((candidate) => candidate.id)).size).toBe(30);
  });

  it('accepts parseable triage JSON despite a length finish reason without recovery', async () => {
    const adapter = new LengthWithJsonAdapter(collected(), sample({ candidates: [] }));
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await discoverTriage(ctx);

    expect(adapter.calls.map((call) => call.agentId)).toEqual(['researcher-collect', 'researcher-triage']);
    expect(existsSync(rd.path('triaged.json'))).toBe(true);
  });

  it('migrates legacy managed contracts before collect and triage', async () => {
    rmSync(join(proj, 'agents/researcher-collect.md'));
    rmSync(join(proj, 'agents/researcher-triage.md'));
    writeFileSync(
      join(proj, '.milkie/agents.json'),
      JSON.stringify({ agents: [{ id: 'researcher', file: '../agents/researcher.md' }] }, null, 2),
    );
    const adapter = new CollectThenTriageAdapter(collected(), sample({ candidates: [] }));
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await discoverTriage(ctx);

    expect(existsSync(join(proj, 'agents/researcher-collect.md'))).toBe(true);
    expect(existsSync(join(proj, 'agents/researcher-triage.md'))).toBe(true);
    expect(readFileSync(join(proj, '.milkie/agents.json'), 'utf8')).toContain('researcher-collect');
    expect(readFileSync(join(proj, '.milkie/agents.json'), 'utf8')).toContain('researcher-triage');
  });

  it('sets ctx.addSourceId from the first deep-read pick and writes skim/reject to seen.jsonl', async () => {
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new CollectThenTriageAdapter(collected(), sample()),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addSourceId).toBe('arxiv:2401.11111');
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('arxiv:2401.22222');
    expect(seen).toContain('arxiv:2401.33333');
    // deep-read pick is NOT yet recorded in seen.jsonl (package stage will record it)
    expect(seen).not.toContain('arxiv:2401.11111');
  });

  it('leaves ctx.addSourceId undefined when no deep-read candidate is returned', async () => {
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
      adapter: new CollectThenTriageAdapter(collected(), noDeepRead),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addSourceId).toBeUndefined();
    expect(readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8')).toContain('arxiv:2401.99999');
  });

  it('handles a fully empty candidates list (clean tick with nothing worth reading)', async () => {
    const empty = sample({ candidates: [] });
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({
      projectRoot: proj,
      adapter: new CollectThenTriageAdapter(collected(), empty),
      runDir: rd,
    });

    await discoverTriage(ctx);

    expect(ctx.addSourceId).toBeUndefined();
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
      adapter: new CollectThenTriageAdapter(collected(), sample()),
      runDir: rd,
    });

    await discoverTriage(ctx);

    // We do NOT re-read a previously-decided paper.
    expect(ctx.addSourceId).toBeUndefined();
  });

  it('retries a length-limited triage response once without re-running collect', async () => {
    const adapter = new TriageLengthRecoveryAdapter(collected(), sample());
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await discoverTriage(ctx);

    expect(adapter.calls.map((call) => call.agentId)).toEqual([
      'researcher-collect',
      'researcher-triage',
      'researcher-triage',
    ]);
    expect(adapter.calls.slice(1).every((call) => !call.userPrompt.includes('run_command'))).toBe(true);
    expect(ctx.addSourceId).toBe('arxiv:2401.11111');
    expect(existsSync(rd.path('triaged.json'))).toBe(true);
  });

  it('fails after one recovery attempt when triage still returns no JSON', async () => {
    const adapter = new NeverWriteAdapter(collected());
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await expect(discoverTriage(ctx)).rejects.toThrow(/triaged\.json is not valid JSON/);
    expect(adapter.calls).toHaveLength(3);
  });
  it('fails on a terminal agent error without triggering recovery', async () => {
    const adapter = new TerminalErrorAdapter();
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await expect(discoverTriage(ctx)).rejects.toThrow(/discover stage agent exited 1: agent failed before writing triaged\.json/);
    expect(adapter.calls).toBe(1);
    expect(existsSync(rd.path('discover.err'))).toBe(true);
  });

});
