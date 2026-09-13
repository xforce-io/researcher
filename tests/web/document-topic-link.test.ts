import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execaSync } from 'execa';
import { startServer } from '../../src/web/server.js';

function gitInit(dir: string): void {
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
}

function writeTopic(root: string, path: string, oneline: string): void {
  mkdirSync(join(root, `${path}/.researcher`), { recursive: true });
  writeFileSync(join(root, `${path}/.researcher/project.yaml`),
    `meta:\n  topic_oneline: ${oneline}\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n` +
    'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
    'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(root, `${path}/.researcher/thesis.md`), `# Thesis\n\n## Working thesis\n\n${oneline}\n`);
  gitInit(join(root, path));
  writeFileSync(join(root, `${path}/a`), '1');
  execaSync('git', ['add', '-A'], { cwd: join(root, path) });
  execaSync('git', ['commit', '-m', 't'], { cwd: join(root, path) });
}

/** #197 S1–S4: note and video carry topic links like a paper does. */
describe('document topic link over HTTP (#197 S1–S4)', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  let base: string;
  const speech = Buffer.from('speech-mp4');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-doclink-'));
    writeFileSync(join(root, 'researcher.workspace.yml'),
      'version: 1\ntopics:\n  - { path: agents, active: true }\n  - { path: retrieval, active: true }\n');
    writeTopic(root, 'agents', 'trusting coding agents and agent harness design');
    writeTopic(root, 'retrieval', 'dense retrieval and reranking');
    gitInit(root);
    execaSync('git', ['add', '-A'], { cwd: root });
    execaSync('git', ['commit', '-m', 'super', '--allow-empty'], { cwd: root });
    server = await startServer({
      root,
      port: 0,
      videoAnalyzeRunner: async () => ({
        cues: [
          { id: 0, start: 0, end: 2, text: 'Trusting coding agents takes a harness', zh: '信任编码智能体需要 harness' },
          { id: 1, start: 3, end: 5, text: 'Agents can merge their own PRs' },
        ],
      }),
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  function linksFile(): string {
    const path = join(root, '.researcher-workspace/library/links.jsonl');
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  function linkRowsFor(documentId: string): string[] {
    return linksFile().split('\n').filter((l) => l.includes(documentId));
  }

  async function createNote(title: string, body: string): Promise<string> {
    const id = `doc_${randomUUID()}`;
    const res = await fetch(base + '/library/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docType: 'note', id, title, body, mutationId: `m-${id}` }),
    });
    expect(res.status).toBe(201);
    return id;
  }

  async function addAnalyzedVideo(): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([speech], { type: 'video/mp4' }), 'talk.mp4');
    form.append('mutationId', 'vid-1');
    const created = await fetch(base + '/library/documents/videos', { method: 'POST', body: form });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const started = await fetch(`${base}/library/documents/${id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an-1' }),
    });
    const { id: analysisId } = await started.json() as { id: string };
    for (let i = 0; i < 40; i += 1) {
      const st = await (await fetch(`${base}/library/documents/${id}/analyses/${analysisId}`)).json() as { status: string };
      if (st.status === 'done') return id;
      if (st.status === 'failed') throw new Error('analysis failed');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('analysis timeout');
  }

  async function linkTopic(documentId: string, topic: string, rationale?: string): Promise<Response> {
    return fetch(`${base}/library/documents/${documentId}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surfaceType: 'topic', topic, rationale }),
    });
  }

  let noteS1Id = '';

  it('links a standalone note to a topic and lists it on the topic page (S1)', async () => {
    const id = await createNote('Trust curve for coding agents', 'How I learned to trust agents that merge PRs.');
    noteS1Id = id;

    const detailBefore = await (await fetch(`${base}/library/documents/${id}`)).text();
    expect(detailBefore).toContain('topic-link-panel');
    expect(detailBefore).toContain('Link topic');

    const linked = await linkTopic(id, 'agents', 'same trust theme');
    expect(linked.status).toBe(201);

    const detail = await (await fetch(`${base}/library/documents/${id}`)).text();
    expect(detail).toContain('Linked topics');
    expect(detail).toContain('agents');
    expect(detail).toContain('Link another topic');

    const topicPage = await (await fetch(`${base}/t/agents`)).text();
    expect(topicPage).toContain('Trust curve for coding agents');

    expect(linkRowsFor(id)).toHaveLength(1);
  });

  it('links a video to a topic without touching media or cues (S2)', async () => {
    const id = await addAnalyzedVideo();
    const before = await (await fetch(`${base}/library/documents/${id}`, {
      headers: { accept: 'application/json' },
    })).json() as { media: { sha256: string }; cues: unknown[] };

    const linked = await linkTopic(id, 'agents');
    expect(linked.status).toBe(201);

    const detail = await (await fetch(`${base}/library/documents/${id}`)).text();
    expect(detail).toContain('topic-link-panel');
    expect(detail).toContain('Linked topics');
    // Panel must not be inside the workbench: #191 owns that scroll contract.
    expect(detail.indexOf('doc-topic-link')).toBeLessThan(detail.indexOf('video-workbench'));

    const topicPage = await (await fetch(`${base}/t/agents`)).text();
    expect(topicPage).toContain(id);

    const after = await (await fetch(`${base}/library/documents/${id}`, {
      headers: { accept: 'application/json' },
    })).json() as { media: { sha256: string }; cues: unknown[] };
    expect(after.media.sha256).toBe(before.media.sha256);
    expect(after.cues).toEqual(before.cues);
    expect(linkRowsFor(id)).toHaveLength(1);
  });

  it('suggests at most 3 topics and clicking only fills the form (S3)', async () => {
    const noteId = await createNote('Agent harness notes', 'Trusting coding agents needs a harness and review loop.');
    const noteDetail = await (await fetch(`${base}/library/documents/${noteId}`)).text();
    expect(noteDetail).toContain('data-topic-suggest');
    expect(noteDetail).toContain('TOPIC_SUGGEST_JS');
    expect((noteDetail.match(/data-suggest-topic=/g) ?? []).length).toBeLessThanOrEqual(3);
    // Suggestions are render-only: no link row was written.
    expect(linkRowsFor(noteId)).toHaveLength(0);
    // The panel fills this form; it never posts on its own.
    expect(noteDetail).toContain('id="topic-link-form"');
  });

  it('supports a second link and an unlink, like a paper (S4)', async () => {
    const id = await createNote('Multi link note', 'Retrieval and agents both matter here.');
    expect((await linkTopic(id, 'agents')).status).toBe(201);
    expect((await linkTopic(id, 'retrieval')).status).toBe(201);
    expect(linkRowsFor(id)).toHaveLength(2);

    const removed = await fetch(`${base}/library/documents/${id}/links/topic/agents`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const detail = await (await fetch(`${base}/library/documents/${id}`)).text();
    expect(detail).toContain('retrieval');

    const agentsPage = await (await fetch(`${base}/t/agents`)).text();
    expect(agentsPage).not.toContain('Multi link note');
    const retrievalPage = await (await fetch(`${base}/t/retrieval`)).text();
    expect(retrievalPage).toContain('Multi link note');
  });

  it('still refuses unsupported actions on notes and videos', async () => {
    const reads = await fetch(`${base}/library/documents/${noteS1Id}/reads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'r1' }),
    });
    expect(reads.status).toBe(422);
  });
});
