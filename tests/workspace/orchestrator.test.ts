import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkspace } from '../../src/workspace/orchestrator.js';
import type { RunOptions, RunResult } from '../../src/commands/run.js';

function setupSuper(opts: { topics: string; withCharter?: boolean; pillars: string[] }): string {
  const root = mkdtempSync(join(tmpdir(), 'r-orch-'));
  writeFileSync(join(root, 'researcher.workspace.yml'), opts.topics);
  if (opts.withCharter) {
    writeFileSync(
      join(root, 'CHARTER.md'),
      '# C\n\n## 0. NS\n\nns\n\n## 2. ex\n\n### `trace`\nt\n\n### `decision`\nd\n',
    );
  }
  for (const p of opts.pillars) mkdirSync(join(root, p, '.researcher'), { recursive: true });
  return root;
}

const okRun = async (): Promise<RunResult> => ({ outcome: 'no-candidate', runId: 'x' });

describe('runWorkspace', () => {
  it('runs only active topics in order, skipping dormant', async () => {
    const root = setupSuper({
      topics:
        'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: decision, active: false }\n  - { path: ontology, active: true }\n',
      pillars: ['trace', 'decision', 'ontology'],
    });
    const calls: string[] = [];
    const res = await runWorkspace({
      cwd: root,
      runTopic: async (o: RunOptions) => { calls.push(o.cwd); return okRun(); },
    });
    expect(calls).toEqual([join(root, 'trace'), join(root, 'ontology')]);
    expect(res.dormant).toEqual(['decision']);
    expect(res.topics.map((t) => t.status)).toEqual(['ok', 'ok']);
  });

  it('syncs the charter slice into each active topic before running', async () => {
    const root = setupSuper({
      topics: 'version: 1\ntopics:\n  - { path: trace, active: true }\n',
      withCharter: true,
      pillars: ['trace'],
    });
    let seen: string | null = null;
    const res = await runWorkspace({
      cwd: root,
      runTopic: async (o: RunOptions) => {
        const p = join(o.cwd, '.researcher', 'charter.md');
        seen = existsSync(p) ? readFileSync(p, 'utf8') : null;
        return okRun();
      },
    });
    expect(seen).not.toBeNull();
    expect(seen!).toContain('NS');            // shared core
    expect(seen!).toContain('### `trace`');   // own excerpt
    expect(seen!).not.toContain('### `decision`'); // not a neighbor's
    expect(res.topics[0].charterSynced).toBe(true);
  });

  it('continues after a topic throws (error isolation)', async () => {
    const root = setupSuper({
      topics: 'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: decision, active: true }\n',
      pillars: ['trace', 'decision'],
    });
    const calls: string[] = [];
    const res = await runWorkspace({
      cwd: root,
      runTopic: async (o: RunOptions) => {
        calls.push(o.cwd);
        if (o.cwd.endsWith('trace')) throw new Error('boom');
        return okRun();
      },
    });
    expect(calls).toHaveLength(2); // both attempted despite first failing
    expect(res.topics[0].status).toBe('error');
    expect(res.topics[0].message).toContain('boom');
    expect(res.topics[1].status).toBe('ok');
  });

  it('marks an active topic with a missing directory as error and never runs it', async () => {
    const root = setupSuper({
      topics: 'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: ghost, active: true }\n',
      pillars: ['trace'], // ghost dir intentionally absent
    });
    const calls: string[] = [];
    const res = await runWorkspace({
      cwd: root,
      runTopic: async (o: RunOptions) => { calls.push(o.cwd); return okRun(); },
    });
    expect(calls).toEqual([join(root, 'trace')]);
    expect(res.topics.find((t) => t.path === 'ghost')!.status).toBe('error');
  });
});
