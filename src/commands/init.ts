import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { resolvePackageRoot, resolveProjectResearcherDir } from '../paths.js';

/** Root-level ignore rules for milkie cwd runtime (not covered by .researcher/.gitignore). */
export const MILKIE_RUNTIME_GITIGNORE = [
  '# milkie agent runtime (local-only; agents.json may still be committed)',
  '.milkie/runs/',
  '.milkie/objects/',
  '.milkie/state.sqlite',
].join('\n');

export interface InitOptions {
  targetDir: string;
}

export interface ScaffoldOptions {
  /** Repo root (already validated to be a git toplevel). */
  repoRoot: string;
}

export interface ScaffoldMilkieRuntimeOptions {
  root: string;
}

const MANAGED_MILKIE_AGENTS = [
  { id: 'researcher', file: '../agents/researcher.md', target: 'researcher.md', template: 'milkie-researcher.md' },
  { id: 'researcher-collect', file: '../agents/researcher-collect.md', target: 'researcher-collect.md', template: 'milkie-researcher-collect.md' },
  { id: 'researcher-triage', file: '../agents/researcher-triage.md', target: 'researcher-triage.md', template: 'milkie-researcher-triage.md' },
] as const;

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
    throw new Error(`must be run at the repo root (${toplevel}), not ${targetReal}`);
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
  scaffoldMilkieRuntime({ root: opts.repoRoot });
  writeFileSync(join(target, 'state/seen.jsonl'), '');
}

/**
 * Ensure the topic repo root `.gitignore` ignores milkie runtime artifacts.
 * Idempotent: skips when the marker paths are already present.
 * Called from scaffold so init / library-read / web setup all get the rules.
 */
export function ensureMilkieGitignore(root: string): void {
  const gi = join(root, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (
    existing.includes('.milkie/runs/') ||
    existing.includes('.milkie/objects/') ||
    /(^|\n)\.milkie\/(\n|$)/.test(existing)
  ) {
    return;
  }
  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const block = existing.length === 0 ? `${MILKIE_RUNTIME_GITIGNORE}\n` : `${sep}\n${MILKIE_RUNTIME_GITIGNORE}\n`;
  writeFileSync(gi, existing + block);
}

export function scaffoldMilkieRuntime(opts: ScaffoldMilkieRuntimeOptions): void {
  const pkg = resolvePackageRoot();
  mkdirSync(join(opts.root, '.milkie'), { recursive: true });
  mkdirSync(join(opts.root, 'agents'), { recursive: true });
  const agentsJson = join(opts.root, '.milkie/agents.json');
  if (!existsSync(agentsJson)) {
    copyFileSync(join(pkg, 'templates/milkie-agents.json'), agentsJson);
  } else {
    mergeManagedAgentEntries(agentsJson);
  }
  for (const { target, template } of MANAGED_MILKIE_AGENTS) {
    const agentPath = join(opts.root, 'agents', target);
    if (!existsSync(agentPath)) {
      copyFileSync(join(pkg, 'templates', template), agentPath);
    }
  }
  ensureMilkieGitignore(opts.root);
}

function mergeManagedAgentEntries(agentsJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(agentsJson, 'utf8'));
  } catch (error) {
    throw new Error(`cannot migrate ${agentsJson}: invalid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.agents)) {
    throw new Error(`cannot migrate ${agentsJson}: expected an object with an agents array`);
  }

  const registeredIds = new Set(
    parsed.agents.flatMap((agent) => isRecord(agent) && typeof agent.id === 'string' ? [agent.id] : []),
  );
  const additions = MANAGED_MILKIE_AGENTS
    .filter((agent) => !registeredIds.has(agent.id))
    .map(({ id, file }) => ({ id, file }));
  if (additions.length === 0) return;

  writeFileSync(
    agentsJson,
    `${JSON.stringify({ ...parsed, agents: [...parsed.agents, ...additions] }, null, 2)}\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function runInit(opts: InitOptions): Promise<void> {
  const repoRoot = validateRepoRoot(opts.targetDir);
  scaffoldTopicRepo({ repoRoot });
  const target = resolveProjectResearcherDir(repoRoot);
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
