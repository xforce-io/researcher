import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
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
import { sanitizeRemoteForDisplay } from './remote-display.js';
import { classifyTopicGit, isSubmodulePath } from './topic-git.js';
import { WorkspaceSyncError } from './sync.js';

export interface PublishOptions {
  cwd: string;
  path: string;
  remote: string;
  dryRun?: boolean;
}

export interface PublishPlan {
  cwd: string;
  path: string;
  absPath: string;
  remote: string;
  displayRemote: string;
  branch: string;
  head: string;
  authorized: boolean;
  blockedReason?: 'publish not enabled';
}

export interface PublishResult {
  path: string;
  origin: string;
  branch: string;
  head: string;
  dryRun: boolean;
}

export function prepareWorkspacePublish(opts: PublishOptions): PublishPlan {
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
    isAbsolute(opts.path) ||
    win32.isAbsolute(opts.path) ||
    opts.path.split(/[/\\]/).some((segment) => segment === '..')
  ) {
    throw new WorkspaceSyncError(`topic path must be inside workspace: ${opts.path}`, 2);
  }

  const cwd = resolve(opts.cwd);
  const absPath = resolve(cwd, opts.path);
  const relativePath = relative(cwd, absPath);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new WorkspaceSyncError(`topic path must be inside workspace: ${opts.path}`, 2);
  }

  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(cwd));
  const topic = manifest.topics.find((candidate) => candidate.path === opts.path);
  if (!topic) {
    throw new WorkspaceSyncError(
      `path "${opts.path}" is not in workspace manifest`,
      2,
    );
  }

  const info = classifyTopicGit(cwd, opts.path);
  if (info.kind === 'missing') {
    throw new WorkspaceSyncError(`topic directory missing: ${opts.path}`, 2);
  }
  if (info.kind === 'not-git') {
    throw new WorkspaceSyncError(`topic is not a git repo: ${opts.path}`, 2);
  }
  if (isSubmodulePath(cwd, opts.path) || info.kind === 'submodule') {
    throw new WorkspaceSyncError(
      `topic "${opts.path}" is already a submodule`,
      1,
    );
  }
  if (info.originUrl) {
    throw new WorkspaceSyncError(
      `topic "${opts.path}" already has origin (${sanitizeRemoteForDisplay(info.originUrl)})`,
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

  const authorized = topic.publish;
  return {
    cwd,
    path: opts.path,
    absPath,
    remote: opts.remote,
    displayRemote: sanitizeRemoteForDisplay(opts.remote),
    branch: info.branch,
    head: info.head,
    authorized,
    ...(authorized ? {} : { blockedReason: 'publish not enabled' as const }),
  };
}

export async function executeWorkspacePublish(plan: PublishPlan): Promise<PublishResult> {
  if (!plan.authorized) {
    throw new WorkspaceSyncError(`topic "${plan.path}" is not enabled for publish`, 2);
  }

  await addOrigin(plan.absPath, plan.remote);
  await pushHead(plan.absPath, plan.branch);
  await registerExistingAsSubmodule({
    root: plan.cwd,
    path: plan.path,
    url: plan.remote,
    sha: plan.head,
  });

  return {
    path: plan.path,
    origin: plan.displayRemote,
    branch: plan.branch,
    head: plan.head,
    dryRun: false,
  };
}
