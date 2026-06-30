import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import { bootstrap } from '../../src/pipeline/bootstrap.js';
import { feedSynthesize } from '../../src/pipeline/feed_synthesize.js';
import { newRunId, RunDir } from '../../src/state/runs.js';
import type { AgentRuntime, InvokeOptions, InvokeResult } from '../../src/adapter/interface.js';

const DIGEST_CONTENT = `---
source: x-following
fetched_at: 2026-06-19T11:05:00.000Z
cursor_from: 100
cursor_to: 200
count: 1
---

## @test_user · 2026-06-19T11:00:00.000Z · https://x.com/test_user/status/200
Test item content.
`;

class CapturingAdapter implements AgentRuntime {
  id = 'capture';
  lastPrompt = '';
  async invoke(opts: InvokeOptions): Promise<InvokeResult> {
    this.lastPrompt = opts.userPrompt;
    // Write the note the agent is expected to create.
    const nm = /notes\/active\/(\d+_[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.md)/.exec(opts.userPrompt);
    if (nm) {
      mkdirSync(join(opts.cwd, 'notes', 'active'), { recursive: true });
      writeFileSync(join(opts.cwd, 'notes', 'active', nm[1]), '# Test window\n\n- item\n');
    }
    const landscape = join(opts.cwd, 'notes/00_research_landscape.md');
    writeFileSync(landscape, '# Landscape\n');
    const cm = /`([^`]+contradictions\.md)`/.exec(opts.userPrompt);
    if (cm) writeFileSync(cm[1], 'none\n');
    return { output: 'ok', modifiedFiles: [], exitCode: 0 };
  }
}

describe('feed_synthesize stage', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-fsyn-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    mkdirSync(join(proj, 'notes'), { recursive: true });
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# Empty landscape\n');
    execaSync('git', ['add', '.'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('injects zone manifest into the feed-synthesize prompt', async () => {
    // Mirror of synthesize.test.ts "injects zone manifest into the synthesize prompt".
    // Pre-create a history note so listNotes() returns it and populates the manifest.
    mkdirSync(join(proj, 'notes', 'history'), { recursive: true });
    writeFileSync(
      join(proj, 'notes', 'history', '01_x.md'),
      '---\nzone: history\n---\n# X Paper\n\n## Claims\n- something\n',
    );

    const adapter = new CapturingAdapter();
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd, addSourceId: 'xfeed:200' });
    ctx.feedDigest = {
      path: '/tmp/digest.md',
      filename: 'x-following-20260619T110500Z.md',
      content: DIGEST_CONTENT,
      id: 'xfeed:200',
      meta: { source: 'x-following', fetchedAt: '2026-06-19T11:05:00.000Z', cursorFrom: '100', cursorTo: '200', count: 1 },
    };

    await feedSynthesize(ctx);

    // The rendered feed prompt must contain the zone manifest entry for note 01 in history zone.
    expect(adapter.lastPrompt).toContain('01 history');
  });

  it('uses ctx.zoneManifest when already set by rebalance (feed path)', async () => {
    // Mirror of synthesize.test.ts "uses ctx.zoneManifest when already set by rebalance".
    const adapter = new CapturingAdapter();
    const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
    const ctx = await bootstrap({ projectRoot: proj, adapter, runDir: rd, addSourceId: 'xfeed:200' });
    ctx.feedDigest = {
      path: '/tmp/digest.md',
      filename: 'x-following-20260619T110500Z.md',
      content: DIGEST_CONTENT,
      id: 'xfeed:200',
      meta: { source: 'x-following', fetchedAt: '2026-06-19T11:05:00.000Z', cursorFrom: '100', cursorTo: '200', count: 1 },
    };
    ctx.zoneManifest = '01 active\n02 buffer';

    await feedSynthesize(ctx);

    expect(adapter.lastPrompt).toContain('01 active');
    expect(adapter.lastPrompt).toContain('02 buffer');
  });
});
