import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDashboard, loadLibrary, loadTopic } from '../../src/web/discovery.js';
import { PaperLibrary } from '../../src/library/store.js';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rsw-disc-'));
  writeFileSync(join(root, 'researcher.workspace.yml'),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: decision, active: false }\n  - { path: feeds/ai-safety, active: true }\n');

  // active topic "trace" — fully populated
  const trace = join(root, 'trace');
  mkdirSync(join(trace, '.researcher/state'), { recursive: true });
  mkdirSync(join(trace, 'notes/active'), { recursive: true });
  mkdirSync(join(trace, 'notes/buffer'), { recursive: true });
  mkdirSync(join(trace, 'notes/history'), { recursive: true });
  mkdirSync(join(trace, 'notes/pending'), { recursive: true });
  mkdirSync(join(trace, 'papers'), { recursive: true });
  writeFileSync(join(trace, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: triage traces\n  language: zh\n' +
    'research_questions:\n  - { id: RQ1, text: how }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\n' +
    'sources:\n  - { kind: arxiv, queries: [agent] }\ncadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(trace, '.researcher/thesis.md'), '# Thesis');
  writeFileSync(join(trace, 'notes/00_research_landscape.md'), '# Landscape');
  writeFileSync(join(trace, 'notes/active/03_active.md'),
    '---\nzone: active\npin: true\nscore: 0.8\ndwell: 2\n---\n# Active note');
  writeFileSync(join(trace, 'notes/buffer/02_buffer.md'),
    '---\nzone: buffer\npin: false\nscore: 0.4\ndwell: 1\n---\n# Buffer note');
  writeFileSync(join(trace, 'notes/history/01_history.md'),
    '---\nzone: history\npin: false\nscore: 0.1\ndwell: 4\n---\n# History note');
  writeFileSync(join(trace, 'notes/pending/04_pending.md'),
    '---\nzone: pending\ntags: []\npin: false\nscore: 0\ndwell: 0\n---\n# Pending note');
  writeFileSync(join(trace, 'report.md'), '# Report');
  writeFileSync(join(trace, 'papers/2401.00001.pdf'), '%PDF');
  writeFileSync(join(trace, '.researcher/state/seen.jsonl'),
    JSON.stringify({ id: 'arxiv:1', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'x' }) + '\n' +
    JSON.stringify({ id: 'arxiv:2', source: 'arxiv', first_seen_run: 'r1', decision: 'skim', reason: 'y' }) + '\n');
  writeFileSync(join(trace, '.researcher/state/watermark.json'),
    JSON.stringify({ last_run_completed_at: '2026-06-20T10:00:00Z', last_run_window: { from: 'a', to: 'b' }, last_run_id: 'r1' }));

  const lib = new PaperLibrary(root, { now: () => '2026-07-02T00:00:00Z' });
  lib.upsertPaper({
    id: 'paper_arxiv_2401_12345',
    canonicalSource: { kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' },
    sources: [{ kind: 'arxiv', id: 'arxiv:2401.12345', url: 'https://arxiv.org/abs/2401.12345' }],
    identifiers: { arxiv: '2401.12345' },
    title: 'Reusable Paper Cards',
    tags: ['agent', 'planning'],
  });
  lib.upsertRead({ id: 'read-1', paperId: 'paper_arxiv_2401_12345', status: 'read', artifactPath: '.researcher-workspace/library/papers/paper_arxiv_2401_12345/read.md' });
  lib.upsertLink({ paperId: 'paper_arxiv_2401_12345', surfaceType: 'topic', surfaceId: 'trace', relation: 'relevant', rationale: 'matches RQ1' });
  lib.upsertIntegration({ paperId: 'paper_arxiv_2401_12345', topicId: 'trace', notePath: 'trace/notes/active/03_active.md', zone: 'active', integratedAt: '2026-07-02T01:00:00Z', summary: 'used in landscape' });

  // dormant topic "decision" — directory exists but no .researcher/
  mkdirSync(join(root, 'decision'), { recursive: true });

  // nested-path topic "feeds/ai-safety" — fully available
  const feedsAi = join(root, 'feeds/ai-safety');
  mkdirSync(join(feedsAi, '.researcher'), { recursive: true });
  writeFileSync(join(feedsAi, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: ai safety feeds\n  language: en\n' +
    'research_questions:\n  - { id: RQ1, text: safe }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\n' +
    'sources:\n  - { kind: arxiv, queries: [safety] }\ncadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(feedsAi, '.researcher/thesis.md'), '# AI Safety Thesis');
});

describe('loadDashboard', () => {
  it('lists all topics with active/available flags', () => {
    const m = loadDashboard(root);
    expect(m.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'feeds/ai-safety']);
    const [trace, decision] = m.topics;
    expect(trace.active).toBe(true);
    expect(trace.available).toBe(true);
    expect(trace.oneline).toBe('triage traces');
    expect(trace.noteCount).toBe(3);     // integrated notes only; pending and 00_landscape excluded
    expect(trace.lastRun).toBe('2026-06-20T10:00:00Z');
    expect(trace.decisionCounts).toEqual({ 'deep-read': 1, skim: 1, reject: 0 });
    expect(decision.active).toBe(false);
    expect(decision.available).toBe(false);
  });
});

describe('loadDashboard — nested slug', () => {
  it('produces feeds%2Fai-safety slug for feeds/ai-safety topic', () => {
    const m = loadDashboard(root);
    const card = m.topics.find((t) => t.path === 'feeds/ai-safety');
    expect(card).toBeDefined();
    expect(card!.slug).toBe(encodeURIComponent('feeds/ai-safety'));
    expect(card!.slug).toBe('feeds%2Fai-safety');
  });
});

describe('loadTopic', () => {
  it('returns null for an unknown slug', () => {
    expect(loadTopic(root, 'nope')).toBeNull();
  });
  it('aggregates docs, papers, seen, watermark', () => {
    const v = loadTopic(root, 'trace')!;
    expect(v.available).toBe(true);
    expect(v.docs.map((d) => d.path)).toEqual(
      ['.researcher/thesis.md', 'notes/00_research_landscape.md', 'report.md']);
    expect(v.notes.map((n) => [n.path, n.zone])).toEqual([
      ['notes/history/01_history.md', 'history'],
      ['notes/buffer/02_buffer.md', 'buffer'],
      ['notes/active/03_active.md', 'active'],
    ]);                                                                 // numbered notes split out
    expect(v.notes[2].title).toBe('Active note');                       // from the note's H1
    expect(v.notes[2].pin).toBe(true);
    expect(v.notes[2].score).toBe(0.8);
    expect(v.papers).toEqual([{ id: '2401.00001', file: 'papers/2401.00001.pdf' }]);
    expect(v.relatedPapers).toEqual([
      expect.objectContaining({
        id: 'paper_arxiv_2401_12345',
        displayTitle: 'Reusable Paper Cards',
        tags: ['agent', 'planning'],
        relation: 'relevant',
        integratedTopicCount: 1,
      }),
    ]);
    expect(v.seen).toHaveLength(2);
    expect(v.watermark?.last_run_id).toBe('r1');
    expect(v.sources[0].kind).toBe('arxiv');
  });
  it('unavailable topic returns available=false with empty docs/papers/seen', () => {
    const v = loadTopic(root, 'decision')!;
    expect(v).not.toBeNull();
    expect(v.available).toBe(false);
    expect(v.docs).toEqual([]);
    expect(v.papers).toEqual([]);
    expect(v.seen).toEqual([]);
    expect(v.slug).toBe('decision');
  });
  it('nested slug: loadTopic with encoded slug returns canonical slug', () => {
    const v = loadTopic(root, 'feeds%2Fai-safety')!;
    expect(v).not.toBeNull();
    expect(v.available).toBe(true);
    expect(v.slug).toBe('feeds%2Fai-safety');
    expect(v.path).toBe('feeds/ai-safety');
  });
});

describe('loadLibrary', () => {
  it('loads workspace papers with shared summary fields', () => {
    const v = loadLibrary(root);
    expect(v.papers).toEqual([
      expect.objectContaining({
        id: 'paper_arxiv_2401_12345',
        displayTitle: 'Reusable Paper Cards',
        sourceLabel: 'arXiv',
        tags: ['agent', 'planning'],
        readStatus: 'read',
        linkedTopicCount: 1,
        integratedTopicCount: 1,
      }),
    ]);
    expect(v.selectedPaper).toBeNull();
    expect(v.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'feeds/ai-safety']);
  });

  it('loads a selected paper detail with reads and relations', () => {
    const library = loadLibrary(root, 'paper_arxiv_2401_12345');
    const v = library.selectedPaper!;
    expect(v.paper.displayTitle).toBe('Reusable Paper Cards');
    expect(v.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'feeds/ai-safety']);
    expect(v.reads).toEqual([expect.objectContaining({ status: 'read' })]);
    expect(v.links).toEqual([expect.objectContaining({ surfaceId: 'trace', relation: 'relevant' })]);
    expect(v.integrations).toEqual([expect.objectContaining({ topicId: 'trace', zone: 'active' })]);
  });
});
