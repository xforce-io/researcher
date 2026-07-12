import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execaSync } from 'execa';
import { scaffoldTopicRepo } from '../commands/init.js';
import { resolveProjectResearcherDir } from '../paths.js';
import {
  addTopicToManifest,
  loadWorkspaceManifest,
  resolveWorkspaceManifestPath,
} from './manifest.js';

export interface CreateWorkspaceTopicInput {
  root: string;
  path: string;
  oneline: string;
}

export interface CreateWorkspaceTopicResult {
  path: string;
  slug: string;
  topicDir: string;
}

const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_SEGMENTS = 3;
const MAX_PATH_LEN = 64;

export function normalizeTopicPath(raw: string): string {
  const path = raw.trim();
  if (!path) throw new Error('invalid topic path');
  // Reject backslashes instead of rewriting them (path is a workspace-relative slug).
  if (path.includes('\\')) throw new Error('invalid topic path');
  if (path.startsWith('/') || path.includes('://') || path.includes('~')) {
    throw new Error('invalid topic path');
  }
  if (path.startsWith('./') || path.endsWith('/') || path.includes('//')) {
    throw new Error('invalid topic path');
  }
  if (path.length > MAX_PATH_LEN) throw new Error('invalid topic path');
  const segments = path.split('/');
  if (segments.length < 1 || segments.length > MAX_SEGMENTS) {
    throw new Error('invalid topic path');
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || !SEGMENT.test(seg)) {
      throw new Error('invalid topic path');
    }
  }
  return path;
}

function assertInsideRoot(root: string, topicDir: string): void {
  const base = resolve(root);
  const dir = resolve(topicDir);
  if (dir !== base && !dir.startsWith(base + sep)) {
    throw new Error('invalid topic path');
  }
}

function writeTopicOneline(topicDir: string, oneline: string): void {
  const projectYaml = join(resolveProjectResearcherDir(topicDir), 'project.yaml');
  const raw = readFileSync(projectYaml, 'utf8');
  // Keep template comments/order; only replace the topic_oneline value line.
  const escaped = JSON.stringify(oneline);
  const next = raw.replace(
    /^([ \t]*topic_oneline:[ \t]*).*$/m,
    `$1${escaped}`,
  );
  if (next === raw) {
    throw new Error('project.yaml missing topic_oneline field; template may have drifted');
  }
  writeFileSync(projectYaml, next, 'utf8');
}

/**
 * Create a local topic pillar under a workspace super-repo:
 * directory + git + .researcher scaffold + oneline + manifest registration.
 */
export function createWorkspaceTopic(input: CreateWorkspaceTopicInput): CreateWorkspaceTopicResult {
  const path = normalizeTopicPath(input.path);
  const oneline = input.oneline.trim();
  if (!oneline) throw new Error('missing one-line');

  const root = resolve(input.root);
  const manifestPath = resolveWorkspaceManifestPath(root);
  if (!existsSync(manifestPath)) {
    throw new Error(`no researcher.workspace.yml in ${root}`);
  }

  const manifest = loadWorkspaceManifest(manifestPath);
  if (manifest.topics.some((t) => t.path === path)) {
    throw new Error(`topic already exists in workspace: ${path}`);
  }

  const topicDir = join(root, path);
  assertInsideRoot(root, topicDir);
  if (existsSync(topicDir)) {
    throw new Error(`path already exists on disk: ${path}`);
  }

  let created = false;
  try {
    mkdirSync(topicDir, { recursive: true });
    created = true;
    execaSync('git', ['init', '-b', 'main'], { cwd: topicDir });
    scaffoldTopicRepo({ repoRoot: topicDir });
    writeTopicOneline(topicDir, oneline);
    execaSync('git', ['add', '.'], { cwd: topicDir });
    execaSync(
      'git',
      [
        '-c', 'user.email=researcher@local',
        '-c', 'user.name=researcher',
        'commit',
        '-m',
        `researcher: scaffold ${path}`,
      ],
      { cwd: topicDir },
    );
    addTopicToManifest(manifestPath, { path, active: true });
  } catch (err) {
    if (created && existsSync(topicDir)) {
      try { rmSync(topicDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    throw err;
  }

  return { path, slug: encodeURIComponent(path), topicDir };
}
