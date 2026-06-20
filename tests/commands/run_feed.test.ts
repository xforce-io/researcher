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
function enrichStep(): (opts: InvokeOptions) => InvokeResult {
  return (opts) => {
    // The enrich stage hands the agent the just-written window note; it verifies the
    // note's targets against primary sources and folds the evidence back IN PLACE (B1).
    const nm = /(\d+_[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.md)/.exec(opts.userPrompt);
    if (!nm) throw new Error('enrich step: no note filename in prompt');
    const notePath = join(opts.cwd, 'notes', nm[1]);
    writeFileSync(
      notePath,
      readFileSync(notePath, 'utf8') +
        '\n- 已核实:宁德时代 2026Q2 储能订单 12GWh(同比+40%)https://primary.example.com/catl-q2 [med]\n',
    );
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  };
}

/** Turn on the opt-in enrich stage for the x-inbox source. */
function enableEnrich(projDir: string): void {
  const p = join(projDir, '.researcher/project.yaml');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(/(\n {4}inbox_dir: [^\n]+\n)/, `$1    enrich: true\n`),
  );
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

  it('commits the feed window to main in place — no per-window branch, no PR (A-main)', async () => {
    writeFileSync(join(inbox, 'x-following-20260619T110000Z.md'), DIGEST);
    const adapter = new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('completed');
    expect(adapter.callCount).toBe(3); // soul + feed-synthesize + package-review

    // Stays on main — the feed path no longer forks a `researcher/NN` branch.
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim()).toBe('main');
    const branches = execaSync('git', ['branch', '--format=%(refname:short)'], { cwd: proj }).stdout;
    expect(branches).not.toMatch(/researcher\//);

    // The note is committed ON main (was scattered onto an unmerged branch before).
    const tracked = execaSync('git', ['ls-files'], { cwd: proj }).stdout;
    expect(tracked).toContain('notes/01_x-following-2026-06-19.md');
    expect(readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8')).toContain('xfeed:200');

    // ONE commit, and it carries note + state together (not the paper path's 2-commit split).
    const head = execaSync('git', ['log', '-1', '--format=%s'], { cwd: proj }).stdout.trim();
    expect(head).toMatch(/^feed:/);
    const headFiles = execaSync('git', ['show', '--stat', '--format=', 'HEAD'], { cwd: proj }).stdout;
    expect(headFiles).toContain('notes/01_x-following-2026-06-19.md');
    expect(headFiles).toContain('.researcher/state/seen.jsonl');
  });

  it('consecutive feed runs accumulate on main (the consolidation #25 was missing before)', async () => {
    const DIGEST_B = DIGEST
      .replace('cursor_to: 200', 'cursor_to: 300')
      .replace('cursor_from: 100', 'cursor_from: 200')
      .replace('status/200', 'status/300');
    writeFileSync(join(inbox, 'x-following-20260619T110000Z.md'), DIGEST);
    writeFileSync(join(inbox, 'x-following-20260619T120000Z.md'), DIGEST_B);
    const { runRun } = await import('../../src/commands/run.js');

    const r1 = await runRun({ cwd: proj, adapter: new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]) });
    const r2 = await runRun({ cwd: proj, adapter: new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]) });

    expect(r1.outcome).toBe('completed');
    expect(r2.outcome).toBe('completed');
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim()).toBe('main');

    // BOTH window notes are present on the one branch (before #25 they fanned into 2 isolated branches).
    const tracked = execaSync('git', ['ls-files'], { cwd: proj }).stdout;
    expect(tracked).toContain('notes/01_x-following-2026-06-19.md');
    expect(tracked).toContain('notes/02_x-following-2026-06-19.md');

    // Cumulative dedup state: both digests consumed.
    const seen = readFileSync(join(proj, '.researcher/state/seen.jsonl'), 'utf8');
    expect(seen).toContain('xfeed:200');
    expect(seen).toContain('xfeed:300');

    // Two feed commits on main, one per window.
    const feedCommits = execaSync('git', ['log', '--format=%s'], { cwd: proj }).stdout
      .split('\n').filter((s) => s.startsWith('feed:'));
    expect(feedCommits).toHaveLength(2);
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
    expect(execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: proj }).stdout.trim()).toBe('main');
    expect(execaSync('git', ['ls-files'], { cwd: proj }).stdout).toContain('notes/01_substack-2026-06-19.md');
  });

  it('runs feed-enrich between synthesize and package when source.enrich is on, and commits the verified evidence', async () => {
    enableEnrich(proj);
    writeFileSync(join(inbox, 'x-following-20260619T110000Z.md'), DIGEST);
    const adapter = new ScriptedAdapter([soulStep(), feedSynthesizeStep(), enrichStep(), packageStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('completed');
    expect(adapter.callCount).toBe(4); // soul + feed-synthesize + feed-enrich + package

    // The enriched evidence (primary-source URL) lands in the committed note on main.
    const note = readFileSync(join(proj, 'notes/01_x-following-2026-06-19.md'), 'utf8');
    expect(note).toContain('https://primary.example.com/catl-q2');
    const headNote = execaSync('git', ['show', 'HEAD:notes/01_x-following-2026-06-19.md'], { cwd: proj }).stdout;
    expect(headNote).toContain('https://primary.example.com/catl-q2');
  });

  it('skips feed-enrich when source.enrich is absent (opt-in, default off)', async () => {
    writeFileSync(join(inbox, 'x-following-20260619T110000Z.md'), DIGEST);
    const adapter = new ScriptedAdapter([soulStep(), feedSynthesizeStep(), packageStep()]);
    const { runRun } = await import('../../src/commands/run.js');
    const res = await runRun({ cwd: proj, adapter });

    expect(res.outcome).toBe('completed');
    expect(adapter.callCount).toBe(3); // soul + feed-synthesize + package — no enrich call
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
