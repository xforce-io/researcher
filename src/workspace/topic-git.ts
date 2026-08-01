import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';

export type TopicGitKind = 'missing' | 'not-git' | 'local-only' | 'remote' | 'submodule';

export interface TopicGitInfo {
  path: string;
  absPath: string;
  kind: TopicGitKind;
  originUrl?: string;
  branch?: string;
  head?: string;
  reason?: string;
}

function isGitRepo(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    execaSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

function readOriginUrl(dir: string): string | undefined {
  try {
    const url = execaSync('git', ['remote', 'get-url', 'origin'], { cwd: dir }).stdout.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

function readBranch(dir: string): string | undefined {
  try {
    const b = execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim();
    if (!b || b === 'HEAD') return undefined;
    return b;
  } catch {
    return undefined;
  }
}

function readHead(dir: string): string | undefined {
  try {
    return execaSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  } catch {
    return undefined;
  }
}

/** True when super-repo tracks path as a gitlink (mode 160000) or lists it in .gitmodules. */
export function isSubmodulePath(root: string, relPath: string): boolean {
  try {
    const ls = execaSync('git', ['ls-files', '-s', '--', relPath], { cwd: root }).stdout.trim();
    if (ls.split('\n').some((line) => line.startsWith('160000'))) return true;
  } catch {
    /* ignore */
  }
  const gm = join(root, '.gitmodules');
  if (!existsSync(gm)) return false;
  const text = readFileSync(gm, 'utf8');
  // naive but sufficient: path = <relPath> as its own line value
  return new RegExp(`^\\s*path\\s*=\\s*${escapeRegExp(relPath)}\\s*$`, 'm').test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classifyTopicGit(root: string, relPath: string): TopicGitInfo {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return { path: relPath, absPath, kind: 'missing', reason: 'missing directory' };
  }
  if (!isGitRepo(absPath)) {
    return { path: relPath, absPath, kind: 'not-git', reason: 'not a git repository' };
  }
  const originUrl = readOriginUrl(absPath);
  const branch = readBranch(absPath);
  const head = readHead(absPath);
  if (isSubmodulePath(root, relPath)) {
    return { path: relPath, absPath, kind: 'submodule', originUrl, branch, head };
  }
  if (originUrl) {
    return { path: relPath, absPath, kind: 'remote', originUrl, branch, head };
  }
  return { path: relPath, absPath, kind: 'local-only', branch, head, reason: 'no origin' };
}
