import { execa } from 'execa';

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

export async function commit(o: CommitOpts): Promise<void> {
  if (o.paths.length === 0) return;
  await execa('git', ['add', ...o.paths], { cwd: o.cwd });
  await execa('git', ['commit', '-m', o.message], { cwd: o.cwd });
}

export async function dirtyPathsOutside(o: { cwd: string; allowedPrefixes: string[] }): Promise<string[]> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: o.cwd });
  const paths = stdout.split('\n').filter(Boolean).map((line) => {
    // porcelain v1: XY <path> — path starts at column 3. Renames have " -> " separator; take the new path.
    const raw = line.slice(3);
    const arrow = raw.indexOf(' -> ');
    return arrow >= 0 ? raw.slice(arrow + 4) : raw;
  });
  return paths.filter((p) => !o.allowedPrefixes.some((pref) => p === pref || p.startsWith(pref)));
}

export async function pushBranch(o: { cwd: string; branch: string }): Promise<void> {
  if (process.env.RESEARCHER_NO_REMOTE === '1') return;
  await execa('git', ['push', '-u', 'origin', o.branch], { cwd: o.cwd });
}

export async function ghPrCreate(o: { cwd: string; title: string; bodyFile: string }): Promise<string> {
  if (process.env.RESEARCHER_NO_REMOTE === '1') return '(skipped: RESEARCHER_NO_REMOTE=1)';
  const { stdout } = await execa('gh', ['pr', 'create', '--draft', '--title', o.title, '--body-file', o.bodyFile], { cwd: o.cwd });
  return stdout.trim();
}
