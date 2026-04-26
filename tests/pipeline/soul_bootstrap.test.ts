import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { soulBootstrap } from '../../src/pipeline/soul_bootstrap.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

class StubAdapter implements AgentRuntime {
  id = 'stub';
  constructor(private readonly fn: (opts: InvokeOptions) => InvokeResult) {}
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    return this.fn(opts);
  }
}

const draftedYaml = `research_questions:
  - id: RQ1
    text: "How can lightweight signals triage agent trajectories without LLM judges?"
inclusion_criteria:
  - "Must propose or evaluate a triage signal."
exclusion_criteria:
  - "Pure benchmark papers."
sources:
  - kind: arxiv
    queries:
      - "trajectory triage agent"
    priority: high
paper_axes: []
cadence:
  default_interval_days: 7
  backoff_after_empty_runs: 3
`;

const draftedThesis = `# Thesis

## Working thesis

Lightweight behavioral signals beat LLM-judge triage on cost-quality tradeoff.

## Taste

- Mechanistic explanations over correlation.

## Anti-patterns

- Survey-only papers.

## Examples

(none yet)
`;

describe('soul_bootstrap stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-soul-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    // Simulate a topic repo with a real README so the agent has signal to draft from.
    writeFileSync(join(proj, 'README.md'), '# Agent triage\n\nResearch on triaging agent trajectories.\n');
  });

  it('reloads ctx.projectYaml + ctx.thesis after agent drafts new content', async () => {
    const adapter = new StubAdapter((opts) => {
      writeFileSync(join(opts.cwd, '.researcher/project.yaml'), draftedYaml);
      writeFileSync(join(opts.cwd, '.researcher/thesis.md'), draftedThesis);
      return { output: 'drafted', modifiedFiles: [], exitCode: 0 };
    });
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });
    expect(ctx.projectYaml.research_questions[0].text).toContain('Replace this');

    await soulBootstrap(ctx);

    expect(ctx.projectYaml.research_questions[0].text).toContain('lightweight signals');
    expect(ctx.thesis.body).toContain('LLM-judge triage');
    expect(ctx.needsHumanInput).toBeFalsy();
  });

  it('leaves ctx untouched when the agent writes nothing (already-real soul)', async () => {
    const adapter = new StubAdapter(() => ({ output: 'no changes needed', modifiedFiles: [], exitCode: 0 }));
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });
    const beforeYamlTxt = readFileSync(join(proj, '.researcher/project.yaml'), 'utf8');

    await soulBootstrap(ctx);

    expect(readFileSync(join(proj, '.researcher/project.yaml'), 'utf8')).toBe(beforeYamlTxt);
    expect(ctx.needsHumanInput).toBeFalsy();
  });

  it('flips ctx.needsHumanInput when the agent writes open_questions.md', async () => {
    const adapter = new StubAdapter((opts) => {
      writeFileSync(
        join(opts.cwd, '.researcher/open_questions.md'),
        '# Open questions\n\n- What is the topic of this repo?\n',
      );
      return { output: 'questions written', modifiedFiles: [], exitCode: 0 };
    });
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd });

    await soulBootstrap(ctx);

    expect(ctx.needsHumanInput).toBe(true);
    expect(existsSync(join(proj, '.researcher/open_questions.md'))).toBe(true);
  });
});
