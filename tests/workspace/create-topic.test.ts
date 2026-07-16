import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { execaSync } from 'execa';
import {
  createWorkspaceTopic,
  normalizeTopicPath,
} from '../../src/workspace/create-topic.js';
import { loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../../src/workspace/manifest.js';
import { resolveProjectResearcherDir } from '../../src/paths.js';

function setupWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'r-create-topic-'));
  writeFileSync(
    resolveWorkspaceManifestPath(root),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n',
  );
  return root;
}

describe('normalizeTopicPath', () => {
  it('accepts single and nested segments', () => {
    expect(normalizeTopicPath('decision')).toBe('decision');
    expect(normalizeTopicPath('feeds/ai-safety')).toBe('feeds/ai-safety');
    expect(normalizeTopicPath('  a.b_c-1  ')).toBe('a.b_c-1');
  });

  it('slugifies spaces and case (human-friendly folder labels)', () => {
    expect(normalizeTopicPath('world model')).toBe('world-model');
    expect(normalizeTopicPath('World Model')).toBe('world-model');
    expect(normalizeTopicPath('feeds/AI Safety')).toBe('feeds/ai-safety');
    expect(normalizeTopicPath('a b')).toBe('a-b');
  });

  it.each([
    '',
    '.',
    '..',
    '../x',
    '/abs',
    'a//b',
    'a/b/c/d',
    'a\\b',
    '~/.ssh',
    'http://x',
    './x',
    '决策',
  ])('rejects %j', (raw) => {
    expect(() => normalizeTopicPath(raw)).toThrow(/folder name/i);
  });
});

describe('createWorkspaceTopic', () => {
  it('scaffolds a git topic, writes oneline, and registers the manifest', () => {
    const root = setupWorkspace();
    const result = createWorkspaceTopic({
      root,
      path: 'probe-topic',
      oneline: 'A probe pillar for web create',
    });

    expect(result.path).toBe('probe-topic');
    expect(result.slug).toBe('probe-topic');
    expect(existsSync(join(result.topicDir, '.git'))).toBe(true);
    expect(existsSync(resolveProjectResearcherDir(result.topicDir))).toBe(true);

    const projectYaml = readFileSync(
      join(resolveProjectResearcherDir(result.topicDir), 'project.yaml'),
      'utf8',
    );
    expect(projectYaml).toContain('topic_oneline: "A probe pillar for web create"');

    const log = execaSync('git', ['log', '-1', '--pretty=%s'], { cwd: result.topicDir }).stdout.trim();
    expect(log).toBe('researcher: scaffold probe-topic');

    const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
    expect(manifest.topics.map((t) => t.path)).toEqual(['trace', 'probe-topic']);
    expect(manifest.topics.at(-1)).toEqual({ path: 'probe-topic', active: true });
  });

  it('supports nested paths', () => {
    const root = setupWorkspace();
    const result = createWorkspaceTopic({
      root,
      path: 'feeds/new-pillar',
      oneline: 'nested',
    });
    expect(result.path).toBe('feeds/new-pillar');
    expect(result.slug).toBe(encodeURIComponent('feeds/new-pillar'));
    expect(existsSync(join(root, 'feeds/new-pillar/.researcher'))).toBe(true);
  });

  it('rejects duplicate manifest paths without changing disk', () => {
    const root = setupWorkspace();
    expect(() =>
      createWorkspaceTopic({ root, path: 'trace', oneline: 'dup' }),
    ).toThrow(/already exists in workspace/);
    expect(existsSync(join(root, 'trace'))).toBe(false);
  });

  it('rejects an existing directory', () => {
    const root = setupWorkspace();
    mkdirSync(join(root, 'occupied'));
    expect(() =>
      createWorkspaceTopic({ root, path: 'occupied', oneline: 'x' }),
    ).toThrow(/already exists on disk/);
    const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
    expect(manifest.topics.map((t) => t.path)).toEqual(['trace']);
  });

  it('rejects empty oneline', () => {
    const root = setupWorkspace();
    expect(() => createWorkspaceTopic({ root, path: 'x', oneline: '  ' })).toThrow(/missing one-line/);
  });
});
