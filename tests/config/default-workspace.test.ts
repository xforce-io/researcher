import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig } from '../../src/config/global-config.js';
import { DefaultWorkspaceError, resolveDefaultWorkspace } from '../../src/config/default-workspace.js';

function makeSuperRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'r-ws-'));
  writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
  return root;
}

describe('loadGlobalConfig workspace field', () => {
  it('reads an optional workspace path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-ws-'));
    const p = join(dir, 'config.yaml');
    writeFileSync(p, 'workspace: /abs/research-harness\nruntime: grok-cli\n');
    expect(loadGlobalConfig(p).workspace).toBe('/abs/research-harness');
  });

  it('omits workspace when the file has none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-glob-ws-'));
    expect(loadGlobalConfig(join(dir, 'missing.yaml')).workspace).toBeUndefined();
  });
});

describe('resolveDefaultWorkspace', () => {
  it('prefers --workspace over env over config', () => {
    const flag = makeSuperRepo();
    const envRoot = makeSuperRepo();
    const cfgRoot = makeSuperRepo();
    const home = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeFileSync(join(home, 'config.yaml'), `workspace: ${cfgRoot}\n`);
    const resolved = resolveDefaultWorkspace({
      flag,
      env: { RESEARCHER_WORKSPACE_ROOT: envRoot },
      home,
    });
    expect(resolved).toBe(flag);
  });

  it('uses RESEARCHER_WORKSPACE_ROOT when no flag', () => {
    const envRoot = makeSuperRepo();
    const resolved = resolveDefaultWorkspace({
      env: { RESEARCHER_WORKSPACE_ROOT: envRoot },
      home: mkdtempSync(join(tmpdir(), 'r-home-')),
    });
    expect(resolved).toBe(envRoot);
  });

  it('uses config.yaml workspace when no flag or env', () => {
    const cfgRoot = makeSuperRepo();
    const home = mkdtempSync(join(tmpdir(), 'r-home-'));
    writeFileSync(join(home, 'config.yaml'), `workspace: ${cfgRoot}\n`);
    expect(resolveDefaultWorkspace({ home })).toBe(cfgRoot);
  });

  it('rejects a relative workspace path', () => {
    expect(() => resolveDefaultWorkspace({ flag: 'relative/ws' })).toThrow(DefaultWorkspaceError);
    expect(() => resolveDefaultWorkspace({ flag: 'relative/ws' })).toThrow(/absolute/i);
  });

  it('rejects a path without researcher.workspace.yml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r-not-ws-'));
    expect(() => resolveDefaultWorkspace({ flag: dir })).toThrow(/researcher\.workspace\.yml/);
  });

  it('fails closed when nothing is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'r-home-'));
    mkdirSync(home, { recursive: true });
    try {
      resolveDefaultWorkspace({ home, env: {} });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DefaultWorkspaceError);
      expect((err as Error).message).toMatch(/default workspace/i);
      expect((err as Error).message).toMatch(/config\.yaml/);
    }
  });
});
