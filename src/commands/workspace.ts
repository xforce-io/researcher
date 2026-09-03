import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import {
  formatSyncSummary,
  runWorkspaceSync,
  WorkspaceSyncError,
} from '../workspace/sync.js';
import {
  executeWorkspacePublish,
  type PublishPlan,
  prepareWorkspacePublish,
} from '../workspace/publish.js';
import { sanitizeErrorText } from '../workspace/remote-display.js';

export interface WorkspaceSyncCliOpts {
  cwd?: string;
  pull?: boolean;
  pushTopics?: boolean;
  pointers?: boolean;
  library?: boolean;
  all?: boolean;
  dryRun?: boolean;
}

export interface WorkspacePublishCliOpts {
  cwd?: string;
  remote: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface WorkspacePublishCliRuntime {
  isTTY: boolean;
  confirm(plan: PublishPlan): Promise<boolean>;
  writeOut(text: string): void;
  writeErr(text: string): void;
  setExitCode(code: number): void;
}

export function formatPublishPlan(plan: PublishPlan): string {
  const headShort = plan.head.slice(0, 7);
  const lines = [
    `workspace publish plan:`,
    `  path: ${plan.path}`,
    `  branch: ${plan.branch}`,
    `  head: ${headShort}`,
    `  origin: ${plan.displayRemote}`,
    `  .gitmodules: add submodule ${plan.path}`,
    `  gitlink: ${plan.path} @ ${headShort}`,
    `  super-repo: commit submodule registration`,
  ];
  if (!plan.authorized) {
    lines.push(`  status: blocked: publish not enabled`);
  }
  return `${lines.join('\n')}\n`;
}

async function defaultConfirm(plan: PublishPlan): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Publish ${plan.path} → ${plan.displayRemote} (${plan.branch} @ ${plan.head.slice(0, 7)})? [y/N] `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

export const processPublishRuntime: WorkspacePublishCliRuntime = {
  isTTY: Boolean(process.stdin.isTTY),
  confirm: defaultConfirm,
  writeOut: (text: string) => {
    process.stdout.write(text);
  },
  writeErr: (text: string) => {
    process.stderr.write(text);
  },
  setExitCode: (code: number) => {
    process.exitCode = code;
  },
};


export async function runWorkspaceSyncCli(opts: WorkspaceSyncCliOpts = {}): Promise<void> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  try {
    const res = await runWorkspaceSync({
      cwd,
      pull: opts.pull,
      pushTopics: opts.pushTopics,
      pointers: opts.pointers,
      library: opts.library,
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
  runtime: WorkspacePublishCliRuntime = processPublishRuntime,
): Promise<void> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  try {
    const plan = prepareWorkspacePublish({
      cwd,
      path,
      remote: opts.remote,
      dryRun: opts.dryRun,
    });
    runtime.writeOut(formatPublishPlan(plan));

    if (opts.dryRun) {
      if (!plan.authorized) {
        runtime.writeOut('blocked: publish not enabled\n');
      }
      return;
    }

    if (!plan.authorized) {
      throw new WorkspaceSyncError(`topic "${path}" is not enabled for publish`, 2);
    }
    if (!opts.yes && !runtime.isTTY) {
      throw new WorkspaceSyncError('non-interactive publish requires --yes', 2);
    }
    if (!opts.yes && !(await runtime.confirm(plan))) {
      throw new WorkspaceSyncError('publish cancelled', 2);
    }

    const res = await executeWorkspacePublish(plan);
    runtime.writeOut(
      `workspace publish: ${res.path} → origin ${res.origin} (${res.branch})\n` +
        `registered submodule and committed gitlink in super-repo\n`,
    );
  } catch (err) {
    if (err instanceof WorkspaceSyncError) {
      runtime.writeErr(`error: ${sanitizeErrorText(err.message, opts.remote)}\n`);
      runtime.setExitCode(err.exitCode);
      return;
    }
    if (err instanceof Error) {
      runtime.writeErr(`error: ${sanitizeErrorText(err.message, opts.remote)}\n`);
      runtime.setExitCode(1);
      return;
    }
    throw err;
  }
}
