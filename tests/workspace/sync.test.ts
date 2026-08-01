import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { runWorkspaceSync } from '../../src/workspace/sync.js';
import { publishWorkspaceTopic } from '../../src/workspace/publish.js';
import { classifyTopicGit } from '../../src/workspace/topic-git.js';

function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
  // Allow file:// remotes for local bare fixtures (git ≥2.38 defaults deny).
  execaSync('git', ['config', 'protocol.file.allow', 'always'], { cwd: dir });
}

/** Register path as submodule without `git submodule add` (file transport quirks). */
function addSubmoduleManual(root: string, bare: string, path: string, srcDir: string): void {
  // Move/copy checkout into place as a nested repo, then write gitlink + .gitmodules.
  execaSync('cp', ['-R', srcDir, join(root, path)]);
  const sha = execaSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, path) }).stdout.trim();
  const gm = join(root, '.gitmodules');
  const section = `[submodule "${path}"]\n\tpath = ${path}\n\turl = ${bare}\n`;
  writeFileSync(gm, existsSync(gm) ? readFileSync(gm, 'utf8') + section : section);
  execaSync('git', ['update-index', '--add', '--cacheinfo', `160000,${sha},${path}`], { cwd: root });
  execaSync('git', ['add', '.gitmodules'], { cwd: root });
}

function gitCommitAll(dir: string, message: string): string {
  execaSync('git', ['add', '-A'], { cwd: dir });
  execaSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: dir });
  return execaSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
}

function makeBare(root: string, name: string): string {
  const bare = join(root, `${name}.git`);
  execaSync('git', ['init', '--bare', '-b', 'main', bare]);
  return bare;
}

function writeManifest(root: string, topics: Array<{ path: string; active?: boolean }>): void {
  const body =
    'version: 1\ntopics:\n' +
    topics.map((t) => `  - { path: ${t.path}, active: ${t.active ?? true} }\n`).join('');
  writeFileSync(join(root, 'researcher.workspace.yml'), body);
}

describe('classifyTopicGit', () => {
  it('classifies missing, local-only, remote, and submodule', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-classify-'));
    gitInit(root);
    writeFileSync(join(root, 'README'), 'x');
    gitCommitAll(root, 'init super');

    // missing
    expect(classifyTopicGit(root, 'ghost').kind).toBe('missing');

    // local-only
    const local = join(root, 'local');
    gitInit(local);
    writeFileSync(join(local, 'a'), '1');
    gitCommitAll(local, 'init local');
    expect(classifyTopicGit(root, 'local')).toEqual(
      expect.objectContaining({ kind: 'local-only', path: 'local' }),
    );

    // remote via bare
    const bare = makeBare(root, 'remote-topic');
    const remote = join(root, 'remote');
    gitInit(remote);
    writeFileSync(join(remote, 'a'), '1');
    gitCommitAll(remote, 'init remote');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: remote });
    execaSync('git', ['push', '-u', 'origin', 'main'], { cwd: remote });
    expect(classifyTopicGit(root, 'remote').kind).toBe('remote');

    // submodule
    const subBare = makeBare(root, 'sub');
    const subSrc = join(root, '_sub_src');
    gitInit(subSrc);
    writeFileSync(join(subSrc, 'a'), '1');
    gitCommitAll(subSrc, 'init sub');
    execaSync('git', ['remote', 'add', 'origin', subBare], { cwd: subSrc });
    execaSync('git', ['push', '-u', 'origin', 'main'], { cwd: subSrc });
    addSubmoduleManual(root, subBare, 'sub', subSrc);
    gitCommitAll(root, 'add submodule');
    expect(classifyTopicGit(root, 'sub').kind).toBe('submodule');
  });
});

describe('runWorkspaceSync', () => {
  it('rejects non-workspace roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-nows-'));
    await expect(runWorkspaceSync({ cwd: root, pull: true })).rejects.toThrow(/workspace/i);
  });

  it('defaults to pull-only when no action flags set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-default-'));
    gitInit(root);
    writeManifest(root, [{ path: 't1' }]);
    const t1 = join(root, 't1');
    gitInit(t1);
    writeFileSync(join(t1, 'a'), '1');
    gitCommitAll(t1, 'init');
    gitCommitAll(root, 'super init');

    const res = await runWorkspaceSync({ cwd: root });
    expect(res.actions.pull).toBe(true);
    expect(res.actions.pushTopics).toBe(false);
    expect(res.actions.pointers).toBe(false);
    expect(res.topics).toHaveLength(1);
    expect(res.topics[0].pull?.status).toBe('skipped');
  });

  it('pulls ff-only for remote topics and skips local-only; isolates failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-pull-'));
    gitInit(root);
    writeManifest(root, [
      { path: 'remote' },
      { path: 'local' },
      { path: 'ghost' },
      { path: 'dormant', active: false },
    ]);

    const bare = makeBare(root, 'remote');
    // seed bare via clone-like push
    const seed = join(root, '_seed');
    gitInit(seed);
    writeFileSync(join(seed, 'a'), 'v1');
    gitCommitAll(seed, 'v1');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: seed });
    execaSync('git', ['push', '-u', 'origin', 'main'], { cwd: seed });

    // remote topic at v1
    execaSync('git', ['clone', bare, join(root, 'remote')]);
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: join(root, 'remote') });
    execaSync('git', ['config', 'user.name', 't'], { cwd: join(root, 'remote') });

    // advance bare to v2
    writeFileSync(join(seed, 'a'), 'v2');
    gitCommitAll(seed, 'v2');
    execaSync('git', ['push', 'origin', 'main'], { cwd: seed });

    // local-only
    gitInit(join(root, 'local'));
    writeFileSync(join(root, 'local', 'a'), '1');
    gitCommitAll(join(root, 'local'), 'init');

    gitCommitAll(root, 'super');

    const res = await runWorkspaceSync({ cwd: root, pull: true });
    expect(res.topics.map((t) => t.path)).toEqual(['remote', 'local', 'ghost']);
    expect(res.topics.find((t) => t.path === 'remote')!.pull?.status).toBe('ok');
    expect(readFileSync(join(root, 'remote', 'a'), 'utf8')).toBe('v2');
    expect(res.topics.find((t) => t.path === 'local')!.pull?.status).toBe('skipped');
    expect(res.topics.find((t) => t.path === 'ghost')!.pull?.status).toBe('failed');
    expect(res.failed).toBe(1);
    expect(res.dormant).toEqual(['dormant']);
  });

  it('push-topics pushes current branch without needing delivery.mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-push-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    const bare = makeBare(root, 't');

    const t = join(root, 't');
    gitInit(t);
    writeFileSync(join(t, 'a'), 'v1');
    gitCommitAll(t, 'v1');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: t });
    execaSync('git', ['push', '-u', 'origin', 'main'], { cwd: t });

    writeFileSync(join(t, 'a'), 'v2');
    gitCommitAll(t, 'v2');
    gitCommitAll(root, 'super');

    const res = await runWorkspaceSync({ cwd: root, pushTopics: true, pull: false });
    expect(res.topics[0].push?.status).toBe('ok');

    const tip = execaSync('git', ['rev-parse', 'main'], { cwd: bare }).stdout.trim();
    const local = execaSync('git', ['rev-parse', 'HEAD'], { cwd: t }).stdout.trim();
    expect(tip).toBe(local);
  });

  it('pointers commits submodule gitlink; dry-run does not', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-ptr-'));
    gitInit(root);
    writeManifest(root, [{ path: 'sub' }]);
    gitCommitAll(root, 'manifest');

    const bare = makeBare(root, 'sub');
    const src = join(root, '_src');
    gitInit(src);
    writeFileSync(join(src, 'a'), 'v1');
    gitCommitAll(src, 'v1');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: src });
    execaSync('git', ['push', '-u', 'origin', 'main'], { cwd: src });
    addSubmoduleManual(root, bare, 'sub', src);
    gitCommitAll(root, 'add sub');

    // advance submodule
    writeFileSync(join(root, 'sub', 'a'), 'v2');
    execaSync('git', ['config', 'user.email', 't@t'], { cwd: join(root, 'sub') });
    execaSync('git', ['config', 'user.name', 't'], { cwd: join(root, 'sub') });
    gitCommitAll(join(root, 'sub'), 'v2');

    const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    const dry = await runWorkspaceSync({
      cwd: root,
      pull: false,
      pointers: true,
      dryRun: true,
    });
    expect(dry.pointers?.status).toBe('dry-run');
    expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).toBe(before);

    const res = await runWorkspaceSync({ cwd: root, pull: false, pointers: true });
    expect(res.pointers?.status).toBe('committed');
    expect(res.pointers?.count).toBe(1);
    const after = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    expect(after).not.toBe(before);
    const msg = execaSync('git', ['log', '-1', '--pretty=%s'], { cwd: root }).stdout.trim();
    expect(msg).toMatch(/workspace sync: bump submodule pointers/i);
  });

  it('includes dormant topics when all=true', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-all-'));
    gitInit(root);
    writeManifest(root, [
      { path: 'a', active: true },
      { path: 'b', active: false },
    ]);
    for (const p of ['a', 'b']) {
      gitInit(join(root, p));
      writeFileSync(join(root, p, 'x'), '1');
      gitCommitAll(join(root, p), 'init');
    }
    gitCommitAll(root, 'super');

    const res = await runWorkspaceSync({ cwd: root, pull: true, all: true });
    expect(res.topics.map((t) => t.path)).toEqual(['a', 'b']);
    expect(res.dormant).toEqual([]);
  });
});

describe('publishWorkspaceTopic', () => {
  it('adds origin, pushes, and registers submodule', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-pub-'));
    gitInit(root);
    writeManifest(root, [{ path: 'world-model' }]);
    gitCommitAll(root, 'manifest');

    const topic = join(root, 'world-model');
    gitInit(topic);
    writeFileSync(join(topic, 'a'), '1');
    gitCommitAll(topic, 'init topic');

    // ensure super sees the directory as untracked content before publish
    const bare = makeBare(root, 'world-model');
    const res = await publishWorkspaceTopic({
      cwd: root,
      path: 'world-model',
      remote: bare,
    });
    expect(res.path).toBe('world-model');
    expect(res.origin).toBe(bare);

    const origin = execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic }).stdout.trim();
    expect(origin).toBe(bare);

    const gm = readFileSync(join(root, '.gitmodules'), 'utf8');
    expect(gm).toContain('path = world-model');
    expect(gm).toContain(bare);

    const mode = execaSync('git', ['ls-files', '-s', 'world-model'], { cwd: root }).stdout.trim();
    expect(mode.startsWith('160000')).toBe(true);

    const tipBare = execaSync('git', ['rev-parse', 'main'], { cwd: bare }).stdout.trim();
    const tipTopic = execaSync('git', ['rev-parse', 'HEAD'], { cwd: topic }).stdout.trim();
    expect(tipBare).toBe(tipTopic);
  });

  it('rejects missing manifest path and existing origin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-pub-err-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitCommitAll(root, 'm');

    await expect(
      publishWorkspaceTopic({ cwd: root, path: 'nope', remote: '/tmp/x.git' }),
    ).rejects.toThrow(/manifest/i);

    const t = join(root, 't');
    gitInit(t);
    writeFileSync(join(t, 'a'), '1');
    gitCommitAll(t, 'init');
    const bare = makeBare(root, 't');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: t });

    await expect(
      publishWorkspaceTopic({ cwd: root, path: 't', remote: bare }),
    ).rejects.toThrow(/origin/i);
  });

  it('dry-run does not write remotes or gitmodules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-pub-dry-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitCommitAll(root, 'm');
    const t = join(root, 't');
    gitInit(t);
    writeFileSync(join(t, 'a'), '1');
    gitCommitAll(t, 'init');
    const bare = makeBare(root, 't');

    await publishWorkspaceTopic({ cwd: root, path: 't', remote: bare, dryRun: true });
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: t })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });
});
