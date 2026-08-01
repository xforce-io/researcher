import { resolve } from 'node:path';
import {
  formatSyncSummary,
  runWorkspaceSync,
  WorkspaceSyncError,
} from '../workspace/sync.js';
import {
  executeWorkspacePublish,
  prepareWorkspacePublish,
} from '../workspace/publish.js';

export interface WorkspaceSyncCliOpts {
  cwd?: string;
  pull?: boolean;
  pushTopics?: boolean;
  pointers?: boolean;
  all?: boolean;
  dryRun?: boolean;
}

export interface WorkspacePublishCliOpts {
  cwd?: string;
  remote: string;
  dryRun?: boolean;
}

export async function runWorkspaceSyncCli(opts: WorkspaceSyncCliOpts = {}): Promise<void> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  try {
    const res = await runWorkspaceSync({
      cwd,
      pull: opts.pull,
      pushTopics: opts.pushTopics,
      pointers: opts.pointers,
      all: opts.all,
      dryRun: opts.dryRun,
    });
    process.stdout.write(formatSyncSummary(res) + '\n');
    if (res.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof WorkspaceSyncError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  }
}

export async function runWorkspacePublishCli(
  path: string,
  opts: WorkspacePublishCliOpts,
): Promise<void> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  try {
    const plan = prepareWorkspacePublish({
      cwd,
      path,
      remote: opts.remote,
      dryRun: opts.dryRun,
    });
    if (opts.dryRun) {
      if (!plan.authorized) {
        process.stdout.write(
          `workspace publish dry-run: ${plan.path} blocked: publish not enabled\n`,
        );
        return;
      }
      process.stdout.write(
        `workspace publish dry-run: would add origin ${plan.displayRemote} on ${plan.path} ` +
          `(${plan.branch} @ ${plan.head.slice(0, 7)}) and register submodule\n`,
      );
      return;
    }
    if (!plan.authorized) {
      throw new WorkspaceSyncError(`topic "${path}" is not enabled for publish`, 2);
    }
    const res = await executeWorkspacePublish(plan);
    process.stdout.write(
      `workspace publish: ${res.path} → origin ${res.origin} (${res.branch})\n` +
        `registered submodule and committed gitlink in super-repo\n`,
    );
  } catch (err) {
    if (err instanceof WorkspaceSyncError) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    // normalize plain errors from publish into exit 1
    if (err instanceof Error) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
