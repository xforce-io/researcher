import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDashboard, loadTopic } from '../../src/web/discovery.js';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rsw-disc-'));
  writeFileSync(join(root, 'researcher.workspace.yml'),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: decision, active: false }\n  - { path: feeds/ai-safety, active: true }\n');

  // active topic "trace" — fully populated
  const trace = join(root, 'trace');
  mkdirSync(join(trace, '.researcher/state'), { recursive: true });
  mkdirSync(join(trace, 'notes'), { recursive: true });
  mkdirSync(join(trace, 'papers'), { recursive: true });
  writeFileSync(join(trace, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: triage traces\n  language: zh\n' +
    'research_questions:\n  - { id: RQ1, text: how }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\n' +
    'sources:\n  - { kind: arxiv, queries: [agent] }\ncadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(trace, '.researcher/thesis.md'), '# Thesis');
  writeFileSync(join(trace, 'notes/00_research_landscape.md'), '# Landscape');
  writeFileSync(join(trace, 'notes/01_paper.md'), '# Paper note');
  writeFileSync(join(trace, 'report.md'), '# Report');
  writeFileSync(join(trace, 'papers/2401.00001.pdf'), '%PDF');
  writeFileSync(join(trace, '.researcher/state/seen.jsonl'),
    JSON.stringify({ id: 'arxiv:1', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'x' }) + '\n' +
    JSON.stringify({ id: 'arxiv:2', source: 'arxiv', first_seen_run: 'r1', decision: 'skim', reason: 'y' }) + '\n');
  writeFileSync(join(trace, '.researcher/state/watermark.json'),
    JSON.stringify({ last_run_completed_at: '2026-06-20T10:00:00Z', last_run_window: { from: 'a', to: 'b' }, last_run_id: 'r1' }));

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
    expect(trace.paperCount).toBe(1);
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
      ['.researcher/thesis.md', 'notes/00_research_landscape.md', 'report.md', 'notes/01_paper.md']);
    expect(v.papers).toEqual([{ id: '2401.00001', file: 'papers/2401.00001.pdf' }]);
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
