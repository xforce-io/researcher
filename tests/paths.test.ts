import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveResearcherHome, resolveProjectResearcherDir, resolvePackageRoot } from '../src/paths.js';

describe('paths', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'r-paths-'));
  });
  it('resolveResearcherHome honors RESEARCHER_HOME env var', () => {
    process.env.RESEARCHER_HOME = tmp;
    expect(resolveResearcherHome()).toBe(tmp);
    delete process.env.RESEARCHER_HOME;
  });
  it('resolveProjectResearcherDir returns <cwd>/.researcher', () => {
    expect(resolveProjectResearcherDir(tmp)).toBe(join(tmp, '.researcher'));
  });
  it('resolvePackageRoot points at a dir containing methodology/', () => {
    const root = resolvePackageRoot();
    expect(root).toMatch(/researcher/);
  });
});
