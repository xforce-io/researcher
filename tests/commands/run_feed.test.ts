import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
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

const DIGEST = `---
source: x-following
fetched_at: 2026-06-19T11:05:00.000Z
cursor_from: 100
cursor_to: 200
count: 1
---

## @value_investor_cn · 2026-06-19T11:00:00.000Z · https://x.com/value_investor_cn/status/200
宁德时代 Q2 储能订单超预期。
metrics: 👁1 ❤2 🔁3
`;

function soulStep(): (opts: InvokeOptions) => InvokeResult {
  return () => ({ output: 'no changes needed\nSOUL_DECISION: skip\n', modifiedFiles: [], exitCode: 0 });
}
function feedSynthesizeStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    // Source-agnostic: the note slug derives from the digest's `source`, so this
    // matches `01_x-following-…` as well as `01_substack-…`.
    const nm = /notes\/(\d+_[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.md)/.exec(opts.userPrompt);
    if (!nm) throw new Error('feed-synthesize step: no note filename in prompt');
    writeFileSync(join(opts.cwd, 'notes', nm[1]), '# 2026-06-19 关注流\n\n## 宁德时代\n- 储能订单超预期 [@value_investor_cn](https://x.com/value_investor_cn/status/200)\n');
    const landscape = join(opts.cwd, 'notes/00_research_landscape.md');
    writeFileSync(landscape, readFileSync(landscape, 'utf8') + '\n- 宁德时代\n');
    const cm = /`([^`]+contradictions\.md)`/.exec(opts.userPrompt);
    if (!cm) throw new Error('feed-synthesize step: no contradictions path');
    writeFileSync(cm[1], 'none\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}
function packageStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    const m = /`([^`]+run-summary\.md)`/.exec(opts.userPrompt);
    if (!m) throw new Error('package step: no run_summary_path');
    mkdirSync(join(m[1], '..'), { recursive: true });
    writeFileSync(m[1], '## Run summary\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}

describe('researcher run (feed / x-inbox, allowlist upstream, no triage)', () => {
  let proj: string;
  let inbox: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-feed-'));
    inbox = mkdtempSync(join(tmpdir(), 'r-inbox-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    process.env.RESEARCHER_NO_REMOTE = '1';
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    const pyPath = join(proj, '.researcher/project.yaml');
    const py = readFileSync(pyPath, 'utf8').replace(
      /sources:\n[\s\S]*?\npaper_axes:/,
      `sources:\n  - kind: x-inbox\n    inbox_dir: ${inbox}\n\npaper_axes:`,
    );
    writeFileSync(pyPath, py);
    execaSync('git', ['add', '.researcher'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty\n');
  });

  it('runs soul→feed-synthesize→package on a digest (no triage stage)', async () => {
    writeFileSync(join(inbox, 'x-following-20260619T110000Z.md'), DIGEST);
    const adapter = new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('completed');
    expect(adapter.callCount).toBe(3); // soul + feed-synthesize + package — one LLM filtering stage fewer
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('xfeed:200'); // digest consumed (no per-tweet seen anymore)
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toMatch(/^researcher\/01_x-following-/);
  });

  it('names the window note from the digest source, not a hardcoded "x-following"', async () => {
    // A non-Twitter source must flow through unchanged — the feed path is source-agnostic.
    writeFileSync(
      join(inbox, 'substack-20260619T110000Z.md'),
      DIGEST.replace('source: x-following', 'source: substack'),
    );
    const adapter = new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('completed');
    expect(existsSync(join(proj, 'notes/01_substack-2026-06-19.md'))).toBe(true);
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim())
      .toMatch(/^researcher\/01_substack-/);
  });

  it('exits cleanly when the inbox has no unconsumed digest', async () => {
    const adapter = new ScriptedAdapter([soulStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('no-candidate');
    expect(adapter.callCount).toBe(1); // soul only
    expect(existsSync(join(proj, 'notes/01_x-following-2026-06-19.md'))).toBe(false);
  });
});
