import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { TaskRegistry } from '../../src/web/tasks.js';

let root: string;
let server: { port: number; close: () => Promise<void> };
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'rsw-srv-'));
  writeFileSync(join(root, 'researcher.workspace.yml'),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: feeds/ai-safety, active: true }\n');
  const trace = join(root, 'trace');
  mkdirSync(join(trace, '.researcher/state'), { recursive: true });
  writeFileSync(join(trace, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: t\n  language: zh\nresearch_questions:\n  - { id: RQ1, text: how }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
    'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(trace, '.researcher/thesis.md'), '# Thesis\n\nbody');

  // nested topic "feeds/ai-safety"
  const feedsAi = join(root, 'feeds/ai-safety');
  mkdirSync(join(feedsAi, '.researcher'), { recursive: true });
  writeFileSync(join(feedsAi, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: ai safety feeds\n  language: en\n' +
    'research_questions:\n  - { id: RQ1, text: safe }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\n' +
    'sources:\n  - { kind: arxiv, queries: [safety] }\ncadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(feedsAi, '.researcher/thesis.md'), '# AI Safety Thesis\n\nbody');

  // a registry with a fake runner so POST /run never spawns a real process
  const registry = new TaskRegistry({
    runner: async (_c, onLine, onEvent) => {
      onEvent({ type: 'plan', stages: ['bootstrap', 'discover'] });
      onEvent({ type: 'stage', name: 'discover' });
      onLine('hello');
      return 0;
    },
    idSeq: (() => { let n = 0; return () => `t${++n}`; })(),
  });
  server = await startServer({ root, port: 0, registry });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server.close(); });

it('serves the dashboard at /', async () => {
  const res = await fetch(base + '/');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('/t/trace');
});

it('serves a topic page', async () => {
  const res = await fetch(base + '/t/trace');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Thesis');
});

it('renders a safe doc and 404s a traversal', async () => {
  const ok = await fetch(base + '/t/trace/doc?path=' + encodeURIComponent('.researcher/thesis.md'));
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain('<h1>Thesis</h1>');
  const bad = await fetch(base + '/t/trace/doc?path=' + encodeURIComponent('../../etc/passwd'));
  expect(bad.status).toBe(404);
});

it('starts a run and streams via SSE', async () => {
  const res = await fetch(base + '/t/trace/run', { method: 'POST' });
  expect(res.status).toBe(200);
  const { taskId } = await res.json();
  const sse = await fetch(base + `/t/trace/run/${taskId}/stream`);
  const text = await sse.text();
  expect(text).toContain('hello');
  expect(text).toContain('event: line');
  expect(text).toContain('event: stage');
  expect(text).toContain('event: plan');
  expect(text).toContain('event: end');
});

it('serves css', async () => {
  const res = await fetch(base + '/static/app.css');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/css');
});

it('crafted slug on /doc returns 404 (slug guard blocks path escape)', async () => {
  // slug encodes "../../etc" — without the guard, topicDir would escape root
  const craftedSlug = encodeURIComponent('../../etc');
  const res = await fetch(base + `/t/${craftedSlug}/doc?path=passwd.md`);
  expect(res.status).toBe(404);
});

it('crafted slug on POST /run returns 404 (slug guard prevents arbitrary spawn)', async () => {
  const craftedSlug = encodeURIComponent('../../etc');
  const res = await fetch(base + `/t/${craftedSlug}/run`, { method: 'POST' });
  expect(res.status).toBe(404);
});

it('nested slug: GET /t/feeds%2Fai-safety returns 200 with topic content', async () => {
  const res = await fetch(base + '/t/feeds%2Fai-safety');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('ai safety feeds');
});

it('nested slug: GET /t/feeds%2Fai-safety/doc returns 200 for thesis', async () => {
  const res = await fetch(base + '/t/feeds%2Fai-safety/doc?path=' + encodeURIComponent('.researcher/thesis.md'));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('<h1>AI Safety Thesis</h1>');
});
