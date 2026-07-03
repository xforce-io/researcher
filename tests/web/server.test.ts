import { it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { TaskRegistry } from '../../src/web/tasks.js';
import { PaperLibrary } from '../../src/library/store.js';

let root: string;
let server: { port: number; close: () => Promise<void> };
let base: string;
let releaseLibraryRead: (() => void) | undefined;

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
  server = await startServer({
    root,
    port: 0,
    registry,
    libraryReadRunner: async ({ onLine }) => {
      onLine?.('mock library read');
      await new Promise<void>((resolve) => { releaseLibraryRead = resolve; });
      const artifactPath = '.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md';
      mkdirSync(dirname(join(root, artifactPath)), { recursive: true });
      writeFileSync(join(root, artifactPath), '# Mock read\n\n## Claims\n\n- x');
      return {
        artifactPath,
        title: 'Metadata Title From Read',
      };
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server.close(); });

it('serves workspace home at /', async () => {
  const res = await fetch(base + '/');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Workspace Home');
  expect(html).toContain('/topics');
  expect(html).toContain('/library');
  expect(html).not.toContain('<main class="grid">');
});

it('serves the topic list at /topics', async () => {
  const res = await fetch(base + '/topics');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('/t/trace');
  expect(html).toContain('Topics');
});

it('serves the library page', async () => {
  const res = await fetch(base + '/library');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Library');
  expect(html).toContain('Add paper');
  expect(html).toContain('action="/library/add"');
});

it('adds a paper through the web library without duplicating arXiv ids', async () => {
  const form = new URLSearchParams({ input: 'https://arxiv.org/abs/2401.12345v2', tags: 'survey', topic: 'trace' });
  const first = await fetch(base + '/library/add', { method: 'POST', body: form, redirect: 'manual' });
  expect(first.status).toBe(303);
  expect(first.headers.get('location')).toBe('/library');

  const dupe = new URLSearchParams({ input: '2401.12345', tags: 'benchmark' });
  const second = await fetch(base + '/library/add', { method: 'POST', body: dupe, redirect: 'manual' });
  expect(second.status).toBe(303);

  const lines = readFileSync(join(root, '.researcher-workspace/library/papers.jsonl'), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('paper_arxiv_2401_12345');
  const lib = new PaperLibrary(root);
  expect(lib.listLinks('paper_arxiv_2401_12345')).toEqual([
    expect.objectContaining({ surfaceId: 'trace', relation: 'candidate' }),
  ]);

  const page = await fetch(base + '/library');
  const html = await page.text();
  expect(html).toContain('paper_arxiv_2401_12345');
  expect(html).toContain('benchmark');

  const selected = await fetch(base + '/library?paper=paper_arxiv_2401_12345');
  expect(selected.status).toBe(200);
  expect(selected.url).toBe(base + '/library/p/paper_arxiv_2401_12345');
  const selectedHtml = await selected.text();
  expect(selectedHtml).toContain('Paper detail');
  expect(selectedHtml).toContain('paper-card detail');
  expect(selectedHtml).toContain('Deep read');
  expect(selectedHtml).toContain('trace · linked');
});

it('starts a library deep read and records read state', async () => {
  releaseLibraryRead = undefined;
  const form = new URLSearchParams({ paperId: 'paper_arxiv_2401_12345' });
  const first = await fetch(base + '/library/read', { method: 'POST', body: form, redirect: 'manual' });
  expect(first.status).toBe(303);
  expect(first.headers.get('location')).toBe('/library/p/paper_arxiv_2401_12345');

  const lib = new PaperLibrary(root);
  await waitFor(() => lib.listReads('paper_arxiv_2401_12345').some((r) => r.status === 'reading'));

  const detailDuringRead = await fetch(base + '/library/p/paper_arxiv_2401_12345');
  const detailHtml = await detailDuringRead.text();
  expect(detailHtml).toContain('id="library-read-stages"');
  expect(detailHtml).toContain('data-library-task="');
  expect(detailHtml).toContain('Fetch source');

  const taskId = /data-library-task="([^"]+)"/.exec(detailHtml)?.[1];
  expect(taskId).toBeTruthy();

  const second = await fetch(base + '/library/read', { method: 'POST', body: form, redirect: 'manual' });
  expect(second.status).toBe(409);

  releaseLibraryRead?.();
  const sse = await fetch(base + `/library/read/${taskId}/stream`);
  const sseText = await sse.text();
  expect(sseText).toContain('event: plan');
  expect(sseText).toContain('fetch-source');
  expect(sseText).toContain('event: end');
  await waitFor(() => lib.listReads('paper_arxiv_2401_12345').some((r) =>
    r.status === 'read' &&
    r.artifactPath === '.researcher-workspace/library/papers/paper_arxiv_2401_12345/reads/read_paper_arxiv_2401_12345.md'
  ));
  expect(lib.getPaper('paper_arxiv_2401_12345')?.title).toBe('Metadata Title From Read');

  const completedDetail = await fetch(base + '/library/p/paper_arxiv_2401_12345');
  const completedHtml = await completedDetail.text();
  expect(completedHtml).toContain('Read artifact');
  expect(completedHtml).toContain('Mock read');
});

it('serves canonical paper detail URLs', async () => {
  const res = await fetch(base + '/library/p/paper_arxiv_2401_12345', { redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Paper detail');
  expect(html).toContain('Deep read');
});

it('redirects legacy selected-paper query URLs to canonical paper detail', async () => {
  const res = await fetch(base + '/library?paper=paper_arxiv_2401_12345', { redirect: 'manual' });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/library/p/paper_arxiv_2401_12345');
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
  expect(text).toContain('"status":"done"');
  expect(text).toContain('"exitCode":0');
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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
