import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllTemplates, isOnboardable, isThesisTemplate } from '../../src/onboard/all-templates-check.js';
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

describe('isOnboardable', () => {
  let dir: string;
  let pkgRoot: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r-onboardable-'));
    mkdirSync(join(dir, '.researcher/state'), { recursive: true });
    pkgRoot = resolvePackageRoot();
    writeFileSync(
      join(dir, '.researcher/thesis.md'),
      readFileSync(join(pkgRoot, 'templates/thesis.md'))
    );
    writeFileSync(
      join(dir, '.researcher/.gitignore'),
      readFileSync(join(pkgRoot, 'templates/researcher-gitignore'))
    );
    writeFileSync(join(dir, '.researcher/state/seen.jsonl'), '');
  });

  it('is true for pristine templates', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    expect(isOnboardable(dir)).toBe(true);
  });

  it('is true when only meta.topic_oneline differs', () => {
    const tpl = readFileSync(join(pkgRoot, 'templates/project.yaml'), 'utf8');
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      tpl.replace(/topic_oneline:[ \t]*.*$/m, 'topic_oneline: "Web created pillar"'),
    );
    expect(isAllTemplates(dir)).toBe(false);
    expect(isOnboardable(dir)).toBe(true);
  });

  it('is false when thesis differs', () => {
    writeFileSync(
      join(dir, '.researcher/project.yaml'),
      readFileSync(join(pkgRoot, 'templates/project.yaml'))
    );
    writeFileSync(join(dir, '.researcher/thesis.md'), '# custom thesis\n');
    expect(isOnboardable(dir)).toBe(false);
    expect(isThesisTemplate(dir)).toBe(false);
  });
});
