import { it, expect, beforeAll, afterAll, describe } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { TaskRegistry } from '../../src/web/tasks.js';
import { PaperLibrary } from '../../src/library/store.js';
import type { LibraryReadTopicContext } from '../../src/web/library-read.js';

let root: string;
let server: { port: number; close: () => Promise<void> };
let base: string;
let releaseLibraryRead: (() => void) | undefined;
let libraryReadCalls = 0;
const libraryReadTopicContexts: (LibraryReadTopicContext | undefined)[] = [];

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
  writeFileSync(join(trace, '.researcher/thesis.md'), [
    '# Thesis',
    '',
    '## Working thesis',
    '',
    'Trace triage should prefer lightweight signals over LLM judges.',
    'Falsifier: LLM-judge-first pipelines beat signal triage on cost-normalized quality.',
    '',
    '## Taste',
    '',
    '- Prefer mechanisms.',
    '',
    '## Anti-patterns',
    '',
    '- Benchmark-only papers.',
    '',
    '## Examples',
    '',
    '(empty)',
    '',
  ].join('\n'));

  // nested topic "feeds/ai-safety"
  const feedsAi = join(root, 'feeds/ai-safety');
  mkdirSync(join(feedsAi, '.researcher'), { recursive: true });
  writeFileSync(join(feedsAi, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: ai safety feeds\n  language: en\n' +
    'research_questions:\n  - { id: RQ1, text: safe }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\n' +
    'sources:\n  - { kind: arxiv, queries: [safety] }\ncadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(feedsAi, '.researcher/thesis.md'), [
    '# AI Safety Thesis',
    '',
    '## Working thesis',
    '',
    'Safety feeds should surface mechanism-level failures first.',
    'Falsifier: generic news digests beat mechanism feeds on decision usefulness.',
    '',
    '## Taste',
    '',
    '- Prefer primary sources.',
    '',
    '## Anti-patterns',
    '',
    '- Hype roundups without methods.',
    '',
    '## Examples',
    '',
    '(empty)',
    '',
  ].join('\n'));

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
    libraryReadRunner: async ({ onLine, topicContext }) => {
      libraryReadCalls++;
      libraryReadTopicContexts.push(topicContext);
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
    setupRuntime: {
      id: 'mock-setup',
      async invoke() {
        const yaml = [
          'meta:',
          '  topic_oneline: "Web-created probe pillar"',
          '  language: zh',
          'research_questions:',
          '  - { id: RQ1, text: "How does setup work?" }',
          'inclusion_criteria: []',
          'exclusion_criteria: []',
          'sources:',
          '  - { kind: arxiv, queries: [setup] }',
          'cadence:',
          '  default_interval_days: 7',
          '  backoff_after_empty_runs: 3',
        ].join('\n');
        const thesis = [
          '# Thesis',
          '',
          '## Working thesis',
          '',
          'Setup works when AI drafts are applied with required thesis sections.',
          'Falsifier: incomplete drafts still unlock Run.',
          '',
          '## Taste',
          '',
          '- Prefer concrete RQs.',
          '',
          '## Anti-patterns',
          '',
          '- Hollow template thesis.',
          '',
          '## Examples',
          '',
          '(empty)',
          '',
        ].join('\n');
        return {
          exitCode: 0,
          modifiedFiles: [],
          output: [
            '<<<PROJECT_YAML>>>',
            yaml,
            '<<<END_PROJECT_YAML>>>',
            '',
            '<<<THESIS_MD>>>',
            thesis,
            '<<<END_THESIS_MD>>>',
          ].join('\n'),
        };
      },
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server.close(); });

it('serves workspace home at /', async () => {
  const res = await fetch(base + '/');
  expect(res.status).toBe(200);
  const html = await res.text();
  // Home is a decision surface: workspace name hero + entry points (not the old "Workspace Home" label).
  expect(html).toContain('workspace-home');
  expect(html).toContain('Needs attention');
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
  expect(html).toContain('New topic');
  expect(html).toContain('action="/topics"');
});

it('creates a local topic through POST /topics', async () => {
  const form = new URLSearchParams({
    path: 'probe-web',
    oneline: 'Web-created probe pillar',
  });
  const res = await fetch(base + '/topics', { method: 'POST', body: form, redirect: 'manual' });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/t/probe-web?setup=1');

  const detail = await fetch(base + '/t/probe-web');
  expect(detail.status).toBe(200);
  const html = await detail.text();
  expect(html).toContain('Web-created probe pillar');
  expect(html).toContain('Needs setup');
  expect(html).toContain('Complete setup');
  expect(html).toContain('/setup/generate');
  expect(html).toMatch(/id="run-btn"[^>]*disabled/);

  const withSetup = await fetch(base + '/t/probe-web?setup=1');
  expect(await withSetup.text()).toContain('data-auto-open-setup');

  const list = await fetch(base + '/topics');
  expect(await list.text()).toContain('/t/probe-web');

  const dupe = await fetch(base + '/topics', { method: 'POST', body: form, redirect: 'manual' });
  expect(dupe.status).toBe(400);
  expect(await dupe.text()).toMatch(/already exists/);
});

it('AI complete-setup generate + apply on a scaffolded topic', async () => {
  // Ensure onboarding methodology is available for generateTopicSetup.
  const { resolvePackageRoot } = await import('../../src/paths.js');
  const methHome = mkdtempSync(join(tmpdir(), 'r-srv-meth-'));
  mkdirSync(join(methHome, 'methodology'), { recursive: true });
  writeFileSync(
    join(methHome, 'methodology/onboarding.md'),
    readFileSync(join(resolvePackageRoot(), 'methodology/onboarding.md')),
  );
  const prevHome = process.env.RESEARCHER_HOME;
  process.env.RESEARCHER_HOME = methHome;
  try {
    // probe-web created by previous test; if order changes, create again.
    const ensure = new URLSearchParams({ path: 'probe-setup', oneline: 'Setup target pillar' });
    await fetch(base + '/topics', { method: 'POST', body: ensure, redirect: 'manual' });

    const gen = await fetch(base + '/t/probe-setup/setup/generate', {
      method: 'POST',
      body: new URLSearchParams({ oneline: 'Setup target pillar', seeds: 'setup agent' }),
    });
    expect(gen.status).toBe(200);
    const draft = await gen.json() as { projectYaml: string; thesisMd: string; thesisHtml?: string };
    expect(draft.projectYaml).toContain('topic_oneline');
    expect(draft.thesisMd).toContain('Working thesis');
    expect(draft.thesisHtml).toMatch(/<h[12][^>]*>.*Working thesis/i);

    const apply = await fetch(base + '/t/probe-setup/setup/apply', {
      method: 'POST',
      body: new URLSearchParams({
        oneline: 'Setup target pillar',
        projectYaml: draft.projectYaml,
        thesisMd: draft.thesisMd,
      }),
      redirect: 'manual',
    });
    expect(apply.status).toBe(303);
    const page = await fetch(base + '/t/probe-setup');
    const html = await page.text();
    // Button/modal gone when soul ready (JS may still mention the selector string).
    expect(html).not.toContain('id="topic-setup-modal"');
    expect(html).not.toContain('Needs setup');
    expect(html).not.toMatch(/id="run-btn"[^>]*disabled/);

    const again = await fetch(base + '/t/probe-setup/setup/generate', {
      method: 'POST',
      body: new URLSearchParams({ oneline: 'Setup target pillar' }),
    });
    expect(again.status).toBe(409);
  } finally {
    if (prevHome === undefined) delete process.env.RESEARCHER_HOME;
    else process.env.RESEARCHER_HOME = prevHome;
  }
});

it('rejects invalid topic create payloads', async () => {
  const missing = await fetch(base + '/topics', {
    method: 'POST',
    body: new URLSearchParams({ path: 'x', oneline: '' }),
    redirect: 'manual',
  });
  expect(missing.status).toBe(400);

  const badPath = await fetch(base + '/topics', {
    method: 'POST',
    body: new URLSearchParams({ path: '../escape', oneline: 'nope' }),
    redirect: 'manual',
  });
  expect(badPath.status).toBe(400);
  const badHtml = await badPath.text();
  expect(badHtml).toMatch(/folder name|topic path|\.\./i);
  expect(badHtml).toContain('add-topic-modal');
  expect(badHtml).toContain('form-error');
  // Must not dump a bare text/plain error page.
  expect(badHtml).toContain('<!doctype html>');
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
    expect.objectContaining({ surfaceId: 'trace' }),
  ]);

  const page = await fetch(base + '/library');
  const html = await page.text();
  expect(html).toContain('paper_arxiv_2401_12345');
  expect(html).toContain('benchmark');

  const selected = await fetch(base + '/library?paper=paper_arxiv_2401_12345');
  expect(selected.status).toBe(200);
  expect(selected.url).toBe(base + '/library/p/paper_arxiv_2401_12345');
  const selectedHtml = await selected.text();
  expect(selectedHtml).toContain('paper-detail-main');
  expect(selectedHtml).toContain('paper-identity-fm');
  expect(selectedHtml).toContain('Deep read');
  expect(selectedHtml).toContain('class="linked-topic-row"');
  expect(selectedHtml).toMatch(/<b>trace<\/b>/);
  expect(selectedHtml).toContain('Link another topic');
});

it('deletes an unlinked library paper and refuses a linked one', async () => {
  const add = new URLSearchParams({ input: 'https://example.com/ephemeral-doc' });
  const added = await fetch(base + '/library/add', { method: 'POST', body: add, redirect: 'manual' });
  expect(added.status).toBe(303);
  const lib = new PaperLibrary(root);
  const paper = lib.listPapers().find((p) => p.canonicalSource.id.includes('ephemeral-doc'));
  expect(paper).toBeTruthy();

  const del = await fetch(base + '/library/delete', {
    method: 'POST',
    body: new URLSearchParams({ paperId: paper!.id }),
    redirect: 'manual',
  });
  expect(del.status).toBe(303);
  expect(del.headers.get('location')).toBe('/library');
  expect(new PaperLibrary(root).getPaper(paper!.id)).toBeUndefined();

  // paper_arxiv_2401_12345 is linked to trace from earlier test
  const refuse = await fetch(base + '/library/delete', {
    method: 'POST',
    body: new URLSearchParams({ paperId: 'paper_arxiv_2401_12345' }),
    redirect: 'manual',
  });
  expect(refuse.status).toBe(400);
  expect(await refuse.text()).toMatch(/linked/i);
  expect(new PaperLibrary(root).getPaper('paper_arxiv_2401_12345')).toBeTruthy();
});

it('creates, pins, and deletes paper-local notes on the detail page', async () => {
  const paperId = 'paper_arxiv_2401_12345';
  const create = await fetch(base + '/library/note', {
    method: 'POST',
    body: new URLSearchParams({
      action: 'create',
      paperId,
      body: 'LM judge selects among candidates',
      kind: 'clarification',
      pinned: '1',
    }),
    redirect: 'manual',
  });
  expect(create.status).toBe(303);
  expect(create.headers.get('location')).toBe(`/library/p/${paperId}#notes`);

  let lib = new PaperLibrary(root);
  let notes = lib.listNotes(paperId);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toEqual(expect.objectContaining({
    body: 'LM judge selects among candidates',
    kind: 'clarification',
    pinned: true,
  }));
  const noteId = notes[0].id;

  const detail = await fetch(base + `/library/p/${paperId}`);
  const html = await detail.text();
  expect(html).toContain('LM judge selects among candidates');
  expect(html).toContain('paper-notes-panel');

  const unpin = await fetch(base + '/library/note', {
    method: 'POST',
    body: new URLSearchParams({ action: 'unpin', paperId, noteId }),
    redirect: 'manual',
  });
  expect(unpin.status).toBe(303);
  lib = new PaperLibrary(root);
  expect(lib.getNote(noteId)?.pinned).toBe(false);

  const del = await fetch(base + '/library/note', {
    method: 'POST',
    body: new URLSearchParams({ action: 'delete', paperId, noteId }),
    redirect: 'manual',
  });
  expect(del.status).toBe(303);
  expect(new PaperLibrary(root).listNotes(paperId)).toEqual([]);
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
  expect(libraryReadCalls).toBe(1);
  expect(libraryReadTopicContexts.at(-1)).toBeUndefined();

  const completedDetail = await fetch(base + '/library/p/paper_arxiv_2401_12345');
  const completedHtml = await completedDetail.text();
  expect(completedHtml).toContain('paper-doc');
  expect(completedHtml).toContain('paper-identity-fm');
  expect(completedHtml).toContain('Mock read');
});

it('does not rerun an existing read unless force is explicit', async () => {
  const before = libraryReadCalls;
  const form = new URLSearchParams({ paperId: 'paper_arxiv_2401_12345', topic: 'trace' });
  const res = await fetch(base + '/library/read', { method: 'POST', body: form, redirect: 'manual' });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/library/p/paper_arxiv_2401_12345');
  expect(libraryReadCalls).toBe(before);
});

it('force reruns a Library read without forwarding topic context', async () => {
  releaseLibraryRead = undefined;
  const before = libraryReadCalls;
  const form = new URLSearchParams({ paperId: 'paper_arxiv_2401_12345', topic: 'feeds/ai-safety', force: '1' });
  const res = await fetch(base + '/library/read', { method: 'POST', body: form, redirect: 'manual' });
  expect(res.status).toBe(303);
  await waitFor(() => libraryReadCalls === before + 1);
  expect(libraryReadTopicContexts.at(-1)).toBeUndefined();
  releaseLibraryRead?.();
  await waitFor(() => new PaperLibrary(root).listReads('paper_arxiv_2401_12345').some((r) => r.status === 'read'));
});

it('upserts topic links separately from Library reads', async () => {
  const form = new URLSearchParams({
    paperId: 'paper_arxiv_2401_12345',
    topic: 'feeds/ai-safety',
    rationale: 'matches the feed topic',
  });
  const res = await fetch(base + '/library/link', { method: 'POST', body: form, redirect: 'manual' });
  expect(res.status).toBe(303);
  const lib = new PaperLibrary(root);
  expect(lib.listLinks('paper_arxiv_2401_12345')).toEqual(expect.arrayContaining([
    expect.objectContaining({ surfaceId: 'trace' }),
    expect.objectContaining({ surfaceId: 'feeds/ai-safety', rationale: 'matches the feed topic' }),
  ]));

  const unlink = new URLSearchParams({
    paperId: 'paper_arxiv_2401_12345',
    topic: 'feeds/ai-safety',
  });
  const second = await fetch(base + '/library/unlink', { method: 'POST', body: unlink, redirect: 'manual' });
  expect(second.status).toBe(303);
  expect(lib.listLinks('paper_arxiv_2401_12345').some((l) => l.surfaceId === 'feeds/ai-safety')).toBe(false);
});

it('manages a second topic link without rewriting the first (#153)', async () => {
  const paperId = 'paper_arxiv_2401_12345';
  const lib = new PaperLibrary(root);
  const before = lib.listLinks(paperId).find((l) => l.surfaceId === 'trace');
  expect(before).toBeDefined();

  const add = await fetch(base + '/library/link', {
    method: 'POST',
    body: new URLSearchParams({
      paperId,
      topic: 'feeds/ai-safety',
      rationale: 'feed-side failure modes',
    }),
    redirect: 'manual',
  });
  expect(add.status).toBe(303);

  const html = await (await fetch(base + `/library/p/${paperId}`)).text();
  expect(html).toContain('trace');
  expect(html).toContain('feeds/ai-safety');
  expect(html).toContain('feed-side failure modes');
  expect(html).toContain('Link another topic');
  expect(html).toContain(`?edit=trace`);
  const addSelect = html.match(/<select name="topic"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? '';
  expect(addSelect).not.toContain('value="trace"');
  expect(addSelect).not.toContain('value="feeds/ai-safety"');
  const map = html.match(/<section class="detail-panel"><h2>Mini map<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(map).toContain('trace');
  expect(map).toContain('feeds/ai-safety');

  const editPage = await (await fetch(base + `/library/p/${paperId}?edit=trace`)).text();
  expect(editPage).toMatch(/class="primary topic-link-submit"[^>]*>Update</);

  const update = await fetch(base + '/library/link', {
    method: 'POST',
    body: new URLSearchParams({ paperId, topic: 'trace', rationale: 'updated why for trace' }),
    redirect: 'manual',
  });
  expect(update.status).toBe(303);
  const afterUpdate = new PaperLibrary(root).listLinks(paperId);
  expect(afterUpdate).toHaveLength(2);
  expect(afterUpdate.find((l) => l.surfaceId === 'trace')?.rationale).toBe('updated why for trace');
  expect(afterUpdate.find((l) => l.surfaceId === 'feeds/ai-safety')?.rationale).toBe('feed-side failure modes');

  const unlink = await fetch(base + '/library/unlink', {
    method: 'POST',
    body: new URLSearchParams({ paperId, topic: 'feeds/ai-safety' }),
    redirect: 'manual',
  });
  expect(unlink.status).toBe(303);
  const leftover = new PaperLibrary(root).listLinks(paperId);
  expect(leftover).toEqual([expect.objectContaining({ surfaceId: 'trace', rationale: 'updated why for trace' })]);
  expect(new PaperLibrary(root).getPaper(paperId)).toBeDefined();
});

it('serves canonical paper detail URLs', async () => {
  const res = await fetch(base + '/library/p/paper_arxiv_2401_12345', { redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('paper-doc-head');
  expect(html).toContain('Re-run read');
  expect(html).toContain('Link another topic');
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

it('unknown run task stream ends immediately (no false RUNNING hang)', async () => {
  const sse = await fetch(base + '/t/trace/run/missing-task-id/stream');
  expect(sse.status).toBe(200);
  const text = await sse.text();
  expect(text).toContain('event: end');
  expect(text).toContain('"endReason":"unknown"');
  expect(text).toContain('"status":"error"');
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

it('POST /run rejects soul-not-ready topic with setup_required', async () => {
  const form = new URLSearchParams({
    path: 'probe-not-ready',
    oneline: 'Not ready pillar',
  });
  await fetch(base + '/topics', { method: 'POST', body: form, redirect: 'manual' });
  const res = await fetch(base + '/t/probe-not-ready/run', { method: 'POST' });
  expect(res.status).toBe(409);
  const body = await res.json() as { error: string; reasons?: string[] };
  expect(body.error).toBe('setup_required');
  expect(Array.isArray(body.reasons)).toBe(true);
  expect(body.reasons!.length).toBeGreaterThan(0);
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

describe('library deep-read failure + orphan reclaim (#78)', () => {
  it('marks a failed deep read with lastError', async () => {
    const failRoot = mkdtempSync(join(tmpdir(), 'rsw-srv-fail-'));
    writeFileSync(join(failRoot, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(failRoot, 't/.researcher'), { recursive: true });
    writeFileSync(join(failRoot, 't/.researcher/project.yaml'),
      'meta: { language: zh }\nresearch_questions: [{ id: RQ1, text: x }]\ninclusion_criteria: []\nexclusion_criteria: []\n' +
      'sources: [{ kind: arxiv, queries: [a] }]\ncadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }\n');
    writeFileSync(join(failRoot, 't/.researcher/thesis.md'), '# T\n');
    const lib = new PaperLibrary(failRoot);
    lib.upsertPaper({
      id: 'paper_arxiv_2603_23971',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2603.23971', url: 'https://arxiv.org/abs/2603.23971' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2603.23971', url: 'https://arxiv.org/abs/2603.23971' }],
      identifiers: { arxiv: '2603.23971' },
      tags: [],
    });

    const registry = new TaskRegistry({ idSeq: (() => { let n = 0; return () => `fail-${++n}`; })() });
    const srv = await startServer({
      root: failRoot,
      port: 0,
      registry,
      libraryReadRunner: async ({ onLine }) => {
        onLine?.('mock fail');
        throw new Error('library read agent exited 1: Request was aborted.');
      },
    });
    const failBase = `http://127.0.0.1:${srv.port}`;
    try {
      const form = new URLSearchParams({ paperId: 'paper_arxiv_2603_23971' });
      const res = await fetch(failBase + '/library/read', { method: 'POST', body: form, redirect: 'manual' });
      expect(res.status).toBe(303);
      await waitFor(() => new PaperLibrary(failRoot).listReads('paper_arxiv_2603_23971').some((r) => r.status === 'failed'), 2000);
      const read = new PaperLibrary(failRoot).listReads('paper_arxiv_2603_23971')[0];
      expect(read).toMatchObject({
        status: 'failed',
        lastError: expect.stringMatching(/aborted|exited 1/i),
      });
    } finally {
      await srv.close();
    }
  });

  it('reclaims orphan reading records when serve starts', async () => {
    const orphanRoot = mkdtempSync(join(tmpdir(), 'rsw-srv-orphan-'));
    writeFileSync(join(orphanRoot, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(orphanRoot, 't/.researcher'), { recursive: true });
    writeFileSync(join(orphanRoot, 't/.researcher/project.yaml'),
      'meta: { language: zh }\nresearch_questions: [{ id: RQ1, text: x }]\ninclusion_criteria: []\nexclusion_criteria: []\n' +
      'sources: [{ kind: arxiv, queries: [a] }]\ncadence: { default_interval_days: 7, backoff_after_empty_runs: 3 }\n');
    writeFileSync(join(orphanRoot, 't/.researcher/thesis.md'), '# T\n');
    const lib = new PaperLibrary(orphanRoot);
    lib.upsertPaper({
      id: 'paper_arxiv_2603_23971',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2603.23971', url: 'https://arxiv.org/abs/2603.23971' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2603.23971', url: 'https://arxiv.org/abs/2603.23971' }],
      identifiers: { arxiv: '2603.23971' },
      tags: [],
    });
    lib.upsertRead({ id: 'read_paper_arxiv_2603_23971', paperId: 'paper_arxiv_2603_23971', status: 'reading' });

    const srv = await startServer({
      root: orphanRoot,
      port: 0,
      registry: new TaskRegistry(),
      libraryReadRunner: async () => ({ artifactPath: 'x.md' }),
    });
    try {
      const after = new PaperLibrary(orphanRoot).listReads('paper_arxiv_2603_23971')[0];
      expect(after.status).toBe('failed');
      expect(after.lastError).toMatch(/restart|orphan|interrupted/i);

      const page = await fetch(`http://127.0.0.1:${srv.port}/library/p/paper_arxiv_2603_23971`);
      const html = await page.text();
      expect(html).toContain('failed');
      expect(html).not.toContain('Read interrupted');
    } finally {
      await srv.close();
    }
  });
});
