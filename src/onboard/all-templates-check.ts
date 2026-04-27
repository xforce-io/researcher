import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const seen = safeRead(join(dotR, 'state/seen.jsonl'));
  if (seen === null) return false;
  if (seen.length > 0) return false;
  return true;
}

function safeRead(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
