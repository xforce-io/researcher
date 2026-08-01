import {
  addOrigin,
  pushHead,
  registerExistingAsSubmodule,
} from '../git/workspace-ops.js';
import {
  hasWorkspaceManifest,
  loadWorkspaceManifest,
  resolveWorkspaceManifestPath,
} from './manifest.js';
import { classifyTopicGit, isSubmodulePath } from './topic-git.js';
import { WorkspaceSyncError } from './sync.js';

export interface PublishOptions {
  cwd: string;
  path: string;
  remote: string;
  dryRun?: boolean;
}

export interface PublishResult {
  path: string;
  origin: string;
  branch: string;
  head: string;
  dryRun: boolean;
}

export async function publishWorkspaceTopic(opts: PublishOptions): Promise<PublishResult> {
  if (!hasWorkspaceManifest(opts.cwd)) {
    throw new WorkspaceSyncError(
      `not a workspace root: missing researcher.workspace.yml in ${opts.cwd}`,
      2,
    );
  }
  if (!opts.remote?.trim()) {
    throw new WorkspaceSyncError('publish requires --remote <git-url>', 2);
  }
  if (
    !opts.path ||
    opts.path.includes('\0') ||
    opts.path.startsWith('/') ||
    opts.path.split(/[/\\]/).some((s) => s === '..')
  ) {
    throw new WorkspaceSyncError(`invalid topic path: ${opts.path}`, 2);
  }


  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(opts.cwd));
  if (!manifest.topics.some((t) => t.path === opts.path)) {
    throw new WorkspaceSyncError(
      `path "${opts.path}" is not in workspace manifest`,
      2,
    );
  }

  const info = classifyTopicGit(opts.cwd, opts.path);
  if (info.kind === 'missing') {
    throw new WorkspaceSyncError(`topic directory missing: ${opts.path}`, 2);
  }
  if (info.kind === 'not-git') {
    throw new WorkspaceSyncError(`topic is not a git repo: ${opts.path}`, 2);
  }
  if (isSubmodulePath(opts.cwd, opts.path) || info.kind === 'submodule') {
    throw new WorkspaceSyncError(
      `topic "${opts.path}" is already a submodule`,
      1,
    );
  }
  if (info.originUrl) {
    throw new WorkspaceSyncError(
      `topic "${opts.path}" already has origin (${info.originUrl})`,
      1,
    );
  }
  if (!info.branch) {
    throw new WorkspaceSyncError(
      `topic "${opts.path}" is detached HEAD; checkout a named branch first`,
      1,
    );
  }
  if (!info.head) {
    throw new WorkspaceSyncError(`topic "${opts.path}" has no HEAD commit`, 1);
  }

  if (opts.dryRun) {
    return {
      path: opts.path,
      origin: opts.remote,
      branch: info.branch,
      head: info.head,
      dryRun: true,
    };
  }

  await addOrigin(info.absPath, opts.remote);
  await pushHead(info.absPath, info.branch);
  await registerExistingAsSubmodule({
    root: opts.cwd,
    path: opts.path,
    url: opts.remote,
    sha: info.head,
  });

  return {
    path: opts.path,
    origin: opts.remote,
    branch: info.branch,
    head: info.head,
    dryRun: false,
  };
}
