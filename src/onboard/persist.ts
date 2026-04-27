import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit } from '../git/ops.js';
import { resolveProjectResearcherDir } from '../paths.js';
import type { SerializedAnswer } from './state.js';

export interface WriteArtifactsOptions {
  repoRoot: string;
  projectYaml: string;
  thesisMd: string;
  slug: string;
}

export async function writeOnboardArtifacts(opts: WriteArtifactsOptions): Promise<void> {
  const dotR = resolveProjectResearcherDir(opts.repoRoot);
  writeFileSync(join(dotR, 'project.yaml'), opts.projectYaml);
  writeFileSync(join(dotR, 'thesis.md'), opts.thesisMd);
  await commit({
    cwd: opts.repoRoot,
    paths: [
      '.researcher/project.yaml',
      '.researcher/thesis.md',
      '.researcher/.gitignore',
      '.researcher/state/seen.jsonl',
    ],
    message: `researcher: onboard ${opts.slug}`,
  });
}

export type RunStatus = 'ok' | 'rewrite_failed' | 'schema_invalid' | 'user_aborted';

export interface RunResult {
  status: RunStatus;
  error?: string;
}

export interface WriteRunLogOptions {
  repoRoot: string;
  answers: SerializedAnswer[];
  prompt: string;
  response: string;
  result: RunResult;
}

export function writeRunLog(opts: WriteRunLogOptions): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(
    resolveProjectResearcherDir(opts.repoRoot),
    'state',
    'runs',
    `onboard-${ts}`
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'answers.json'), JSON.stringify(opts.answers, null, 2));
  writeFileSync(join(runDir, 'prompt.txt'), opts.prompt);
  writeFileSync(join(runDir, 'response.txt'), opts.response);
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(opts.result, null, 2));
  return runDir;
}

/**
 * Slugify Q1 answer for use in commit message: lowercase, alnum + hyphens, max 40 chars.
 */
export function makeSlug(topicOneline: string): string {
  const s = topicOneline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'topic';
}
