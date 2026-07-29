import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { commit, move } from '../../src/git/ops.js';

describe('git move', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-mv-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    mkdirSync(join(proj, 'notes/active'), { recursive: true });
    writeFileSync(join(proj, 'notes/active/07_x.md'), 'body');
    execaSync('git', ['add', '-A'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('moves a tracked file into a new subdir', async () => {
    await move({ cwd: proj, from: 'notes/active/07_x.md', to: 'notes/history/07_x.md' });
    expect(existsSync(join(proj, 'notes/active/07_x.md'))).toBe(false);
    expect(existsSync(join(proj, 'notes/history/07_x.md'))).toBe(true);
  });
});

describe('git commit', () => {
  let proj: string;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'r-commit-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    writeFileSync(join(proj, 'tracked.md'), 'v1\n');
    execaSync('git', ['add', 'tracked.md'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('no-ops when paths are unchanged even if untracked files exist', async () => {
    writeFileSync(join(proj, 'noise.sqlite'), 'x');
    writeFileSync(join(proj, 'open_questions.md'), 'q');
    await expect(
      commit({ cwd: proj, paths: ['tracked.md'], message: 'noop' }),
    ).resolves.toEqual({ committed: false });
    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout;
    expect(log).not.toContain('noop');
  });

  it('commits when a path actually changes', async () => {
    writeFileSync(join(proj, 'tracked.md'), 'v2\n');
    writeFileSync(join(proj, 'noise.sqlite'), 'x');
    await expect(
      commit({ cwd: proj, paths: ['tracked.md'], message: 'update tracked' }),
    ).resolves.toEqual({ committed: true });
    const log = execaSync('git', ['log', '--oneline'], { cwd: proj }).stdout;
    expect(log).toContain('update tracked');
  });
});
