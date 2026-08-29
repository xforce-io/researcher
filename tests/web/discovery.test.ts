import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDashboard, loadLibrary, loadLibraryPaper, loadTopic, loadWorkspaceHome } from '../../src/web/discovery.js';
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
  writeFileSync(join(trace, 'notes/active/12_mid.md'),
    '---\nzone: active\npin: false\nscore: 0.5\ndwell: 1\n---\n# Mid note');
  writeFileSync(join(trace, 'notes/active/24_new.md'),
    '---\nzone: active\npin: false\nscore: 0.2\ndwell: 0\n---\n# New note');
  writeFileSync(join(trace, 'notes/buffer/02_buffer.md'),
    '---\nzone: buffer\npin: false\nscore: 0.4\ndwell: 1\n---\n# Buffer note');
  writeFileSync(join(trace, 'notes/buffer/08_buffer_newer.md'),
    '---\nzone: buffer\npin: false\nscore: 0.3\ndwell: 0\n---\n# Newer buffer');
  writeFileSync(join(trace, 'notes/history/01_history.md'),
    '---\nzone: history\npin: false\nscore: 0.1\ndwell: 4\n---\n# History note');
  writeFileSync(join(trace, 'notes/history/06_history_newer.md'),
    '---\nzone: history\npin: false\nscore: 0.05\ndwell: 1\n---\n# Newer history');
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
  mkdirSync(join(root, '.researcher-workspace/library/papers/paper_arxiv_2401_12345'), { recursive: true });
  writeFileSync(join(root, '.researcher-workspace/library/papers/paper_arxiv_2401_12345/read.md'), '# Library Read\n\n## Findings\n\n- Useful paper.');
  lib.upsertLink({ paperId: 'paper_arxiv_2401_12345', surfaceType: 'topic', surfaceId: 'trace', rationale: 'matches RQ1' });
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
    expect(trace.noteCount).toBe(7);     // integrated notes only; pending and 00_landscape excluded
    expect(trace.lastRun).toBe('2026-06-20T10:00:00Z');
    expect(trace.decisionCounts).toEqual({ 'deep-read': 1, skim: 1, reject: 0 });
    expect(decision.active).toBe(false);
    expect(decision.available).toBe(false);
  });
});

describe('loadWorkspaceHome', () => {
  it('summarizes workspace topics and library state', () => {
    const m = loadWorkspaceHome(root);
    expect(m.root).toBe(root);
    expect(m.name).toBe(root.split('/').pop());
    expect(m.lastActivity).toBeTruthy();
    expect(m.topicCounts).toEqual({
      total: 3,
      active: 2,
      available: 2,
      dormant: 1,
      unavailable: 1,
    });
    expect(m.libraryCounts).toEqual({
      papers: 1,
      unread: 0,
      reading: 0,
      read: 1,
      failed: 0,
      linked: 1,
      integrated: 1,
      unlinked: 0,
      toIntegrate: 0,
    });
    expect(m.activeTopics.map((t) => t.path)).toEqual(['trace', 'feeds/ai-safety']);
    expect(m.topicPaths).toEqual(['trace', 'decision', 'feeds/ai-safety']);
    expect(m.recentPapers.map((p) => p.id)).toEqual(['paper_arxiv_2401_12345']);
    // feeds/ai-safety never ran → stale attention item
    expect(m.attention.some((a) => a.kind === 'stale-topic' && a.title === 'feeds/ai-safety')).toBe(true);
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
    expect(v.notes.map((n) => [n.num, n.zone])).toEqual([
      ['24', 'active'],
      ['12', 'active'],
      ['08', 'buffer'],
      ['06', 'history'],
      ['03', 'active'],
      ['02', 'buffer'],
      ['01', 'history'],
    ]);
    const active = v.notes.filter((n) => n.zone === 'active');
    expect(active[0].title).toBe('New note');
    expect(active.map((n) => n.num)).toEqual(['24', '12', '03']);
    expect(v.notes.find((n) => n.path === 'notes/active/03_active.md')!.pin).toBe(true);
    expect(v.notes.find((n) => n.path === 'notes/active/03_active.md')!.score).toBe(0.8);
    expect(v.notes.filter((n) => n.zone === 'buffer').map((n) => n.num)).toEqual(['08', '02']);
    expect(v.notes.filter((n) => n.zone === 'history').map((n) => n.num)).toEqual(['06', '01']);
    expect(v.papers).toEqual([{ id: '2401.00001', file: 'papers/2401.00001.pdf' }]);
    expect(v.relatedPapers).toEqual([
      expect.objectContaining({
        id: 'paper_arxiv_2401_12345',
        displayTitle: 'Reusable Paper Cards',
        tags: ['agent', 'planning'],
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
  it('marks hollow shallow-onboard soul as needsSetup even when thesis ≠ template bytes', () => {
    const hollow = join(root, 'hollow');
    mkdirSync(join(hollow, '.researcher/state'), { recursive: true });
    writeFileSync(join(hollow, '.researcher/project.yaml'),
      'meta:\n  topic_oneline: "agentic model training领域进展研究"\n  language: zh\n' +
      'research_questions:\n  - { id: RQ1, text: "How is the state of the art currently defined for: agentic model training领域进展研究?" }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\n' +
      'sources:\n  - { kind: arxiv, queries: ["agentic model training"] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    // Not byte-equal to template, but still instructional hollow thesis.
    writeFileSync(join(hollow, '.researcher/thesis.md'), [
      '# Thesis',
      '',
      '## Working thesis',
      '',
      'Write one paragraph per major claim - typically one per research question.',
      '',
      '<!-- TODO: revisit after first few papers -->',
      '',
      '## Taste',
      '',
      'What counts as a good paper here? What does a bad one look like?',
      '',
    ].join('\n'));
    const prev = readFileSync(join(root, 'researcher.workspace.yml'), 'utf8');
    writeFileSync(join(root, 'researcher.workspace.yml'),
      prev.trimEnd() + '\n  - { path: hollow, active: true }\n');
    try {
      const v = loadTopic(root, 'hollow')!;
      expect(v.available).toBe(true);
      expect(v.needsSetup).toBe(true);
      expect(v.soulReady).toBe(false);
      expect(v.hasOpenQuestions).toBe(false);

      const card = loadDashboard(root).topics.find((t) => t.path === 'hollow')!;
      expect(card.needsSetup).toBe(true);
    } finally {
      writeFileSync(join(root, 'researcher.workspace.yml'), prev);
    }
  });

  it('marks open_questions as needsSetup + hasOpenQuestions and lists the doc', () => {
    const blocked = join(root, 'blocked-soul');
    mkdirSync(join(blocked, '.researcher/state'), { recursive: true });
    writeFileSync(join(blocked, '.researcher/project.yaml'),
      'meta:\n  topic_oneline: "blocked"\n  language: zh\n' +
      'research_questions:\n  - { id: RQ1, text: "A real research question about mechanisms" }\n' +
      'inclusion_criteria: []\nexclusion_criteria: []\n' +
      'sources:\n  - { kind: arxiv, queries: ["agent trajectory triage"] }\n' +
      'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
    writeFileSync(join(blocked, '.researcher/thesis.md'),
      '# Thesis\n\n## Working thesis\n\nReal claim with a falsifier: X fails if Y.\n\n## Taste\n\n- Prefer mechanisms.\n');
    writeFileSync(join(blocked, '.researcher/open_questions.md'), '# Open Questions\n\n1. What sub-area?\n');
    const prev = readFileSync(join(root, 'researcher.workspace.yml'), 'utf8');
    writeFileSync(join(root, 'researcher.workspace.yml'),
      prev.trimEnd() + '\n  - { path: blocked-soul, active: true }\n');
    try {
      const v = loadTopic(root, 'blocked-soul')!;
      expect(v.needsSetup).toBe(true);
      expect(v.hasOpenQuestions).toBe(true);
      expect(v.soulReady).toBe(false);
      expect(v.docs.map((d) => d.path)).toContain('.researcher/open_questions.md');
    } finally {
      writeFileSync(join(root, 'researcher.workspace.yml'), prev);
    }
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
    expect(v.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'feeds/ai-safety']);
  });

  it('uses a readable arXiv fallback title when metadata title is missing', () => {
    const lib = new PaperLibrary(root, { now: () => '2026-07-02T00:00:00Z' });
    lib.upsertPaper({
      id: 'paper_arxiv_2606_29957',
      canonicalSource: { kind: 'arxiv', id: 'arxiv:2606.29957', url: 'https://arxiv.org/abs/2606.29957' },
      sources: [{ kind: 'arxiv', id: 'arxiv:2606.29957', url: 'https://arxiv.org/abs/2606.29957' }],
      identifiers: { arxiv: '2606.29957' },
      tags: [],
    });
    const paper = loadLibrary(root).papers.find((p) => p.id === 'paper_arxiv_2606_29957')!;
    expect(paper.displayTitle).toBe('arXiv 2606.29957');
  });

  it('loads a paper detail with reads and relations', () => {
    const v = loadLibraryPaper(root, 'paper_arxiv_2401_12345')!;
    expect(v.paper.displayTitle).toBe('Reusable Paper Cards');
    expect(v.topics.map((t) => t.path)).toEqual(['trace', 'decision', 'feeds/ai-safety']);
    expect(v.reads).toEqual([expect.objectContaining({ status: 'read' })]);
    expect(v.notes).toEqual([]);
    expect(v.latestReadArtifact).toEqual({
      path: '.researcher-workspace/library/papers/paper_arxiv_2401_12345/read.md',
      markdown: '# Library Read\n\n## Findings\n\n- Useful paper.',
    });
    expect(v.links).toEqual([expect.objectContaining({ surfaceId: 'trace', rationale: 'matches RQ1' })]);
    expect(v.integrations).toEqual([expect.objectContaining({ topicId: 'trace', zone: 'active' })]);
    expect(Array.isArray(v.topicSuggestions)).toBe(true);
  });

  it('loads paper-local notes on the detail view', () => {
    const lib = new PaperLibrary(root, { now: () => '2026-07-11T12:00:00Z' });
    lib.upsertNote({
      id: 'note_demo',
      paperId: 'paper_arxiv_2401_12345',
      body: 'human attention unit',
      kind: 'note',
      pinned: true,
    });
    const v = loadLibraryPaper(root, 'paper_arxiv_2401_12345')!;
    expect(v.notes).toEqual([expect.objectContaining({ id: 'note_demo', body: 'human attention unit', pinned: true })]);
  });
});
