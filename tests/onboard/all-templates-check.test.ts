import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllTemplates } from '../../src/onboard/all-templates-check.js';
import { resolvePackageRoot } from '../../src/paths.js';

describe('isAllTemplates', () => {
  let dir: string;
  let pkgRoot: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-allt-'));
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
    pkgRoot = resolvePackageRoot();
  });

  it('returns true when files match templates byte-for-byte and seen.jsonl is empty', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    expect(isAllTemplates(dir)).toBe(true);
  });

  it('returns false when project.yaml differs from template', () => {
    writeFileSync(join(dir, '.researcher/project.yaml'), 'edited\n');
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
    expect(isAllTemplates(dir)).toBe(false);
  });

  it('returns false when seen.jsonl is non-empty', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '{"id":"x"}\n');
    expect(isAllTemplates(dir)).toBe(false);
  });
});
