import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import {
  assertNoStagedChanges,
  commitIfStaged,
  fetchOrigin,
  getGitlinkSha,
  pullFfCurrent,
  pushHead,
  stageGitlink,
  stagePaths,
} from '../git/workspace-ops.js';
import { LIBRARY_DIR } from '../library/store.js';
import { classifyTopicGit, type TopicGitInfo } from './topic-git.js';
import {
  activeTopics,
  hasWorkspaceManifest,
  loadWorkspaceManifest,
  resolveWorkspaceManifestPath,
  type WorkspaceTopic,
} from './manifest.js';
import { sanitizeErrorText } from './remote-display.js';

export type StepStatus = 'ok' | 'skipped' | 'failed' | 'dry-run';

export interface StepResult {
  status: StepStatus;
  message?: string;
}

export interface TopicSyncResult {
  path: string;
  kind: TopicGitInfo['kind'];
  pull?: StepResult;
  push?: StepResult;
  pointer?: StepResult;
}

export interface PointersResult {
  status: 'committed' | 'no-op' | 'dry-run' | 'failed' | 'skipped';
  count: number;
  message?: string;
}

export interface WorkspaceSyncActions {
  pull: boolean;
  pushTopics: boolean;
  pointers: boolean;
  library: boolean;
}

export interface WorkspaceSyncResult {
  actions: WorkspaceSyncActions;
  topics: TopicSyncResult[];
  dormant: string[];
  pointers?: PointersResult;
  library?: PointersResult;
  failed: number;
}

export interface WorkspaceSyncOptions {
  cwd: string;
  /** When all action flags omitted, defaults to pull-only. */
  pull?: boolean;
  pushTopics?: boolean;
  pointers?: boolean;
  library?: boolean;
  all?: boolean;
  dryRun?: boolean;
}

export class WorkspaceSyncError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 2,
  ) {
    super(message);
    this.name = 'WorkspaceSyncError';
  }
}

function resolveActions(opts: WorkspaceSyncOptions): WorkspaceSyncActions {
  const pull = opts.pull === true;
  const pushTopics = opts.pushTopics === true;
  const pointers = opts.pointers === true;
  const library = opts.library === true;
  // No action flags at all → safe default: pull-only.
  if (!pull && !pushTopics && !pointers && !library
      && opts.pull === undefined
      && opts.pushTopics === undefined
      && opts.pointers === undefined
      && opts.library === undefined) {
    return { pull: true, pushTopics: false, pointers: false, library: false };
  }
  return { pull, pushTopics, pointers, library };
}

const LIBRARY_LEDGERS = [
  'papers.jsonl',
  'reads.jsonl',
  'links.jsonl',
  'integrations.jsonl',
  'notes.jsonl',
] as const;

/** Allowlisted Library paths relative to the workspace root. */
export function listLibrarySyncPaths(root: string): string[] {
  const lib = join(root, LIBRARY_DIR);
  if (!existsSync(lib) || !statSync(lib).isDirectory()) return [];
  const out: string[] = [];
  for (const name of LIBRARY_LEDGERS) {
    const rel = `${LIBRARY_DIR}/${name}`;
    const abs = join(root, rel);
    if (existsSync(abs) && statSync(abs).isFile()) out.push(rel);
  }
  const papers = join(lib, 'papers');
  if (!existsSync(papers) || !statSync(papers).isDirectory()) return out;
  for (const paperId of readdirSync(papers)) {
    const readsDir = join(papers, paperId, 'reads');
    if (!existsSync(readsDir) || !statSync(readsDir).isDirectory()) continue;
    for (const fname of readdirSync(readsDir)) {
      if (!fname.endsWith('.md')) continue;
      const rel = `${LIBRARY_DIR}/papers/${paperId}/reads/${fname}`;
      const abs = join(root, rel);
      if (existsSync(abs) && statSync(abs).isFile()) out.push(rel);
    }
  }
  return out;
}

function pathNeedsCommit(root: string, rel: string): boolean {
  const { stdout } = execaSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', rel],
    { cwd: root },
  );
  return Boolean(stdout.trim());
}

function selectTopics(
  topics: WorkspaceTopic[],
  all: boolean | undefined,
): { selected: WorkspaceTopic[]; dormant: string[] } {
  if (all) return { selected: topics, dormant: [] };
  const selected = activeTopics({ version: 1, topics });
  const dormant = topics.filter((t) => !t.active).map((t) => t.path);
  return { selected, dormant };
}

async function doPull(
  info: TopicGitInfo,
  dryRun: boolean,
): Promise<StepResult> {
  if (info.kind === 'missing' || info.kind === 'not-git') {
    return { status: 'failed', message: info.reason };
  }
  if (info.kind === 'local-only' || !info.originUrl) {
    return { status: 'skipped', message: info.reason ?? 'no origin' };
  }
  if (!info.branch) {
    return { status: 'failed', message: 'detached HEAD (need a named branch)' };
  }
  if (dryRun) return { status: 'dry-run', message: `would pull origin/${info.branch}` };
  try {
    await fetchOrigin(info.absPath);
    await pullFfCurrent(info.absPath, info.branch);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'failed', message: errMsg(err) };
  }
}

async function doPush(
  info: TopicGitInfo,
  dryRun: boolean,
): Promise<StepResult> {
  if (info.kind === 'missing' || info.kind === 'not-git') {
    return { status: 'failed', message: info.reason };
  }
  if (info.kind === 'local-only' || !info.originUrl) {
    return { status: 'skipped', message: info.reason ?? 'no origin' };
  }
  if (!info.branch) {
    return { status: 'failed', message: 'detached HEAD (need a named branch)' };
  }
  if (dryRun) return { status: 'dry-run', message: `would push ${info.branch}` };
  try {
    await pushHead(info.absPath, info.branch);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'failed', message: errMsg(err) };
  }
}

function errMsg(err: unknown): string {
  let raw = '';
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = err.stderr;
    const s = typeof stderr === 'string' ? stderr : stderr == null ? '' : String(stderr);
    if (s.trim()) raw = s.trim().split('\n').slice(-3).join(' | ');
  }
  if (!raw) raw = err instanceof Error ? err.message : String(err);
  return sanitizeErrorText(raw);
}

export async function runWorkspaceSync(opts: WorkspaceSyncOptions): Promise<WorkspaceSyncResult> {
  if (!hasWorkspaceManifest(opts.cwd)) {
    throw new WorkspaceSyncError(
      `not a workspace root: missing researcher.workspace.yml in ${opts.cwd}`,
      2,
    );
  }
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(opts.cwd));
  const actions = resolveActions(opts);
  const dryRun = opts.dryRun === true;
  const { selected, dormant } = selectTopics(manifest.topics, opts.all);

  const topics: TopicSyncResult[] = [];
  let failed = 0;

  for (const t of selected) {
    // Re-classify each time so pull can refresh head before pointers.
    let info = classifyTopicGit(opts.cwd, t.path);
    const row: TopicSyncResult = { path: t.path, kind: info.kind };
    let topicFailed = false;

    if (actions.pull) {
      row.pull = await doPull(info, dryRun);
      if (row.pull.status === 'failed') topicFailed = true;
      // refresh after pull
      info = classifyTopicGit(opts.cwd, t.path);
      row.kind = info.kind;
    }

    if (actions.pushTopics) {
      row.push = await doPush(info, dryRun);
      if (row.push.status === 'failed') topicFailed = true;
      info = classifyTopicGit(opts.cwd, t.path);
      row.kind = info.kind;
    }

    if (topicFailed) failed += 1;
    topics.push(row);
  }

  let pointers: PointersResult | undefined;
  if (actions.pointers) {
    pointers = await bumpPointers({
      root: opts.cwd,
      topics: selected.map((t) => t.path),
      dryRun,
    });
    if (pointers.status === 'failed') failed += 1;
  }

  let library: PointersResult | undefined;
  if (actions.library) {
    library = await commitLibrary({ root: opts.cwd, dryRun });
    if (library.status === 'failed') failed += 1;
  }

  return { actions, topics, dormant, pointers, library, failed };
}

async function bumpPointers(o: {
  root: string;
  topics: string[];
  dryRun: boolean;
}): Promise<PointersResult> {
  try {
    const { execaSync } = await import('execa');
    execaSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: o.root });
  } catch {
    return { status: 'failed', count: 0, message: 'super-repo is not a git repository' };
  }

  const pending: Array<{ path: string; sha: string }> = [];
  for (const path of o.topics) {
    const info = classifyTopicGit(o.root, path);
    if (info.kind !== 'submodule') continue;
    if (!info.head) continue;
    const recorded = getGitlinkSha(o.root, path);
    if (recorded === info.head) continue;
    pending.push({ path, sha: info.head });
  }

  if (pending.length === 0) {
    return { status: o.dryRun ? 'dry-run' : 'no-op', count: 0, message: 'no pointer drift' };
  }
  if (o.dryRun) {
    return {
      status: 'dry-run',
      count: pending.length,
      message: pending.map((p) => p.path).join(', '),
    };
  }

  try {
    await assertNoStagedChanges(o.root);
    for (const p of pending) {
      await stageGitlink(o.root, p.path, p.sha);
    }
    const { committed } = await commitIfStaged(
      o.root,
      'workspace sync: bump submodule pointers',
    );
    if (!committed) return { status: 'no-op', count: 0 };
    return { status: 'committed', count: pending.length };
  } catch (err) {
    return { status: 'failed', count: 0, message: errMsg(err) };
  }
}

async function commitLibrary(o: {
  root: string;
  dryRun: boolean;
}): Promise<PointersResult> {
  try {
    execaSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: o.root });
  } catch {
    return { status: 'failed', count: 0, message: 'super-repo is not a git repository' };
  }

  const pending = listLibrarySyncPaths(o.root).filter((rel) => pathNeedsCommit(o.root, rel));
  if (pending.length === 0) {
    return { status: o.dryRun ? 'dry-run' : 'no-op', count: 0 };
  }
  if (o.dryRun) {
    return { status: 'dry-run', count: pending.length };
  }

  try {
    await assertNoStagedChanges(o.root);
    await stagePaths(o.root, pending);
    const { committed } = await commitIfStaged(
      o.root,
      'workspace sync: commit library state',
    );
    if (!committed) return { status: 'no-op', count: 0 };
    return { status: 'committed', count: pending.length };
  } catch (err) {
    return { status: 'failed', count: 0, message: errMsg(err) };
  }
}

export function formatSyncSummary(res: WorkspaceSyncResult): string {
  const lines: string[] = ['workspace sync'];
  for (const t of res.topics) {
    const parts = [
      t.path.padEnd(24),
      `kind=${t.kind}`,
    ];
    if (t.pull) parts.push(`pull=${t.pull.status}${t.pull.message ? `(${sanitizeErrorText(t.pull.message)})` : ''}`);
    if (t.push) parts.push(`push=${t.push.status}${t.push.message ? `(${sanitizeErrorText(t.push.message)})` : ''}`);
    lines.push('  ' + parts.join('  '));
  }
  if (res.dormant.length) {
    lines.push(`dormant: ${res.dormant.join(', ')}`);
  }
  if (res.pointers) {
    lines.push(
      `pointers: ${res.pointers.status}` +
        (res.pointers.count ? ` count=${res.pointers.count}` : '') +
        (res.pointers.message ? ` (${sanitizeErrorText(res.pointers.message)})` : ''),
    );
  }
  if (res.library) {
    lines.push(
      `library: ${res.library.status}` +
        (res.library.count ? ` count=${res.library.count}` : '') +
        (res.library.message ? ` (${sanitizeErrorText(res.library.message)})` : ''),
    );
  }
  return lines.join('\n');
}
