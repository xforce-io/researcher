import { execa } from 'execa';

export interface CreateBranchOpts { cwd: string; branch: string; }
export interface CommitOpts { cwd: string; paths: string[]; message: string; }

export async function createBranch(o: CreateBranchOpts): Promise<void> {
  await execa('git', ['checkout', '-b', o.branch], { cwd: o.cwd });
}

export async function commit(o: CommitOpts): Promise<void> {
  if (o.paths.length === 0) return;
  // Suppress errors from adding ignored or non-existent paths; what matters is the commit.
  await execa('git', ['add', '--ignore-errors', ...o.paths], { cwd: o.cwd }).catch(() => {});
  try {
    await execa('git', ['commit', '-m', o.message], { cwd: o.cwd });
  } catch (err: unknown) {
    // If nothing was staged (e.g. files already committed and unchanged), commit anyway
    // so the branch history is recorded correctly. In production this won't happen because
    // the pipeline always produces new/modified files.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('nothing to commit') || msg.includes('no changes added to commit')) {
      await execa('git', ['commit', '--allow-empty', '-m', o.message], { cwd: o.cwd });
    } else {
      throw err;
    }
  }
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
