import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execaSync } from 'execa';
import {
  runWorkspacePublishCli,
  type WorkspacePublishCliRuntime,
} from '../../src/commands/workspace.js';

function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execaSync('git', ['config', 'protocol.file.allow', 'always'], { cwd: dir });
}

function gitCommitAll(dir: string, message: string): string {
  execaSync('git', ['add', '-A'], { cwd: dir });
  execaSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: dir });
  return execaSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
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
  const fixture = mkdtempSync(join(tmpdir(), 'r-publish-cli-'));
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

function makeBare(root: string, name: string): string {
  const bare = join(root, `${name}.git`);
  execaSync('git', ['init', '--bare', '-b', 'main', bare]);
  return bare;
}

function fakeRuntime(o: { isTTY: boolean; confirmed?: boolean }) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  return {
    runtime: {
      isTTY: o.isTTY,
      confirm: async () => o.confirmed ?? false,
      writeOut: (text: string) => {
        stdout.push(text);
      },
      writeErr: (text: string) => {
        stderr.push(text);
      },
      setExitCode: (code: number) => {
        exitCode = code;
      },
    } satisfies WorkspacePublishCliRuntime,
    stdout,
    stderr,
    getExitCode: () => exitCode,
  };
}

describe('workspace publish CLI', () => {
  it('reports blocked dry-run without mutating an unauthorized topic', async () => {
    const { root, topic } = makeLocalPublishFixture({ publish: false });
    const io = fakeRuntime({ isTTY: false });
    await runWorkspacePublishCli(
      'topic',
      {
        cwd: root,
        remote: 'https://token@example.com/o/t.git',
        dryRun: true,
      },
      io.runtime,
    );
    expect(io.getExitCode()).toBe(0);
    expect(io.stdout.join('')).toContain('blocked: publish not enabled');
    expect(io.stdout.join('')).not.toContain('token');
    expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });

  it('rejects non-interactive publish without --yes', async () => {
    const { root } = makeLocalPublishFixture({ publish: true });
    const remote = makeBare(root, 'topic');
    const io = fakeRuntime({ isTTY: false });
    await runWorkspacePublishCli('topic', { cwd: root, remote }, io.runtime);
    expect(io.getExitCode()).toBe(2);
    expect(io.stderr.join('')).toMatch(/requires --yes/i);
    expect(() =>
      execaSync('git', ['remote', 'get-url', 'origin'], { cwd: join(root, 'topic') }),
    ).toThrow();
    expect(existsSync(join(root, '.gitmodules'))).toBe(false);
  });

  it.each([
    { confirmed: false, expectedExit: 2 },
    { confirmed: true, expectedExit: 0 },
  ])('honors the TTY confirmation result', async ({ confirmed, expectedExit }) => {
    const { root, topic } = makeLocalPublishFixture({ publish: true });
    const remote = makeBare(root, 'topic');
    const io = fakeRuntime({ isTTY: true, confirmed });
    await runWorkspacePublishCli('topic', { cwd: root, remote }, io.runtime);
    expect(io.getExitCode()).toBe(expectedExit);
    if (expectedExit === 0) {
      expect(execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic }).stdout.trim()).toBe(
        remote,
      );
      expect(existsSync(join(root, '.gitmodules'))).toBe(true);
    } else {
      expect(() => execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic })).toThrow();
      expect(existsSync(join(root, '.gitmodules'))).toBe(false);
    }
  });

  it('publishes non-interactively with --yes', async () => {
    const { root, topic } = makeLocalPublishFixture({ publish: true });
    const remote = makeBare(root, 'topic');
    const io = fakeRuntime({ isTTY: false });
    await runWorkspacePublishCli(
      'topic',
      { cwd: root, remote, yes: true },
      io.runtime,
    );
    expect(io.getExitCode()).toBe(0);
    expect(execaSync('git', ['remote', 'get-url', 'origin'], { cwd: topic }).stdout.trim()).toBe(
      remote,
    );
    expect(existsSync(join(root, '.gitmodules'))).toBe(true);
    expect(io.stdout.join('')).not.toContain('token');
    expect(io.stderr.join('')).not.toContain('token');
  });

  it('redacts credentials from plan output and errors', async () => {
    const { root } = makeLocalPublishFixture({ publish: true });
    const io = fakeRuntime({ isTTY: false });
    await runWorkspacePublishCli(
      'topic',
      {
        cwd: root,
        remote: 'https://token@example.com/o/t.git',
        dryRun: true,
      },
      io.runtime,
    );
    const out = io.stdout.join('') + io.stderr.join('');
    expect(out).not.toContain('token');
    expect(out).toContain('https://example.com/o/t.git');
  });
});
