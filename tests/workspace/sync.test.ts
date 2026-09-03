import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execaSync } from 'execa';
import { runWorkspaceSync } from '../../src/workspace/sync.js';
import { runWorkspacePublishCli } from '../../src/commands/workspace.js';
import {
  executeWorkspacePublish,
  prepareWorkspacePublish,
} from '../../src/workspace/publish.js';
import { sanitizeErrorText, sanitizeRemoteForDisplay } from '../../src/workspace/remote-display.js';
import { formatSyncSummary, type WorkspaceSyncResult } from '../../src/workspace/sync.js';
import { classifyTopicGit } from '../../src/workspace/topic-git.js';
import { loadWorkspaceManifest } from '../../src/workspace/manifest.js';

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

function writeManifest(
  root: string,
  topics: Array<{ path: string; active?: boolean; publish?: boolean }>,
): void {
  const body =
    'version: 1\ntopics:\n' +
    topics
      .map(
        (t) =>
          `  - { path: ${t.path}, active: ${t.active ?? true}${
            t.publish === undefined ? '' : `, publish: ${t.publish}`
          } }\n`,
      )
      .join('');
  writeFileSync(join(root, 'researcher.workspace.yml'), body);
}

function makeLocalPublishFixture({
  path = 'topic',
  publish,
}: {
  path?: string;
  publish: boolean;
}): { root: string; topic: string } {
  const fixture = mkdtempSync(join(tmpdir(), 'r-publish-policy-'));
  const root = join(fixture, 'workspace');
  gitInit(root);
  writeManifest(root, [{ path, publish }]);
  gitCommitAll(root, 'manifest');

  const topic = resolve(root, path);
  gitInit(topic);
  writeFileSync(join(topic, 'a'), '1');
  gitCommitAll(topic, 'init topic');

  return { root, topic };
}

it('defaults per-topic publish permission to false', () => {
  const root = mkdtempSync(join(tmpdir(), 'r-publish-policy-'));
  writeManifest(root, [{ path: 'topic' }]);
  expect(loadWorkspaceManifest(join(root, 'researcher.workspace.yml')).topics[0]).toEqual({
    path: 'topic',
    active: true,
    publish: false,
  });
});

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
  it('does not classify a plain super-repo directory as a topic repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'r-classify-plain-'));
    gitInit(root);
    mkdirSync(join(root, 'plain'));
    writeFileSync(join(root, 'plain', 'file'), 'x');
    gitCommitAll(root, 'super with plain directory');
    expect(classifyTopicGit(root, 'plain')).toEqual(
      expect.objectContaining({ kind: 'not-git', reason: 'not an independent git repository' }),
    );
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
    expect(res.actions.library).toBe(false);
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

  it('pointers refuses to commit when index has staged content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-ptr-staged-'));
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

    writeFileSync(join(root, 'unrelated.txt'), 'staged');
    execaSync('git', ['add', 'unrelated.txt'], { cwd: root });

    const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    const res = await runWorkspaceSync({ cwd: root, pull: false, pointers: true });
    expect(res.pointers).toEqual(
      expect.objectContaining({ status: 'failed', message: expect.stringContaining('unrelated.txt') }),
    );
    expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).toBe(before);
    expect(execaSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.trim()).toBe(
      'unrelated.txt',
    );
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

  it('library-only does not implicit-pull', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-lib-flags-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't', 'a'), '1');
    gitCommitAll(join(root, 't'), 'init');
    gitCommitAll(root, 'super');

    const res = await runWorkspaceSync({ cwd: root, library: true });
    expect(res.actions).toEqual({
      pull: false,
      pushTopics: false,
      pointers: false,
      library: true,
    });
    expect(res.topics[0].pull).toBeUndefined();
  });
});

function seedLibrary(root: string): void {
  const lib = join(root, '.researcher-workspace/library');
  const paper = join(lib, 'papers/paper_arxiv_2401_00001');
  mkdirSync(join(paper, 'reads'), { recursive: true });
  mkdirSync(join(paper, '_extracted'), { recursive: true });
  writeFileSync(join(lib, 'papers.jsonl'), '{"id":"paper_arxiv_2401_00001"}\n');
  writeFileSync(join(lib, 'reads.jsonl'), '{"id":"r1","paperId":"paper_arxiv_2401_00001"}\n');
  writeFileSync(join(lib, 'links.jsonl'), '');
  writeFileSync(join(lib, 'integrations.jsonl'), '');
  writeFileSync(join(lib, 'notes.jsonl'), '{"id":"n1","paperId":"paper_arxiv_2401_00001","body":"note"}\n');
  writeFileSync(join(paper, 'reads/read_paper_arxiv_2401_00001.md'), '# Essence\n');
  writeFileSync(join(paper, 'paper.pdf'), '%PDF-fake\n');
  writeFileSync(join(paper, '_extracted/x.txt'), 'extracted\n');
}

function libraryTracked(root: string): string[] {
  return execaSync('git', ['ls-files', '--', '.researcher-workspace/library'], { cwd: root })
    .stdout.split('\n')
    .filter(Boolean)
    .sort();
}

describe('workspace sync --library', () => {
  it('commits allowlisted library files and excludes pdf/_extracted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-lib-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't', 'a'), '1');
    gitCommitAll(join(root, 't'), 'init');
    gitCommitAll(root, 'super');
    seedLibrary(root);

    const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    const res = await runWorkspaceSync({ cwd: root, library: true });
    expect(res.actions.library).toBe(true);
    expect(res.library?.status).toBe('committed');
    expect(res.library?.count).toBeGreaterThan(0);
    expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).not.toBe(before);
    expect(execaSync('git', ['log', '-1', '--pretty=%s'], { cwd: root }).stdout.trim()).toMatch(
      /workspace sync: commit library state/i,
    );

    const tracked = libraryTracked(root);
    expect(tracked).toEqual(
      expect.arrayContaining([
        '.researcher-workspace/library/notes.jsonl',
        '.researcher-workspace/library/papers.jsonl',
        '.researcher-workspace/library/papers/paper_arxiv_2401_00001/reads/read_paper_arxiv_2401_00001.md',
      ]),
    );
    expect(tracked.join('\n')).not.toMatch(/\.pdf|_extracted/i);

    const again = await runWorkspaceSync({ cwd: root, library: true });
    expect(again.library?.status).toBe('no-op');
  });

  it('commits deletions of previously tracked allowlisted files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-lib-del-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't', 'a'), '1');
    gitCommitAll(join(root, 't'), 'init');
    gitCommitAll(root, 'super');
    seedLibrary(root);
    const first = await runWorkspaceSync({ cwd: root, library: true });
    expect(first.library?.status).toBe('committed');

    const md =
      '.researcher-workspace/library/papers/paper_arxiv_2401_00001/reads/read_paper_arxiv_2401_00001.md';
    rmSync(join(root, md));
    writeFileSync(join(root, '.researcher-workspace/library/notes.jsonl'), '');

    const res = await runWorkspaceSync({ cwd: root, library: true });
    expect(res.library?.status).toBe('committed');
    const tracked = libraryTracked(root);
    expect(tracked).not.toContain(md);
    expect(tracked).toContain('.researcher-workspace/library/notes.jsonl');
  });

  it('dry-run and missing library dir do not write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-lib-dry-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't', 'a'), '1');
    gitCommitAll(join(root, 't'), 'init');
    gitCommitAll(root, 'super');
    seedLibrary(root);
    const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();

    const dry = await runWorkspaceSync({ cwd: root, library: true, dryRun: true });
    expect(dry.library?.status).toBe('dry-run');
    expect(dry.library?.count).toBeGreaterThan(0);
    expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).toBe(before);
    expect(libraryTracked(root)).toEqual([]);

    const empty = mkdtempSync(join(tmpdir(), 'r-sync-lib-empty-'));
    gitInit(empty);
    writeManifest(empty, [{ path: 't' }]);
    gitInit(join(empty, 't'));
    writeFileSync(join(empty, 't', 'a'), '1');
    gitCommitAll(join(empty, 't'), 'init');
    gitCommitAll(empty, 'super');
    const none = await runWorkspaceSync({ cwd: empty, library: true });
    expect(none.library?.status).toBe('no-op');
  });

  it('refuses to commit when index has staged content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-sync-lib-staged-'));
    gitInit(root);
    writeManifest(root, [{ path: 't' }]);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't', 'a'), '1');
    gitCommitAll(join(root, 't'), 'init');
    gitCommitAll(root, 'super');
    seedLibrary(root);

    writeFileSync(join(root, 'unrelated.txt'), 'staged');
    execaSync('git', ['add', 'unrelated.txt'], { cwd: root });
    const before = execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();

    const res = await runWorkspaceSync({ cwd: root, library: true });
    expect(res.library).toEqual(
      expect.objectContaining({ status: 'failed', message: expect.stringContaining('unrelated.txt') }),
    );
    expect(res.failed).toBe(1);
    expect(execaSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim()).toBe(before);
    expect(execaSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.trim()).toBe(
      'unrelated.txt',
    );
    expect(libraryTracked(root)).toEqual([]);
  });
});

describe('workspace publish policy', () => {
  it('prepares a blocked plan when publish is not enabled', () => {
    const { root } = makeLocalPublishFixture({ publish: false });
    const plan = prepareWorkspacePublish({
      cwd: root,
      path: 'topic',
      remote: 'https://secret@example.com/org/topic.git',
    });
    expect(plan).toEqual(
      expect.objectContaining({
        authorized: false,
        blockedReason: 'publish not enabled',
        displayRemote: 'https://example.com/org/topic.git',
      }),
    );
  });

  it.each([
    ['https://token@example.com/org/repo.git', 'https://example.com/org/repo.git'],
    ['https://user:token@example.com/org/repo.git', 'https://example.com/org/repo.git'],
    ['https://token@example.com', 'https://example.com'],
    ['git@example.com:org/repo.git', 'example.com:org/repo.git'],
  ])('redacts remote userinfo from %s', (input, expected) => {
    expect(sanitizeRemoteForDisplay(input)).toBe(expected);
  });

  
  it('redacts credentials from free-form error text and sync summaries', () => {
    expect(
      sanitizeErrorText('fatal: could not read from remote https://token@example.com/org/repo.git'),
    ).toBe('fatal: could not read from remote https://example.com/org/repo.git');
    expect(sanitizeErrorText('auth failed for https://user:secret@host/path')).not.toContain('secret');
    expect(sanitizeRemoteForDisplay('user@example.com/org/repo.git')).toBe('example.com/org/repo.git');

    const summary = formatSyncSummary({
      actions: { pull: true, pushTopics: false, pointers: false, library: false },
      topics: [
        {
          path: 'topic',
          kind: 'remote',
          pull: {
            status: 'failed',
            message: 'fatal: Authentication failed for \'https://token@example.com/org/topic.git/\'',
          },
        },
      ],
      dormant: [],
      failed: 1,
    } satisfies WorkspaceSyncResult);
    expect(summary).toContain('https://example.com/org/topic.git');
    expect(summary).not.toContain('token@');
  });

  it('rejects a manifest topic that resolves outside the workspace', () => {
    const { root } = makeLocalPublishFixture({ path: '../outside', publish: true });
    expect(() =>
      prepareWorkspacePublish({ cwd: root, path: '../outside', remote: '/tmp/topic.git' }),
    ).toThrow(/inside workspace/i);
  });

  it('blocks execution before writes when the blocked plan is not authorized', async () => {
    const { root, topic } = makeLocalPublishFixture({ publish: false });
    const plan = prepareWorkspacePublish({
      cwd: root,
      path: 'topic',
      remote: '/tmp/topic.git',
    });

    await expect(executeWorkspacePublish(plan)).rejects.toMatchObject({ exitCode: 2 });
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });

  it('redacts remote userinfo from an existing origin error', () => {
    const { root, topic } = makeLocalPublishFixture({ publish: true });
    execaSync(
      'git',
      ['remote', 'add', 'origin', 'https://secret@example.com/org/topic.git'],
      { cwd: topic },
    );

    expect(() =>
      prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' }),
    ).toThrow('already has origin (https://example.com/org/topic.git)');
    try {
      prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
    } catch (error) {
      expect(String(error)).not.toContain('secret@');
    }
  });

  it('rejects execution when the topic is not authorized', async () => {
    const { root } = makeLocalPublishFixture({ publish: false });
    const plan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
    await expect(executeWorkspacePublish(plan)).rejects.toMatchObject({ exitCode: 2 });
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });

  it('restores local state after push fails and can be retried', async () => {
    const { root, topic } = makeLocalPublishFixture({ publish: true });
    const remote = join(root, 'remote.git');
    const failedPlan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote });
    await expect(executeWorkspacePublish(failedPlan)).rejects.toThrow();
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);

    execaSync('git', ['init', '--bare', '-b', 'main', remote]);
    await expect(
      executeWorkspacePublish(
        prepareWorkspacePublish({
          cwd: root,
          path: 'topic',
          remote,
        }),
      ),
    ).resolves.toEqual(expect.objectContaining({ dryRun: false }));
  });

  it('refuses dirty index or dirty .gitmodules without changing either', async () => {
    const { root } = makeLocalPublishFixture({ publish: true });
    writeFileSync(join(root, 'unrelated'), 'staged');
    execaSync('git', ['add', 'unrelated'], { cwd: root });
    const plan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
    await expect(executeWorkspacePublish(plan)).rejects.toThrow(/staged changes/i);
    expect(execaSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.trim()).toBe(
      'unrelated',
    );
  });

  it('refuses dirty tracked .gitmodules without changing bytes', async () => {
    const { root } = makeLocalPublishFixture({ publish: true });
    const gmPath = join(root, '.gitmodules');
    const original = '[submodule "other"]\n\tpath = other\n\turl = /tmp/other.git\n';
    writeFileSync(gmPath, original);
    execaSync('git', ['add', '.gitmodules'], { cwd: root });
    execaSync('git', ['commit', '-m', 'track gitmodules'], { cwd: root });
    const dirty = original + '# dirty\n';
    writeFileSync(gmPath, dirty);

    const plan = prepareWorkspacePublish({ cwd: root, path: 'topic', remote: '/tmp/topic.git' });
    await expect(executeWorkspacePublish(plan)).rejects.toThrow(/\.gitmodules/i);
    expect(readFileSync(gmPath)).toEqual(Buffer.from(dirty));
    expect(execaSync('git', ['diff', '--name-only', '--', '.gitmodules'], { cwd: root }).stdout.trim()).toBe(
      '.gitmodules',
    );
  });
});

describe('workspace publish execution', () => {
  it('adds origin, pushes, and registers submodule', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-pub-'));
    gitInit(root);
    writeManifest(root, [{ path: 'world-model', publish: true }]);
    gitCommitAll(root, 'manifest');

    const topic = join(root, 'world-model');
    gitInit(topic);
    writeFileSync(join(topic, 'a'), '1');
    gitCommitAll(topic, 'init topic');

    // ensure super sees the directory as untracked content before publish
    const bare = makeBare(root, 'world-model');
    const plan = prepareWorkspacePublish({
      cwd: root,
      path: 'world-model',
      remote: bare,
    });
    const res = await executeWorkspacePublish(plan);
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
    writeManifest(root, [{ path: 't', publish: true }]);
    gitCommitAll(root, 'm');

    expect(() =>
      prepareWorkspacePublish({ cwd: root, path: 'nope', remote: '/tmp/x.git' }),
    ).toThrow(/manifest/i);

    const t = join(root, 't');
    gitInit(t);
    writeFileSync(join(t, 'a'), '1');
    gitCommitAll(t, 'init');
    const bare = makeBare(root, 't');
    execaSync('git', ['remote', 'add', 'origin', bare], { cwd: t });

    expect(() =>
      prepareWorkspacePublish({ cwd: root, path: 't', remote: bare }),
    ).toThrow(/origin/i);
  });

  it('dry-run does not write remotes or gitmodules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r-pub-dry-'));
    gitInit(root);
    writeManifest(root, [{ path: 't', publish: true }]);
    gitCommitAll(root, 'm');
    const t = join(root, 't');
    gitInit(t);
    writeFileSync(join(t, 'a'), '1');
    gitCommitAll(t, 'init');
    const bare = makeBare(root, 't');

    prepareWorkspacePublish({ cwd: root, path: 't', remote: bare, dryRun: true });
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: t })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });
});

describe('workspace publish CLI dry-run gate', () => {
  it('reports blocked dry-run without writing when publish is disabled', async () => {
    const { root, topic } = makeLocalPublishFixture({ publish: false });
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalExitCode = process.exitCode;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runWorkspacePublishCli('topic', {
        cwd: root,
        remote: 'https://token@example.com/org/topic.git',
        dryRun: true,
      });
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = originalExitCode;
    }
    const out = chunks.join('');
    expect(out).toContain('blocked: publish not enabled');
    expect(out).not.toContain('would add origin');
    expect(out).not.toContain('token@');
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });
});
