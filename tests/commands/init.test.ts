import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runInit } from '../../src/commands/init.js';

function gitInit(dir: string): void {
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
}

describe('init', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-init-'));
    gitInit(dir);
  });
  it('creates expected structure', async () => {
    await runInit({ targetDir: dir });
    expect(existsSync(join(dir, '.researcher/project.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/thesis.md'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/state/seen.jsonl'))).toBe(true);
    expect(existsSync(join(dir, '.researcher/.gitignore'))).toBe(true);
    expect(readFileSync(join(dir, '.researcher/.gitignore'), 'utf8')).toContain('state/runs/');
  });
  it('refuses if .researcher already exists', async () => {
    await runInit({ targetDir: dir });
    await expect(runInit({ targetDir: dir })).rejects.toThrow(/already exists/);
  });
  it('refuses if not in a git repo', async () => {
    const noGit = mkdtempSync(join(tmpdir(), 'r-nogit-'));
    await expect(runInit({ targetDir: noGit })).rejects.toThrow(/git repo/);
  });
  it('refuses when run from a subdir of a git repo (must be at repo root)', async () => {
    const sub = join(dir, 'pkg');
    mkdirSync(sub);
    await expect(runInit({ targetDir: sub })).rejects.toThrow(/repo root|toplevel|root of/i);
    expect(existsSync(join(sub, '.researcher'))).toBe(false);
  });
});
