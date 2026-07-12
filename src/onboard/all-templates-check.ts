import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

const FILE_MAP: Array<[string, string]> = [
  ['project.yaml', 'templates/project.yaml'],
  ['thesis.md', 'templates/thesis.md'],
  ['.gitignore', 'templates/researcher-gitignore'],
];

/**
 * True when the scaffolded `.researcher/` directory is in pristine post-init
 * state (every file matches the packaged template byte-for-byte and seen.jsonl
 * is empty). Used to decide whether `onboard` may proceed after a previously
 * aborted session.
 */
export function isAllTemplates(repoRoot: string): boolean {
  const dotR = resolveProjectResearcherDir(repoRoot);
  const pkg = resolvePackageRoot();
  for (const [target, tpl] of FILE_MAP) {
    const actual = safeRead(join(dotR, target));
    const expected = safeRead(join(pkg, tpl));
    if (actual === null || expected === null) return false;
    if (!actual.equals(expected)) return false;
  }
  return isSeenEmpty(dotR);
}

/**
 * Like isAllTemplates, but allows `.researcher/project.yaml` to differ only in
 * `meta.topic_oneline` (written by Web topic create before onboard).
 */
export function isOnboardable(repoRoot: string): boolean {
  if (isAllTemplates(repoRoot)) return true;

  const dotR = resolveProjectResearcherDir(repoRoot);
  const pkg = resolvePackageRoot();

  for (const [target, tpl] of FILE_MAP) {
    if (target === 'project.yaml') continue;
    const actual = safeRead(join(dotR, target));
    const expected = safeRead(join(pkg, tpl));
    if (actual === null || expected === null) return false;
    if (!actual.equals(expected)) return false;
  }
  if (!isSeenEmpty(dotR)) return false;

  const actualYaml = safeRead(join(dotR, 'project.yaml'));
  const expectedYaml = safeRead(join(pkg, 'templates/project.yaml'));
  if (actualYaml === null || expectedYaml === null) return false;
  return projectYamlOnlyOnelineDiffers(actualYaml.toString('utf8'), expectedYaml.toString('utf8'));
}

/** True when thesis.md still matches the packaged template. */
export function isThesisTemplate(repoRoot: string): boolean {
  const actual = safeRead(join(resolveProjectResearcherDir(repoRoot), 'thesis.md'));
  const expected = safeRead(join(resolvePackageRoot(), 'templates/thesis.md'));
  if (actual === null || expected === null) return false;
  return actual.equals(expected);
}

function isSeenEmpty(dotR: string): boolean {
  const seen = safeRead(join(dotR, 'state/seen.jsonl'));
  if (seen === null) return false;
  return seen.length === 0;
}

function projectYamlOnlyOnelineDiffers(actual: string, expected: string): boolean {
  let a: unknown;
  let e: unknown;
  try {
    a = parseYaml(actual);
    e = parseYaml(expected);
  } catch {
    return false;
  }
  if (!isPlainObject(a) || !isPlainObject(e)) return false;
  const aNorm = structuredClone(a) as Record<string, unknown>;
  const eNorm = structuredClone(e) as Record<string, unknown>;
  const aMeta = isPlainObject(aNorm.meta) ? aNorm.meta as Record<string, unknown> : {};
  const eMeta = isPlainObject(eNorm.meta) ? eNorm.meta as Record<string, unknown> : {};
  aNorm.meta = { ...aMeta, topic_oneline: '' };
  eNorm.meta = { ...eMeta, topic_oneline: '' };
  return stableStringify(aNorm) === stableStringify(eNorm);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
  return out;
}

function safeRead(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
