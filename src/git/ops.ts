import { execa } from 'execa';

export interface CreateBranchOpts { cwd: string; branch: string; }
export interface CommitOpts { cwd: string; paths: string[]; message: string; }

export async function createBranch(o: CreateBranchOpts): Promise<void> {
  await execa('git', ['checkout', '-b', o.branch], { cwd: o.cwd });
}

export async function commit(o: CommitOpts): Promise<void> {
  if (o.paths.length === 0) return;
  await execa('git', ['add', ...o.paths], { cwd: o.cwd });
  await execa('git', ['commit', '-m', o.message], { cwd: o.cwd });
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
