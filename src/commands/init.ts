import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

export interface InitOptions {
  targetDir: string;
}

export interface ScaffoldOptions {
  /** Repo root (already validated to be a git toplevel). */
  repoRoot: string;
}

function gitToplevel(dir: string): string | null {
  try {
    const { stdout } = execaSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Validate that `targetDir` is the root of a git repo. Returns the canonical
 * git toplevel path. Throws with a user-readable message on failure.
 */
export function validateRepoRoot(targetDir: string): string {
  const toplevel = gitToplevel(targetDir);
  if (toplevel === null) {
    throw new Error(`${targetDir} is not inside a git repo (run \`git init\` first)`);
  }
  const targetReal = realpathSync(targetDir);
  if (targetReal !== toplevel) {
    throw new Error(`init must be run at the repo root (${toplevel}), not ${targetReal}`);
  }
  return toplevel;
}

/**
 * Copy templates into <repoRoot>/.researcher/. Pure file-system work — caller
 * is responsible for repo validation and "already onboarded" detection.
 */
export function scaffoldTopicRepo(opts: ScaffoldOptions): void {
  const target = resolveProjectResearcherDir(opts.repoRoot);
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  const pkg = resolvePackageRoot();
  mkdirSync(join(target, 'state'), { recursive: true });
  copyFileSync(join(pkg, 'templates/project.yaml'), join(target, 'project.yaml'));
  copyFileSync(join(pkg, 'templates/thesis.md'), join(target, 'thesis.md'));
  copyFileSync(join(pkg, 'templates/researcher-gitignore'), join(target, '.gitignore'));
  writeFileSync(join(target, 'state/seen.jsonl'), '');
}

export async function runInit(opts: InitOptions): Promise<void> {
  const repoRoot = validateRepoRoot(opts.targetDir);
  scaffoldTopicRepo({ repoRoot });
  const target = resolveProjectResearcherDir(opts.targetDir);
  process.stdout.write(`initialized ${target}\n`);
  process.stdout.write(`next steps:\n`);
  process.stdout.write(
    `  1. edit .researcher/project.yaml — declare your research questions and sources\n`
  );
  process.stdout.write(`  2. edit .researcher/thesis.md — state your working thesis\n`);
  process.stdout.write(
    `  3. run \`researcher methodology install\` once globally to install methodology\n`
  );
  process.stdout.write(
    `  4. then \`researcher add <arxiv_id>\` to ingest your first paper\n`
  );
}
