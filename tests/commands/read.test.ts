import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';
import { runMethodologyInstall } from '../../src/commands/methodology.js';
import type { InvokeOptions } from '../../src/adapter/interface.js';

vi.mock('../../src/sources/arxiv.js', async (orig) => ({
  ...(await orig() as object),
  fetchArxivMetadata: async () => ({
    id: 'arxiv:2401.00001',
    title: 'Stub Paper',
    authors: ['A'],
    abstract: 'abstract',
    abs_url: 'x',
    pdf_url: 'y',
  }),
}));

vi.mock('../../src/adapter/milkie.js', () => ({
  MilkieAdapter: class {
    id = 'stub';
    async invoke(opts: InvokeOptions) {
      mkdirSync(join(opts.cwd, 'notes/pending'), { recursive: true });
      writeFileSync(join(opts.cwd, 'notes/pending/01_stub_paper.md'), '# Stub\n\n## Claims\n- x');
      return {
        output: 'done\n\nFILES_MODIFIED:\nnotes/pending/01_stub_paper.md\n',
        modifiedFiles: ['notes/pending/01_stub_paper.md'],
        exitCode: 0,
      };
    }
  },
}));

describe('runRead', () => {
  let proj: string;
  beforeEach(async () => {
    proj = mkdtempSync(join(tmpdir(), 'r-cmd-read-'));
    execaSync('git', ['init', '-b', 'main'], { cwd: proj });
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execaSync('git', ['config', 'user.name', 't'], { cwd: proj });
    process.env.RESEARCHER_HOME = mkdtempSync(join(tmpdir(), 'r-home-'));
    await runInit({ targetDir: proj });
    await runMethodologyInstall();
    execaSync('git', ['add', '.researcher', '.milkie', 'agents', '.gitignore'], { cwd: proj });
    execaSync('git', ['commit', '-m', 'init'], { cwd: proj });
  });

  it('writes and commits one pending note, then stops before synthesis/package', async () => {
    const { runRead } = await import('../../src/commands/read.js');
    await runRead({ cwd: proj, input: '2401.00001' });

    const notePath = join(proj, 'notes/pending/01_stub_paper.md');
    expect(existsSync(notePath)).toBe(true);
    expect(readFileSync(notePath, 'utf8')).toContain('zone: pending');
    expect(existsSync(join(proj, 'notes/00_research_landscape.md'))).toBe(false);
    expect(existsSync(join(proj, 'report.md'))).toBe(false);
    expect(execaSync('git', ['status', '--porcelain', '-uall'], { cwd: proj }).stdout).toBe('');
    expect(execaSync('git', ['show', '--name-only', '--format=%s', 'HEAD'], { cwd: proj }).stdout)
      .toContain('notes/pending/01_stub_paper.md');
  });
});
