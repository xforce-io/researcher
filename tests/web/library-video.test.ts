import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { startServer } from '../../src/web/server.js';
import { PaperLibrary } from '../../src/library/store.js';
import { runLibraryList, runLibraryShow } from '../../src/commands/library.js';
import { runWorkspaceSync } from '../../src/workspace/sync.js';
import { currentCueAtTime } from '../../src/library/video.js';

function gitInit(dir: string): void {
  execaSync('git', ['init', '-b', 'main'], { cwd: dir });
  execaSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execaSync('git', ['config', 'user.name', 't'], { cwd: dir });
}

describe('library video HTTP (S1–S5)', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  let base: string;
  const speech = Buffer.from('speech-mp4');
  const silent = Buffer.from('silent-mp4');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-vid-http-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    gitInit(root);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't/a'), '1');
    execaSync('git', ['add', '-A'], { cwd: join(root, 't') });
    execaSync('git', ['commit', '-m', 't'], { cwd: join(root, 't') });
    execaSync('git', ['add', '-A'], { cwd: root });
    execaSync('git', ['commit', '-m', 'super', '--allow-empty'], { cwd: root });
    server = await startServer({
      root,
      port: 0,
      videoAnalyzeRunner: async ({ mediaPath }) => {
        await new Promise((r) => setTimeout(r, 80));
        const bytes = readFileSync(mediaPath);
        if (bytes.equals(silent)) return { cues: [] };
        if (String(process.env.VIDEO_ANALYZE_FAIL) === '1') {
          throw new Error('injected analyzer failure');
        }
        return {
          cues: [
            { id: 0, start: 0, end: 2, text: 'Hello Benny' },
            { id: 1, start: 3, end: 5, text: 'Trust the agent' },
          ],
        };
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  async function addVideo(buf: Buffer, name: string, mutationId: string) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'video/mp4' }), name);
    form.append('mutationId', mutationId);
    return fetch(base + '/library/documents/videos', { method: 'POST', body: form });
  }

  async function waitDone(docId: string, analysisId: string) {
    for (let i = 0; i < 40; i += 1) {
      const st = await (await fetch(`${base}/library/documents/${docId}/analyses/${analysisId}`)).json() as { status: string };
      if (st.status === 'done' || st.status === 'failed') return st;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('analysis timeout');
  }

  it('ingests a copy that still plays after the original is moved (S1)', async () => {
    const html = await (await fetch(base + '/library')).text();
    expect(html).toContain('Add video');
    expect(html).toContain('data-open-add-menu');
    expect(html).toContain('Documents');
    expect(html).not.toContain('<h2>Papers</h2>');
    expect(html).toContain('data-type-filter="video"');
    const original = join(root, 'talk.mp4');
    writeFileSync(original, speech);
    const res = await addVideo(speech, 'talk.mp4', 'm-s1');
    expect(res.status).toBe(201);
    const created = await res.json() as { id: string; url: string };
    unlinkSync(original);
    const page = await (await fetch(base + created.url)).text();
    expect(page).toContain('talk');
    expect(page).toContain('/media');
    expect(page).toContain(root);
    expect(page).toMatch(/video · \d{4}-\d{2}-\d{2}</);
    expect(page).not.toMatch(/video · \d{4}-\d{2}-\d{2}T/);
    expect(page).toContain('src="/static/video-workbench.js"');
    expect(page).toContain('class="video-workbench"');
    const media = await fetch(base + created.url + '/media');
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer()).equals(speech)).toBe(true);
    const listed = await (await fetch(base + '/library/documents?type=video&status=unlinked', {
      headers: { accept: 'application/json' },
    })).json() as { id: string }[];
    expect(listed.some((d) => d.id === created.id)).toBe(true);
    const unread = await (await fetch(base + '/library/documents?type=video&status=unread', {
      headers: { accept: 'application/json' },
    })).json() as unknown[];
    expect(unread).toHaveLength(0);
    const out: string[] = [];
    runLibraryList({ cwd: root, type: 'video', write: (s) => out.push(s) });
    expect(out.join('')).toContain('\tvideo\t');
  });

  it('analyzes speech and silence (S2) and searches/seeks (S3)', async () => {
    const speechDoc = await (await addVideo(speech, 'voice.mp4', 'm-s2a')).json() as { id: string };
    const started = await fetch(`${base}/library/documents/${speechDoc.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an1' }),
    });
    expect(started.status).toBe(202);
    const { id: analysisId } = await started.json() as { id: string };
    const mid = await (await fetch(`${base}/library/documents/${speechDoc.id}`)).text();
    expect(mid).toMatch(/data-analyzing>Analyzing/);
    const done = await waitDone(speechDoc.id, analysisId);
    expect(done.status).toBe('done');
    const cues = await (await fetch(`${base}/library/documents/${speechDoc.id}/cues`)).json() as {
      cues: Array<{ id: number; start: number; end: number; text: string }>; noSpeech: boolean;
    };
    expect(cues.cues.length).toBeGreaterThanOrEqual(1);
    expect(cues.noSpeech).toBe(false);
    const hit = cues.cues.filter((c) => c.text.toLowerCase().includes('benny'));
    expect(hit).toHaveLength(1);
    expect(currentCueAtTime(hit, hit[0].start)?.id).toBe(hit[0].id);
    expect(currentCueAtTime(hit, 2.5)).toBeNull();
    const silentDoc = await (await addVideo(silent, 'quiet.mp4', 'm-s2b')).json() as { id: string };
    const s2 = await fetch(`${base}/library/documents/${silentDoc.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an2' }),
    });
    const s2id = (await s2.json() as { id: string }).id;
    await waitDone(silentDoc.id, s2id);
    const empty = await (await fetch(`${base}/library/documents/${silentDoc.id}/cues`)).json() as { cues: unknown[]; noSpeech: boolean };
    expect(empty.cues).toEqual([]);
    expect(empty.noSpeech).toBe(true);
    const page = await (await fetch(`${base}/library/documents/${silentDoc.id}`)).text();
    expect(page).toContain('No speech detected');
    expect(page).not.toContain('Analysis failed');
  });

  it('keeps cues when analysis fails and updates after retry (S4)', async () => {
    const created = await (await addVideo(speech, 'retry.mp4', 'm-s4')).json() as { id: string };
    const ok = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'ok' }),
    });
    await waitDone(created.id, (await ok.json() as { id: string }).id);
    const before = await (await fetch(`${base}/library/documents/${created.id}/cues`)).json();
    process.env.VIDEO_ANALYZE_FAIL = '1';
    const bad = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'bad' }),
    });
    const badId = (await bad.json() as { id: string }).id;
    const failed = await waitDone(created.id, badId);
    expect(failed.status).toBe('failed');
    const kept = await (await fetch(`${base}/library/documents/${created.id}/cues`)).json();
    expect(kept).toEqual(before);
    delete process.env.VIDEO_ANALYZE_FAIL;
    const again = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'ok2' }),
    });
    await waitDone(created.id, (await again.json() as { id: string }).id);
    const after = await (await fetch(`${base}/library/documents/${created.id}/cues`)).json() as { cues: unknown[] };
    expect(after.cues.length).toBeGreaterThan(0);
    expect(new PaperLibrary(root).listDocuments().filter((d) => d.id === created.id)).toHaveLength(1);
  });

  it('syncs text not media and restores the same fingerprint (S5)', async () => {
    const created = await (await addVideo(speech, 'sync.mp4', 'm-s5')).json() as { id: string };
    const started = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'sync-an' }),
    });
    await waitDone(created.id, (await started.json() as { id: string }).id);
    await runWorkspaceSync({ cwd: root, library: true });
    const tracked = execaSync('git', ['ls-files', '--', '.researcher-workspace/library'], { cwd: root })
      .stdout.split('\n').filter(Boolean);
    expect(tracked.some((p) => p.endsWith('document.md') && p.includes(created.id))).toBe(true);
    expect(tracked.some((p) => p.includes(`/analyses/`) && p.endsWith('.json'))).toBe(true);
    expect(tracked.join('\n')).not.toMatch(/assets\/media/);
    const mediaPath = new PaperLibrary(root).videoMediaPath(new PaperLibrary(root).getDocument(created.id)!);
    unlinkSync(mediaPath);
    const page = await (await fetch(`${base}/library/documents/${created.id}`)).text();
    expect(page).toContain('Media file is missing');
    expect(page).toContain('Hello Benny');
    expect(page).toContain('id="cue-q"');
    expect(page).not.toMatch(/id="cue-q"[^>]*disabled/);
    expect(page).toContain('Choose a file to restore.');
    const other = new FormData();
    other.append('file', new Blob([silent], { type: 'video/mp4' }), 'other.mp4');
    const denied = await fetch(`${base}/library/documents/${created.id}/media/restore`, { method: 'POST', body: other });
    expect(denied.status).toBe(409);
    expect(existsSync(mediaPath)).toBe(false);
    const same = new FormData();
    same.append('file', new Blob([speech], { type: 'video/mp4' }), 'sync.mp4');
    const restored = await fetch(`${base}/library/documents/${created.id}/media/restore`, { method: 'POST', body: same });
    expect(restored.status).toBe(204);
    expect(existsSync(mediaPath)).toBe(true);
    const show: string[] = [];
    runLibraryShow({ cwd: root, documentId: created.id, write: (s) => show.push(s) });
    expect(show.join('')).toContain('Hello Benny');
    const reads = await fetch(`${base}/library/documents/${created.id}/reads`);
    expect(reads.status).toBe(422);
  });
});

describe('video analysis terminal state (#193)', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  let base: string;
  const speech = Buffer.from('speech-mp4');
  let blocking: Promise<void> | undefined;

  function armBlock(): () => void {
    let release = () => {};
    blocking = new Promise<void>((r) => { release = r; });
    return () => {
      release();
      blocking = undefined;
    };
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'r-vid-term-'));
    writeFileSync(join(root, 'researcher.workspace.yml'), 'version: 1\ntopics:\n  - { path: t, active: true }\n');
    mkdirSync(join(root, 't/.researcher'), { recursive: true });
    writeFileSync(join(root, 't/.researcher/project.yaml'),
      'meta:\n  topic_oneline: t\n  language: en\nresearch_questions:\n  - { id: RQ1, text: q }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(root, 't/.researcher/thesis.md'), '# Thesis\n\n## Working thesis\n\nT.\n');
    gitInit(root);
    gitInit(join(root, 't'));
    writeFileSync(join(root, 't/a'), '1');
    execaSync('git', ['add', '-A'], { cwd: join(root, 't') });
    execaSync('git', ['commit', '-m', 't'], { cwd: join(root, 't') });
    execaSync('git', ['add', '-A'], { cwd: root });
    execaSync('git', ['commit', '-m', 'super', '--allow-empty'], { cwd: root });
    server = await startServer({
      root,
      port: 0,
      videoAnalyzeRunner: async () => {
        const wait = blocking;
        if (wait) await wait;
        return { cues: [{ id: 0, start: 0, end: 2, text: 'Hello Benny' }] };
      },
      videoTranslate: async () => {
        throw new Error('injected translate failure');
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  async function addVideo(name: string, mutationId: string) {
    const form = new FormData();
    form.append('file', new Blob([speech], { type: 'video/mp4' }), name);
    form.append('mutationId', mutationId);
    return fetch(base + '/library/documents/videos', { method: 'POST', body: form });
  }

  async function waitDone(docId: string, analysisId: string) {
    for (let i = 0; i < 40; i += 1) {
      const st = await (await fetch(`${base}/library/documents/${docId}/analyses/${analysisId}`)).json() as { status: string };
      if (st.status === 'done' || st.status === 'failed') return st;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('analysis timeout');
  }

  it('finishes Analyze without Chinese cues and allows another run (S1)', async () => {
    const created = await (await addVideo('s1.mp4', 'm-s1')).json() as { id: string };
    const started = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an-s1' }),
    });
    expect(started.status).toBe(202);
    const { id: analysisId } = await started.json() as { id: string };
    const mid = await (await fetch(`${base}/library/documents/${created.id}`)).text();
    expect(mid).toMatch(/data-analyzing>Analyzing|Hello Benny/);
    const done = await waitDone(created.id, analysisId) as { status: string; cues?: Array<{ text: string; zh?: string }> };
    expect(done.status).toBe('done');
    const cues = await (await fetch(`${base}/library/documents/${created.id}/cues`)).json() as {
      cues: Array<{ text: string; zh?: string }>;
    };
    expect(cues.cues[0].text).toBe('Hello Benny');
    expect(cues.cues[0].zh).toBeUndefined();
    const page = await (await fetch(`${base}/library/documents/${created.id}`)).text();
    expect(page).toContain('Hello Benny');
    expect(page).not.toMatch(/data-analyzing>Analyzing/);
    expect(page).toContain('id="analyze-btn"');
    expect(page).not.toMatch(/id="analyze-btn"[^>]*disabled/);
    const again = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an-s1b' }),
    });
    expect(again.status).toBe(202);
    const againId = (await again.json() as { id: string }).id;
    expect(againId).not.toBe(analysisId);
    await waitDone(created.id, againId);
    expect(new PaperLibrary(root).listDocuments().filter((d) => d.id === created.id)).toHaveLength(1);
  });

  it('unlocks a stale running record and lets Analyze start (S2)', async () => {
    const created = await (await addVideo('s2.mp4', 'm-s2')).json() as { id: string };
    const ok = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an-s2-ok' }),
    });
    await waitDone(created.id, (await ok.json() as { id: string }).id);
    const lib = new PaperLibrary(root);
    const staleId = `analysis_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
    lib.writeVideoAnalysis({
      id: staleId,
      documentId: created.id,
      status: 'running',
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
      mutationId: 'stale-run',
    });
    const page = await (await fetch(`${base}/library/documents/${created.id}`)).text();
    expect(page).toContain('Hello Benny');
    expect(page).not.toMatch(/data-analyzing>Analyzing/);
    expect(page).toContain('Analysis interrupted');
    expect(page).not.toMatch(/id="analyze-btn"[^>]*disabled/);
    const st = await (await fetch(`${base}/library/documents/${created.id}/analyses/${staleId}`)).json() as {
      status: string; lastError?: string;
    };
    expect(st.status).toBe('failed');
    expect(st.lastError).toBe('Analysis interrupted');
    const cues = await (await fetch(`${base}/library/documents/${created.id}/cues`)).json() as { cues: Array<{ text: string }> };
    expect(cues.cues[0].text).toBe('Hello Benny');
    const retry = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'an-s2-retry' }),
    });
    expect(retry.status).toBe(202);
    const retryId = (await retry.json() as { id: string }).id;
    expect(retryId).not.toBe(staleId);
    await waitDone(created.id, retryId);
    expect(lib.listDocuments().filter((d) => d.id === created.id)).toHaveLength(1);
  });

  it('returns 409 only while a live job exists', async () => {
    const created = await (await addVideo('s409.mp4', 'm-409')).json() as { id: string };
    const release = armBlock();
    const first = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'hold-1' }),
    });
    expect(first.status).toBe(202);
    const { id: firstId } = await first.json() as { id: string };
    const second = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'hold-2' }),
    });
    expect(second.status).toBe(409);
    release();
    await waitDone(created.id, firstId);
    const after = await fetch(`${base}/library/documents/${created.id}/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: 'after-hold' }),
    });
    expect(after.status).toBe(202);
    await waitDone(created.id, (await after.json() as { id: string }).id);
  });
});
