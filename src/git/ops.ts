import { execa } from 'execa';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CreateBranchOpts { cwd: string; branch: string; }
export interface CommitOpts { cwd: string; paths: string[]; message: string; }

export async function createBranch(o: CreateBranchOpts): Promise<void> {
  await execa('git', ['checkout', '-b', o.branch], { cwd: o.cwd });
}

export async function getCurrentBranch(o: { cwd: string }): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: o.cwd });
  return stdout.trim();
}

export async function checkout(o: { cwd: string; branch: string }): Promise<void> {
  await execa('git', ['checkout', o.branch], { cwd: o.cwd });
}

export async function commit(o: CommitOpts): Promise<{ committed: boolean }> {
  if (o.paths.length === 0) return { committed: false };
  await execa('git', ['add', ...o.paths], { cwd: o.cwd });
  // With only untracked noise in the tree, `git commit` exits 1 when the index
  // has no staged delta ("nothing added to commit but untracked files present").
  // Setup/apply must tolerate re-applying identical soul files (#106 apply path).
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd: o.cwd });
  if (!stdout.trim()) return { committed: false };
  await execa('git', ['commit', '-m', o.message], { cwd: o.cwd });
  return { committed: true };
}

export async function dirtyPathsOutside(o: { cwd: string; allowedPrefixes: string[] }): Promise<string[]> {
  // -uall surfaces individual untracked files (default 'normal' collapses dirs to "notes/"),
  // so callers' per-file allowedPrefixes (e.g. notes/<current-paper>.md) match correctly.
  const { stdout } = await execa('git', ['status', '--porcelain', '-uall'], { cwd: o.cwd });
  const paths = stdout.split('\n').filter(Boolean).map((line) => {
    // porcelain v1: XY <path> — path starts at column 3. Renames have " -> " separator; take the new path.
    const raw = line.slice(3);
    const arrow = raw.indexOf(' -> ');
    return arrow >= 0 ? raw.slice(arrow + 4) : raw;
  });
  return paths.filter((p) => !o.allowedPrefixes.some((pref) => p === pref || p.startsWith(pref)));
}

export async function pushBranch(o: { cwd: string; branch: string; remote: boolean }): Promise<void> {
  if (!o.remote) return;
  await execa('git', ['push', '-u', 'origin', o.branch], { cwd: o.cwd });
}

/** Stash current working tree (including untracked, excluding gitignored). Returns true if anything was stashed. */
export async function stash(o: { cwd: string; message: string }): Promise<boolean> {
  const r = await execa('git', ['stash', 'push', '--include-untracked', '-m', o.message], { cwd: o.cwd });
  return /Saved working directory/i.test(r.stdout);
}

export async function stashDrop(o: { cwd: string }): Promise<void> {
  await execa('git', ['stash', 'drop'], { cwd: o.cwd });
}

/** Restore the most recent stash onto the working tree (may leave conflicts). */
export async function stashPop(o: { cwd: string }): Promise<void> {
  await execa('git', ['stash', 'pop'], { cwd: o.cwd });
}

/** Best-effort fast-forward pull from origin/<branch>. Silently no-ops when local-only / offline / no remote. */
export async function pullFastForward(o: { cwd: string; branch: string; remote: boolean }): Promise<void> {
  if (!o.remote) return;
  try {
    await execa('git', ['pull', '--ff-only', 'origin', o.branch], { cwd: o.cwd });
  } catch {
    /* offline or no remote — caller proceeds with local state */
  }
}

export async function ghPrCreate(o: { cwd: string; title: string; bodyFile: string; remote: boolean; base?: string }): Promise<string> {
  if (!o.remote) return '(skipped: delivery.mode is local)';
  const base = o.base ?? 'main';
  const { stdout } = await execa('gh', ['pr', 'create', '--draft', '--base', base, '--title', o.title, '--body-file', o.bodyFile], { cwd: o.cwd });
  return stdout.trim();
}

/** git mv a tracked file, creating the destination's parent dir first. */
export async function move(o: { cwd: string; from: string; to: string }): Promise<void> {
  mkdirSync(dirname(join(o.cwd, o.to)), { recursive: true });
  await execa('git', ['mv', o.from, o.to], { cwd: o.cwd });
}
