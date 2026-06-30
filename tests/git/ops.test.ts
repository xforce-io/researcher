import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { move } from '../../src/git/ops.js';

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
