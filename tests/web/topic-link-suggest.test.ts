import { describe, expect, it } from 'vitest';
import {
  extractReadSuggestExcerpt,
  suggestTopicLinks,
  tokenize,
  type TopicSuggestProfile,
} from '../../src/web/topic-link-suggest.js';
import { renderLibraryPaper } from '../../src/web/views.js';
import type { LibraryPaperDetailView, TopicLinkSuggestion } from '../../src/web/discovery.js';

describe('tokenize', () => {
  it('extracts english tokens and cjk bigrams', () => {
    const t = tokenize('LLM verifier 轨迹 失败');
    expect(t.has('llm')).toBe(true);
    expect(t.has('verifier')).toBe(true);
    expect(t.has('轨迹')).toBe(true);
    expect(t.has('失败')).toBe(true);
  });
});

describe('suggestTopicLinks', () => {
  const topics: TopicSuggestProfile[] = [
    {
      topicId: 'trace',
      oneline: 'agent trajectory triage and failure process',
      thesisExcerpt: '轨迹流 分诊 失败 信号 trace observability',
    },
    {
      topicId: 'decision',
      oneline: 'Decision Agent harness verification and selection gate',
      thesisExcerpt: '治理 harness verification judge selection',
    },
    {
      topicId: 'world-model',
      oneline: 'world model memory sleep consolidate',
      thesisExcerpt: 'world model causal robot memory',
    },
    {
      topicId: 'data',
      oneline: 'etl warehouse batch jobs',
      thesisExcerpt: 'schema migration parquet iceberg lakehouse ingestion cadence',
    },
  ];

  it('ranks topics by overlap and truncates to topK', () => {
    const out = suggestTopicLinks(
      {
        title: 'LLM-as-a-Verifier',
        notes: [
          'LM judge 提升的是 selection 不是 generation；verification gate 选 trajectory',
        ],
        readExcerpt: '**做法** continuous verifier on trajectories **边界** needs logprobs',
      },
      topics,
      { topK: 2 },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out[0].topicId).toMatch(/decision|trace/);
    expect(out.map((s) => s.topicId)).not.toContain('data');
    expect(out.every((s) => s.rationaleDraft.length > 0)).toBe(true);
    expect(out[0].reason.length).toBeGreaterThan(0);
    expect(out[0].score).toBeGreaterThanOrEqual(out[out.length - 1]?.score ?? 0);
  });

  it('drops topics below minScore / no overlap', () => {
    const out = suggestTopicLinks(
      { title: 'Completely Orthogonal Astrophysics Quasar Redshift Survey' },
      topics,
      { minScore: 5 },
    );
    expect(out).toEqual([]);
  });

  it('does not invent topic ids outside the profile list', () => {
    const out = suggestTopicLinks(
      { title: 'verification selection trajectory failure' },
      topics,
    );
    for (const s of out) {
      expect(topics.some((t) => t.topicId === s.topicId)).toBe(true);
    }
  });

  it('extractReadSuggestExcerpt pulls Essence and Takeaway', () => {
    const md = [
      '# T',
      '',
      '> Frame line',
      '',
      '## Essence',
      '',
      '**问题** x',
      '',
      '## Claims',
      '',
      '- c',
      '',
      '## Takeaway',
      '',
      '- remember y',
    ].join('\n');
    const ex = extractReadSuggestExcerpt(md);
    expect(ex).toContain('问题');
    expect(ex).toContain('remember y');
    expect(ex).not.toContain('## Claims');
  });
});

describe('renderLibraryPaper Topic link Suggest UI', () => {
  function base(overrides: Partial<LibraryPaperDetailView> = {}): LibraryPaperDetailView {
    return {
      root: '/ws',
      paper: {
        id: 'paper_arxiv_2607_05391',
        displayTitle: 'LLM-as-a-Verifier',
        canonicalId: 'arxiv:2607.05391',
        sourceLabel: 'arxiv:2607.05391',
        tags: [],
        readStatus: 'read',
        linkedTopicCount: 0,
        integratedTopicCount: 0,
        updatedAt: '2026-07-16T00:00:00Z',
      },
      topics: [
        { slug: 'decision', path: 'decision', active: true, available: true },
        { slug: 'trace', path: 'trace', active: true, available: true },
        { slug: 'data', path: 'data', active: true, available: true },
      ],
      reads: [],
      notes: [],
      latestReadArtifact: null,
      links: [],
      integrations: [],
      topicSuggestions: [],
      ...overrides,
    };
  }

  const suggestions: TopicLinkSuggestion[] = [
    {
      topicId: 'decision',
      score: 12,
      reason: 'selection gate / verifier',
      rationaleDraft: 'selection gate / verifier',
    },
    {
      topicId: 'trace',
      score: 8,
      reason: 'trajectory verification',
      rationaleDraft: 'trajectory verification',
    },
  ];

  it('renders one panel: Suggest + fields + primary Link at same level', () => {
    const html = renderLibraryPaper(base({ topicSuggestions: suggestions }));
    expect(html).toContain('class="topic-link-panel"');
    expect(html).toContain('class="topic-suggest"');
    expect(html).toContain('data-suggest-topic="decision"');
    expect(html).toContain('selection gate / verifier');
    expect(html).toContain('pick → edit below → Link');
    expect(html).toContain('action="/library/link"');
    expect(html).toContain('name="topic"');
    // Confirm is primary, panel-level — not a secondary buried control
    expect(html).toMatch(/class="primary topic-link-submit"[^>]*>Link topic</);
    // Suggest rows are type=button only (not form submit)
    expect(html).toMatch(/type="button" class="topic-suggest-item"/);
    expect(html).not.toMatch(/class="topic-suggest-item"[^>]*type="submit"/);
    expect(html).not.toMatch(/type="submit"[^>]*class="topic-suggest-item"/);
    expect(html).toContain('TOPIC_SUGGEST_JS');
    // Status line for post-pick guidance
    expect(html).toContain('data-suggest-status');
  });

  it('hides Suggest shell when suggestions empty; form still has primary Link', () => {
    const html = renderLibraryPaper(base({ topicSuggestions: [] }));
    expect(html).not.toContain('class="topic-suggest"');
    expect(html).not.toContain('pick → edit below → Link');
    expect(html).toContain('action="/library/link"');
    expect(html).toMatch(/class="primary topic-link-submit"[^>]*>Link topic</);
  });

  it('weakens Suggest label when already linked once', () => {
    const html = renderLibraryPaper(base({
      topicSuggestions: suggestions,
      paper: {
        ...base().paper,
        linkedTopicCount: 1,
      },
      links: [{
        paperId: 'paper_arxiv_2607_05391',
        surfaceType: 'topic',
        surfaceId: 'decision',
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }],
    }));
    expect(html).toContain('Also consider');
    expect(html).toContain('class="topic-suggest is-weak"');
  });

  it('hides Suggest when multi-linked or integrated', () => {
    const multi = renderLibraryPaper(base({
      topicSuggestions: suggestions,
      paper: { ...base().paper, linkedTopicCount: 2 },
      links: [
        {
          paperId: 'p', surfaceType: 'topic', surfaceId: 'decision',
          createdAt: 'a', updatedAt: 'a',
        },
        {
          paperId: 'p', surfaceType: 'topic', surfaceId: 'trace',
          createdAt: 'a', updatedAt: 'a',
        },
      ],
    }));
    expect(multi).not.toContain('class="topic-suggest');

    const integrated = renderLibraryPaper(base({
      topicSuggestions: suggestions,
      paper: { ...base().paper, linkedTopicCount: 1, integratedTopicCount: 1 },
      integrations: [{
        paperId: 'p', topicId: 'decision', integratedAt: '2026-07-01T00:00:00Z',
      }],
    }));
    expect(integrated).not.toContain('class="topic-suggest');
  });

  it('suggest pick JS only mutates form fields (contract in script)', () => {
    const html = renderLibraryPaper(base({ topicSuggestions: suggestions }));
    // Script is inlined; must set select/input values, must not fetch link endpoint.
    expect(html).toMatch(/form\.querySelector\(['"]select\[name="topic"\]['"]\)/);
    expect(html).toMatch(/name="rationale"/);
    expect(html).not.toMatch(/fetch\(['"]\/library\/link/);
    expect(html).toContain('data-rationale=');
    expect(html).not.toContain('data-relation=');
  });
});
