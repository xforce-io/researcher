import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperLibrary } from '../../src/library/store.js';
import { cuesIntegrationBody, integrationSourceState } from '../../src/pipeline/integration_source.js';
import { classifyEmptyLinkedQueue, scanLinkedLibraryQueue } from '../../src/commands/run.js';

describe('integration source resolution (#197)', () => {
  let root: string;
  let lib: PaperLibrary;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'r-intsrc-'));
    mkdirSync(join(root, '.researcher-workspace/library'), { recursive: true });
    lib = new PaperLibrary(root, { now: () => '2026-09-13T00:00:00.000Z' });
  });

  function addVideo(cues: Array<{ id: number; start: number; end: number; text: string; zh?: string }> | null, noSpeech = false): string {
    const id = `doc_${randomUUID()}`;
    const media = join(tmpdir(), `v-${randomUUID()}.mp4`);
    writeFileSync(media, Buffer.from('mp4'));
    lib.createVideo({ id, sourcePath: media, filename: 'v.mp4', contentType: 'video/mp4', bytes: 3, mutationId: id });
    if (cues) {
      lib.writeVideoAnalysis({
        id: 'analysis_1',
        documentId: id,
        status: 'done',
        createdAt: '2026-09-13T00:00:00.000Z',
        updatedAt: '2026-09-13T00:00:00.000Z',
        mutationId: 'an1',
        noSpeech,
        cues,
      });
    }
    return id;
  }

  function addNote(body: string): string {
    const id = `doc_${randomUUID()}`;
    lib.createNote({ id, title: 'n', body, mutationId: id });
    return id;
  }

  it('uses the transcript for a video that has cues', () => {
    const id = addVideo([{ id: 0, start: 0, end: 1, text: 'hi' }]);
    expect(integrationSourceState(lib, lib.getDocument(id)!)).toEqual({ ready: true, kind: 'cues' });
  });

  it('holds back a video that was never analyzed', () => {
    const id = addVideo(null);
    const state = integrationSourceState(lib, lib.getDocument(id)!);
    expect(state.ready).toBe(false);
    expect(state).toMatchObject({ reason: expect.stringContaining('analyze the video first') });
  });

  it('holds back a video whose transcript is an empty success', () => {
    const id = addVideo([], true);
    const state = integrationSourceState(lib, lib.getDocument(id)!);
    expect(state.ready).toBe(false);
    expect(state).toMatchObject({ reason: expect.stringContaining('no speech detected') });
  });

  it('uses the body for a note', () => {
    const filled = addNote('real content');
    expect(integrationSourceState(lib, lib.getDocument(filled)!)).toEqual({ ready: true, kind: 'note-body' });
    // A blank body cannot reach the Library at all, so the empty-body branch of
    // integrationSourceState stays defensive rather than a reachable state.
    expect(() => addNote('   ')).toThrow(/body must be non-empty/);
  });

  it('uses the deep read for external material', () => {
    lib.upsertPaper({
      id: 'paper_arxiv_2401_00001',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.00001', url: 'https://arxiv.org/abs/2401.00001' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2401.00001', url: 'https://arxiv.org/abs/2401.00001' }],
      identifiers: { arxiv: '2401.00001' },
      tags: [],
    });
    const doc = lib.getDocument('paper_arxiv_2401_00001')!;
    expect(integrationSourceState(lib, doc)).toEqual({ ready: true, kind: 'read' });
  });

  it('keeps timestamps and Chinese cues in the transcript body', () => {
    const body = cuesIntegrationBody([
      { id: 0, start: 0, end: 2, text: 'Trust the harness', zh: '信任这套 harness' },
      { id: 1, start: 3723, end: 3725, text: 'Later line' },
    ]);
    expect(body).toContain('[0:00] Trust the harness');
    expect(body).toContain('信任这套 harness');
    expect(body).toContain('[1:02:03] Later line');
  });
});

describe('linked queue scan (#197)', () => {
  let root: string;
  let lib: PaperLibrary;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'r-queue-'));
    mkdirSync(join(root, '.researcher-workspace/library'), { recursive: true });
    lib = new PaperLibrary(root, { now: () => '2026-09-13T00:00:00.000Z' });
  });

  function linkedVideo(withCues: boolean): string {
    const id = `doc_${randomUUID()}`;
    const media = join(tmpdir(), `v-${randomUUID()}.mp4`);
    writeFileSync(media, Buffer.from('mp4'));
    lib.createVideo({ id, sourcePath: media, filename: 'v.mp4', contentType: 'video/mp4', bytes: 3, mutationId: id });
    if (withCues) {
      lib.writeVideoAnalysis({
        id: 'analysis_1',
        documentId: id,
        status: 'done',
        createdAt: '2026-09-13T00:00:00.000Z',
        updatedAt: '2026-09-13T00:00:00.000Z',
        mutationId: 'an1',
        noSpeech: false,
        cues: [{ id: 0, start: 0, end: 1, text: 'hi' }],
      });
    }
    lib.upsertLink({ paperId: id, surfaceType: 'topic', surfaceId: 'agents' });
    return id;
  }

  it('reports a blocked queue when nothing has an integration source', () => {
    const id = linkedVideo(false);
    const scan = scanLinkedLibraryQueue({ workspaceRoot: root, topicPath: 'agents' });
    expect(scan.candidateId).toBeNull();
    expect(scan.blocked).toEqual([
      expect.objectContaining({ documentId: id, docType: 'video' }),
    ]);
    expect(classifyEmptyLinkedQueue({
      workspaceRoot: root,
      topicPath: 'agents',
      blocked: scan.blocked,
    })).toBe('blocked-queue');
  });

  it('picks the integrable document and still reports the held-back one', () => {
    const blockedId = linkedVideo(false);
    const readyId = linkedVideo(true);
    const scan = scanLinkedLibraryQueue({ workspaceRoot: root, topicPath: 'agents' });
    expect(scan.candidateId).toBe(readyId);
    expect(scan.blocked.map((b) => b.documentId)).toEqual([blockedId]);
  });

  it('is nothing-to-run when the topic has no links at all', () => {
    expect(classifyEmptyLinkedQueue({ workspaceRoot: root, topicPath: 'agents' })).toBe('nothing-to-run');
  });
});
