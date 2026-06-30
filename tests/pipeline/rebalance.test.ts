import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { rebalance } from '../../src/pipeline/rebalance.js';
import { parseNote } from '../../src/state/zone.js';
import { RunDir, newRunId } from '../../src/state/runs.js';

function noteFile(zone: string, num: string, slug: string, dwell = 9, pin = false) {
  return {
    rel: `notes/${zone}/${num}_${slug}.md`,
    body: `---\nzone: ${zone}\npin: ${pin}\nscore: 0\ndwell: ${dwell}\n---\n# ${slug}\n\n## Claims\n- x`,
  };
}

function makeCtx(proj: string, cfg = { active_max: 2, buffer_max: 2, min_dwell: 0 }) {
  const rd = new RunDir(join(proj, '.researcher/state/runs'), newRunId());
  return {
    projectRoot: proj,
    researcherDir: join(proj, '.researcher'),
    projectYaml: { zoning: cfg } as any,
    runDir: rd,
  } as any;
}

describe('rebalance', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-reb-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    // 5 active notes, no citations → recency (num) decides; lowest nums sink.
    for (const n of ['01','02','03','04','05']) {
      const f = noteFile('active', n, 'p' + n);
      mkdirSync(join(proj, 'notes/active'), { recursive: true });
      writeFileSync(join(proj, f.rel), f.body);
    }
    writeFileSync(join(proj, 'notes/00_research_landscape.md'), '# landscape');
    execaSync('git', ['add', '-A'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('demotes lowest-scored notes past active/buffer caps and moves the files', async () => {
    const ctx = makeCtx(proj);
    await rebalance(ctx);
    // active_max=2,buffer_max=2 → 05,04 active;03,02 buffer;01 history
    expect(existsSync(join(proj, 'notes/active/05_p05.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/buffer/03_p03.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/history/01_p01.md'))).toBe(true);
    expect(existsSync(join(proj, 'notes/active/01_p01.md'))).toBe(false);
    // frontmatter zone updated
    expect(parseNote(readFileSync(join(proj, 'notes/history/01_p01.md'), 'utf8')).fm.zone).toBe('history');
    // summary + manifest
    expect(existsSync(ctx.runDir.path('rebalance-summary.md'))).toBe(true);
    expect(ctx.zoneManifest).toContain('05 active');
    expect(ctx.zoneManifest).toContain('01 history');
  });

  it('honors min_dwell hysteresis (no move when dwell below threshold)', async () => {
    // bump min_dwell above every note's dwell → nothing moves
    const ctx = makeCtx(proj, { active_max: 2, buffer_max: 2, min_dwell: 99 });
    await rebalance(ctx);
    expect(existsSync(join(proj, 'notes/active/01_p01.md'))).toBe(true); // stayed
    // stayed unpinned notes still have their dwell counter incremented (9 → 10)
    const fm = parseNote(readFileSync(join(proj, 'notes/active/01_p01.md'), 'utf8')).fm;
    expect(fm.dwell).toBe(10);
  });
});
