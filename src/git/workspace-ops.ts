import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa, execaSync } from 'execa';

export async function fetchOrigin(cwd: string): Promise<void> {
  await execa('git', ['fetch', 'origin'], { cwd });
}

/** Fast-forward the current branch from origin/<branch>. Throws on non-ff. */
export async function pullFfCurrent(cwd: string, branch: string): Promise<void> {
  await execa('git', ['pull', '--ff-only', 'origin', branch], { cwd });
}

/** Push current HEAD to origin, setting upstream when needed. */
export async function pushHead(cwd: string, branch: string): Promise<void> {
  await execa('git', ['push', '-u', 'origin', branch], { cwd });
}

export function getGitlinkSha(root: string, relPath: string): string | undefined {
  try {
    const out = execaSync('git', ['ls-files', '-s', '--', relPath], { cwd: root }).stdout.trim();
    const line = out.split('\n').find((l) => l.startsWith('160000'));
    if (!line) return undefined;
    // format: 160000 <sha> 0\t<path>
    const parts = line.split(/\s+/);
    return parts[1];
  } catch {
    return undefined;
  }
}

export async function stageGitlink(root: string, relPath: string, sha: string): Promise<void> {
  await execa('git', ['update-index', '--add', '--cacheinfo', `160000,${sha},${relPath}`], {
    cwd: root,
  });
}

export async function stagePaths(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await execa('git', ['add', '--', ...paths], { cwd: root });
}

export async function commitIfStaged(
  root: string,
  message: string,
): Promise<{ committed: boolean }> {
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd: root });
  if (!stdout.trim()) return { committed: false };
  await execa('git', ['commit', '-m', message], { cwd: root });
  return { committed: true };
}

export async function listStagedPaths(root: string): Promise<string[]> {
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root });
  return stdout.split('\0').filter(Boolean);
}

export async function assertNoStagedChanges(root: string): Promise<void> {
  const paths = await listStagedPaths(root);
  if (paths.length > 0) {
    throw new Error(`super-repo has staged changes: ${paths.join(', ')}`);
  }
}

/**
 * Register an already-populated topic directory as a submodule of the super-repo.
 * Does not require the directory to be empty (unlike `git submodule add`).
 */
export async function registerExistingAsSubmodule(o: {
  root: string;
  path: string;
  url: string;
  sha: string;
}): Promise<void> {
  const gmPath = join(o.root, '.gitmodules');
  const section = `[submodule "${o.path}"]\n\tpath = ${o.path}\n\turl = ${o.url}\n`;
  if (existsSync(gmPath)) {
    const cur = readFileSync(gmPath, 'utf8');
    if (!new RegExp(`^\\s*path\\s*=\\s*${escapeRegExp(o.path)}\\s*$`, 'm').test(cur)) {
      writeFileSync(gmPath, cur.endsWith('\n') ? cur + section : cur + '\n' + section, 'utf8');
    }
  } else {
    writeFileSync(gmPath, section, 'utf8');
  }

  // If the path was previously tracked as normal files, remove from index (keep disk).
  try {
    await execa('git', ['rm', '-r', '--cached', '-f', '--', o.path], { cwd: o.root });
  } catch {
    /* may be untracked — fine */
  }

  await stageGitlink(o.root, o.path, o.sha);
  await execa('git', ['add', '--', '.gitmodules'], { cwd: o.root });
  await execa(
    'git',
    ['commit', '-m', `workspace publish: add submodule ${o.path}`],
    { cwd: o.root },
  );

  // Ensure local gitlinks config knows the url (best-effort).
  try {
    await execa('git', ['config', '-f', '.gitmodules', `submodule.${o.path}.url`, o.url], {
      cwd: o.root,
    });
    await execa('git', ['submodule', 'sync', '--', o.path], { cwd: o.root });
  } catch {
    /* optional */
  }
}

export async function addOrigin(cwd: string, url: string): Promise<void> {
  await execa('git', ['remote', 'add', 'origin', url], { cwd });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface GitmodulesSnapshot {
  existed: boolean;
  content?: Buffer;
}

export function snapshotGitmodules(root: string): GitmodulesSnapshot {
  const path = join(root, '.gitmodules');
  return existsSync(path)
    ? { existed: true, content: readFileSync(path) }
    : { existed: false };
}

export function restoreGitmodules(root: string, snapshot: GitmodulesSnapshot): void {
  const path = join(root, '.gitmodules');
  if (snapshot.existed) {
    writeFileSync(path, snapshot.content ?? Buffer.alloc(0));
    return;
  }
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/** Reject when `.gitmodules` has unstaged or staged worktree changes. Missing file is clean. */
export async function assertGitmodulesClean(root: string): Promise<void> {
  const path = join(root, '.gitmodules');
  if (!existsSync(path)) return;
  try {
    await execa('git', ['diff', '--quiet', '--', '.gitmodules'], { cwd: root });
    await execa('git', ['diff', '--quiet', '--cached', '--', '.gitmodules'], { cwd: root });
  } catch (err) {
    // git diff --quiet exits 1 when differences exist; missing path is already handled.
    let code: number | undefined;
    if (err && typeof err === 'object' && 'exitCode' in err) {
      const raw = err.exitCode;
      if (typeof raw === 'number') code = raw;
    }
    if (code === 1) {
      throw new Error('super-repo has dirty .gitmodules; commit or discard changes first');
    }
    throw err;
  }
}

export async function removeOriginIfMatches(cwd: string, expectedUrl: string): Promise<void> {
  let current: string | undefined;
  try {
    current = (await execa('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim();
  } catch {
    return;
  }
  if (current !== expectedUrl) return;
  await execa('git', ['remote', 'remove', 'origin'], { cwd });
}
