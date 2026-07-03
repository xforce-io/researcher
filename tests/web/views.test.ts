import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  renderDoc,
  renderLibrary,
  renderLibraryPaper,
  renderTopic,
  renderTopics,
  renderWorkspaceHome,
  tocTitle,
} from '../../src/web/views.js';
import type { DashboardModel, LibraryPaperDetailView, LibraryView, TopicView, WorkspaceHomeModel } from '../../src/web/discovery.js';

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<a> & "b"')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });
});

describe('renderDoc', () => {
  it('renders markdown headings to html', () => {
    expect(renderDoc('# Hello')).toContain('<h1>Hello</h1>');
  });
  it('renders inline and block math in read artifacts', () => {
    const html = renderDoc([
      'EEVEE uses $P = \\{p_1, \\ldots, p_K\\}$ and $\\hat{y} = M(x; p_z)$.',
      '',
      '$$',
      'S_R = \\lambda_{acc}A + \\lambda_{con}C',
      '$$',
    ].join('\n'));
    expect(html).toContain('class="math-inline"');
    expect(html).toContain('class="math-display"');
    expect(html).toContain('<math');
    expect(html).toContain('<msub>');
    expect(html).not.toContain('$P =');
    expect(html).not.toContain('$$');
  });
  it('lifts a report H1 + key/value blockquote into the aligned fm table', () => {
    const md = '# Decision Agent: Research Report\n\n> **Version:** v19 (19 papers)\n> **Last Updated:** 2026-06-04\n> **Papers:** [01](notes/01.md), [02](notes/02.md)\n\n---\n\n## Body';
    const html = renderDoc(md);
    expect(html).toContain('<h1>Decision Agent: Research Report</h1>');
    expect(html).toContain('class="fm"');
    expect(html).toContain('<dt>Version</dt><dd>v19 (19 papers)</dd>');
    expect(html).toContain('<dt>Last Updated</dt><dd>2026-06-04</dd>');
    expect(html).toContain('href="notes/01.md"');   // inline links rendered in the value
    expect(html).toContain('<h2>Body</h2>');
    expect(html).not.toContain('<blockquote>');      // not left as a flowing blockquote
  });
  it('leaves an ordinary blockquote alone', () => {
    expect(renderDoc('# T\n\n> just a quote, not metadata')).toContain('<blockquote>');
  });
  it('renders a note masthead from YAML frontmatter instead of dumping raw YAML', () => {
    const md = '---\npaper: "Why Reasoning Fails to Plan"\narxiv: "2601.22311"\nauthors: ["Zehong Wang", "Fang Wu"]\nyear: 2026\nnote_number: 3\n---\n\n## Claims\n\n- a claim';
    const html = renderDoc(md);
    expect(html).toContain('class="note-title">Why Reasoning Fails to Plan');
    expect(html).toContain('class="fm"');           // aligned key/value table
    expect(html).toContain('<dt>authors</dt><dd>Zehong Wang, Fang Wu</dd>');
    expect(html).toContain('<dt>arxiv</dt>');
    expect(html).toContain('arxiv.org/abs/2601.22311');
    expect(html).toContain('<dt>year</dt><dd>2026</dd>');
    expect(html).toContain('<h2>Claims</h2>');     // body still rendered
    expect(html).not.toContain('note_number:');     // raw YAML not leaked
    expect(html).not.toContain('paper:');
  });
  it('hides zoning frontmatter and lifts leading note metadata into the masthead table', () => {
    const md = [
      '---',
      'zone: active',
      'pin: false',
      'score: 0',
      'dwell: 0',
      '---',
      '',
      '# 论文阅读笔记：《Signals》',
      '',
      '> **Created:** 2026-04-26 **Last Updated:** 2026-04-26 **状态：** ✅ 已深读 **arXiv:** [2604.00356](https://arxiv.org/abs/2604.00356) **作者:** Shuguang Chen **优先级：** P0',
      '',
      '## Claims',
      '',
      '- a claim',
    ].join('\n');
    const html = renderDoc(md);
    expect(html).toContain('<h1>论文阅读笔记：《Signals》</h1>');
    expect(html).toContain('class="fm compact"');
    expect(html).toContain('<dt>Created</dt><dd>2026-04-26</dd>');
    expect(html).toContain('<dt>Last Updated</dt><dd>2026-04-26</dd>');
    expect(html).toContain('<dt>arXiv</dt>');
    expect(html).toContain('href="https://arxiv.org/abs/2604.00356"');
    expect(html).not.toContain('<blockquote>');
    expect(html).not.toContain('<dt>zone</dt>');
    expect(html).not.toContain('<dt>pin</dt>');
    expect(html).not.toContain('<dt>score</dt>');
    expect(html).not.toContain('<dt>dwell</dt>');
  });
  it('spans narrative note metadata across the masthead grid', () => {
    const md = [
      '---',
      'zone: active',
      'pin: false',
      'score: 0',
      'dwell: 0',
      '---',
      '',
      '# 论文阅读笔记：《Where LLM Agents Fail》',
      '',
      '> **Created:** 2026-05-04',
      '> **状态：** ✅ 已深读',
      '> **arXiv:** [2509.25370](https://arxiv.org/abs/2509.25370)',
      '> **作者:** Kunlun Zhu, Zijia Liu',
      '> **分类轴：** layer = cross_evaluation 为主、并伴随 L1 error 分诊和 L3 iterative 修复，是一段较长的分类说明。',
      '> **角色定位：** 这是一篇 Agent-as-a-Judge 路线在错误归因任务上的具体实例，适合用作反例完整记录。',
    ].join('\n');
    const html = renderDoc(md);
    expect(html).toContain('<div class="wide"><dt>分类轴</dt>');
    expect(html).toContain('<div class="wide"><dt>角色定位</dt>');
    expect(html).toContain('<div><dt>Created</dt><dd>2026-05-04</dd></div>');
  });
  it('renders the Frame lede as a blockquote without mangling a bullet-meta header', () => {
    const md = '# 01 — Metadata Reasoner\n\n> Selecting tables from a big lake — vector search is noisy; an agent reasons over metadata to pick precisely.\n\n- **arXiv**: 2604.20144\n- **Axes**: data_kind = structured\n\n## Claims\n\n- a claim';
    const html = renderDoc(md);
    expect(html).toContain('<blockquote>');                          // Frame rendered as a lede
    expect(html).toContain('an agent reasons over metadata');        // Frame text present
    expect(html).toContain('2604.20144');                            // bullet meta preserved
    expect(html).toContain('<h2>Claims</h2>');                       // sections still render
    expect(html).not.toContain('<dt>');                              // single non-kv quote ≠ masthead table
  });
  it('renders the Frame lede under a YAML-frontmatter masthead', () => {
    const md = '---\npaper: "Metadata Reasoner"\narxiv: "2604.20144"\n---\n\n> Vector search is noisy; an agent reasons over metadata to pick tables precisely.\n\n## Claims\n\n- a claim';
    const html = renderDoc(md);
    expect(html).toContain('class="note-title">Metadata Reasoner'); // masthead intact
    expect(html).toContain('<blockquote>');                          // Frame lede under the masthead
    expect(html).toContain('an agent reasons over metadata');
    expect(html).toContain('<h2>Claims</h2>');
  });
  it('does not duplicate the H1 when frontmatter title matches the body title', () => {
    const md = [
      '---',
      'title: "SWE-Together"',
      'authors: ["A", "B"]',
      'source_url: "https://arxiv.org/abs/2606.29957"',
      'kind: library-read',
      '---',
      '',
      '# SWE-Together',
      '',
      '> one-line frame',
      '',
      '## Claims',
    ].join('\n');
    const html = renderDoc(md);
    expect(html.match(/SWE-Together/g)).toHaveLength(1);
    expect(html).toContain('<dt>authors</dt><dd>A, B</dd>');
    expect(html).toContain('href="https://arxiv.org/abs/2606.29957"');
    expect(html).toContain('<blockquote>');
  });
});

describe('renderWorkspaceHome', () => {
  const m: WorkspaceHomeModel = {
    root: '/ws',
    topicCounts: { total: 2, active: 1, available: 1, dormant: 1, unavailable: 1 },
    libraryCounts: { papers: 3, unread: 1, reading: 1, read: 1, failed: 0, linked: 2, integrated: 1 },
    activeTopics: [
      { slug: 'trace', path: 'trace', active: true, available: true, oneline: 'triage <x>',
        noteCount: 3, lastRun: '2026-06-20T10:00:00Z', decisionCounts: { 'deep-read': 1, skim: 2, reject: 0 } },
    ],
  };

  it('renders workspace-first entry points and summary metrics', () => {
    const html = renderWorkspaceHome(m);
    expect(html).toContain('Workspace Home');
    expect(html).toContain('/library');
    expect(html).toContain('/topics');
    expect(html).toContain('3 papers');
    expect(html).toContain('1 active');
    expect(html).toContain('trace');
    expect(html).not.toContain('href="/">Workspace</a>');
    expect(html).not.toContain('workspace-actions');
    expect(html).not.toContain('<main class="grid">');
  });
});

describe('renderTopics', () => {
  const m: DashboardModel = {
    root: '/ws',
    topics: [
      { slug: 'trace', path: 'trace', active: true, available: true, oneline: 'triage <x>',
        noteCount: 3, lastRun: '2026-06-20T10:00:00Z', decisionCounts: { 'deep-read': 1, skim: 2, reject: 0 } },
      { slug: 'decision', path: 'decision', active: false, available: false, oneline: '',
        noteCount: 0, lastRun: null, decisionCounts: { 'deep-read': 0, skim: 0, reject: 0 } },
    ],
  };
  it('lists topic paths and links to detail pages', () => {
    const html = renderTopics(m);
    expect(html).toContain('Topics');
    expect(html).toContain('/t/trace');
    expect(html).toContain('triage &lt;x&gt;');     // escaped
    expect(html).toContain('class="card-foot"');     // meta row must match the styled CSS class
    expect(html).toMatch(/dormant|inactive/i);       // dormant marker for decision
    expect(html).toMatch(/unavailable|missing/i);    // unavailable marker
  });
  it('uses the styled triage bar / legend / stats, note count, and formatted date', () => {
    const html = renderTopics(m);
    expect(html).toContain('class="triage"');        // colored intake bar
    expect(html).toContain('class="legend"');        // deep/skim/reject legend
    expect(html).toContain('class="stats"');         // note count + date row
    expect(html).toContain('3 notes');               // noteCount, not "papers"
    expect(html).toContain('2026-06-20');            // formatted date
    expect(html).not.toContain('2026-06-20T10:00:00Z'); // never the raw ISO timestamp
    expect(html).not.toContain('papers');            // dropped the misleading PDF count
  });
});

describe('renderTopic', () => {
  const v: TopicView = {
    slug: 'trace', path: 'trace', available: true, oneline: 'triage', language: 'zh',
    sources: [{ kind: 'arxiv', summary: 'agent' }],
    researchQuestions: [{ id: 'RQ1', text: 'how' }],
    docs: [{ path: '.researcher/thesis.md', label: 'Thesis' }],
    notes: [
      { path: 'notes/active/01_signals.md', num: '01', title: 'Signals: trajectory triage', zone: 'active', pin: true, score: 0.82, dwell: 2 },
      { path: 'notes/buffer/02_buffer.md', num: '02', title: 'Buffer paper', zone: 'buffer', pin: false, score: 0.41, dwell: 1 },
      { path: 'notes/history/03_history.md', num: '03', title: 'History paper', zone: 'history', pin: false, score: 0.12, dwell: 4 },
    ],
    papers: [{ id: '2401.00001', file: 'papers/2401.00001.pdf' }],
    relatedPapers: [{
      id: 'paper_arxiv_2401_12345',
      displayTitle: 'Reusable Paper Cards',
      canonicalId: 'arxiv:2401.12345',
      sourceLabel: 'arXiv',
      tags: ['agent', 'planning'],
      readStatus: 'read',
      linkedTopicCount: 1,
      integratedTopicCount: 1,
      updatedAt: '2026-07-02T00:00:00Z',
      relation: 'relevant',
    }],
    seen: [{ id: 'arxiv:1', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'x' }],
    watermark: { last_run_completed_at: '2026-06-20T10:00:00Z', last_run_window: { from: 'a', to: 'b' }, last_run_id: 'r1' },
  };
  it('renders a doc tree with doc links and a run button', () => {
    const html = renderTopic(v);
    expect(html).toContain('/t/trace/doc?path=.researcher%2Fthesis.md');
    expect(html).toContain('/t/trace/run');           // run endpoint referenced by JS
    expect(html).toContain('2401.00001');             // paper listed
    expect(html).toContain('RQ1');
    expect(html).toContain('reader.addEventListener'); // in-doc links load into the reader
    expect(html).toContain('class="note-tree"');      // numbered notes use the styled tree
    expect(html).toContain('Signals: trajectory triage'); // frontmatter-derived note title
    expect(html).toContain('Active');                 // notes are grouped by zone
    expect(html).toContain('Buffer');
    expect(html).toContain('History');
    expect(html).toContain('notes%2Factive%2F01_signals.md');
    expect(html).toContain('class="zone-badge active"');
    expect(html).toContain('class="pin-badge"');
    expect(html).toContain('class="about"');           // About uses the styled paragraph
    expect(html).toContain('class="meta-list"');        // Sources/Questions use the styled list
    expect(html).toContain('class="seen-list"');       // seen ledger is a list, not a table
    expect(html).toContain('class="seen-dec deep-read"'); // decision rendered as a colored chip
    expect(html).toContain('<h1 class="sr-only">Topic: trace</h1>');
    expect(html).toContain('Related papers');
    expect(html).toContain('paper-card compact');
    expect(html).toContain('Reusable Paper Cards');
    expect(html).toContain('tag-chip');
    expect(html).not.toContain('<table');              // no narrow 3-col table
  });
  it('shows an unavailable notice when topic has no .researcher', () => {
    const html = renderTopic({ ...v, available: false, docs: [], papers: [], seen: [], sources: [], researchQuestions: [] });
    expect(html).toMatch(/unavailable|missing/i);
  });
  it('uses an explicit empty state when there are no PDFs', () => {
    const html = renderTopic({ ...v, papers: [] });
    expect(html).toContain('No PDFs');
  });
});

describe('renderLibrary', () => {
  const library: LibraryView = {
    root: '/ws',
    topics: [{ slug: 'trace', path: 'trace', active: true, available: true }],
    papers: [{
      id: 'paper_arxiv_2401_12345',
      displayTitle: 'Reusable Paper Cards',
      canonicalId: 'arxiv:2401.12345',
      sourceLabel: 'arXiv',
      tags: ['agent', 'planning'],
      readStatus: 'read',
      linkedTopicCount: 1,
      integratedTopicCount: 1,
      updatedAt: '2026-07-02T00:00:00Z',
    }],
  };

  it('renders a prominent add paper modal trigger and shared paper cards', () => {
    const html = renderLibrary(library);
    expect(html).toContain('Library');
    expect(html).toContain('Add paper');
    expect(html).toContain('id="add-paper-modal"');
    expect(html).toContain('data-open-add-paper');
    expect(html).toContain('data-close-add-paper');
    expect(html).toContain('action="/library/add"');
    expect(html).toContain('name="input"');
    expect(html).toContain('paper-card');
    expect(html).toContain('Reusable Paper Cards');
    expect(html).toContain('tag-chip');
    expect(html).toContain('/library/p/paper_arxiv_2401_12345');
    expect(html).toContain('library-rail');
    expect(html).toContain('data-library-search');
    expect(html).toContain('data-filter="unread"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('class="empty-state library-no-results" hidden');
    expect(html).toContain('applyLibraryFilters');
    expect(html).toContain('data-search="reusable paper cards arxiv:2401.12345 arxiv read agent planning"');
    expect(html).toContain('data-status="read"');
    expect(html).toContain('data-linked="1"');
    expect(html).toContain('data-integrated="1"');
    expect(html).not.toContain('Selected paper');
    expect(html.match(/<button[^>]*data-open-add-paper/g)).toHaveLength(1);
  });

  it('renders paper detail as a first-class page with actions in the inspector', () => {
    const detail: LibraryPaperDetailView = {
      root: '/ws',
      paper: library.papers[0],
      topics: library.topics,
      reads: [{ id: 'read-1', paperId: 'paper_arxiv_2401_12345', status: 'read', artifactPath: 'read.md', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' }],
      latestReadArtifact: { path: 'read.md', markdown: '# Library Read\n\n## Findings\n\n- Useful paper.' },
      links: [{ paperId: 'paper_arxiv_2401_12345', surfaceType: 'topic', surfaceId: 'trace', relation: 'relevant', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' }],
      integrations: [{ paperId: 'paper_arxiv_2401_12345', topicId: 'trace', integratedAt: '2026-07-02T00:00:00Z', zone: 'active' }],
    };
    const html = renderLibraryPaper(detail);
    expect(html).toContain('Paper detail');
    expect(html).toContain('/library');
    expect(html).toContain('paper-card detail');
    expect(html).toContain('paper-detail-main');
    expect(html).toContain('paper-inspector');
    expect(html).toContain('action="/library/read"');
    expect(html).toContain('name="paperId"');
    expect(html).toContain('Deep read');
    expect(html).toContain('Read artifact');
    expect(html).toContain('<h1>Library Read</h1>');
    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('Relations');
    expect(html).toContain('Mini map');
    expect(html).toContain('trace');
  });

  it('renders an active reading state without overflowing raw read ids', () => {
    const detail: LibraryPaperDetailView = {
      root: '/ws',
      paper: { ...library.papers[0], readStatus: 'reading' },
      topics: library.topics,
      reads: [{ id: 'read_paper_arxiv_2401_12345', paperId: 'paper_arxiv_2401_12345', status: 'reading', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' }],
      latestReadArtifact: null,
      links: [],
      integrations: [],
    };
    const html = renderLibraryPaper(detail);
    expect(html).toContain('Reading and parsing');
    expect(html).toContain('role="status"');
    expect(html).toContain('id="library-read-heading"');
    expect(html).toContain('id="library-read-retry"');
    expect(html).toContain('disabled>Deep read</button>');
    expect(html).toContain('id="library-read-stages"');
    expect(html).toContain('Fetch source');
    expect(html).toContain('Draft read artifact');
    expect(html).toContain('Record Library state');
    expect(html).toContain("libHeading.textContent = libDone ? 'Read complete' : 'Read failed'");
    expect(html).toContain("libRetry.textContent = 'Retry'");
    expect(html).toContain("cls = 'error'");
    expect(html).toContain('class="read-item"');
    expect(html).toContain('class="read-path mono"');
  });

  it('embeds active library read task metadata for live progress', () => {
    const detail: LibraryPaperDetailView = {
      root: '/ws',
      paper: { ...library.papers[0], readStatus: 'reading' },
      topics: library.topics,
      reads: [{ id: 'read_paper_arxiv_2401_12345', paperId: 'paper_arxiv_2401_12345', status: 'reading', createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z' }],
      latestReadArtifact: null,
      links: [],
      integrations: [],
    };
    const html = renderLibraryPaper(detail, { taskId: 'task-9', startedAt: 1719000000000 });
    expect(html).toContain('data-library-task="task-9"');
    expect(html).toContain('data-started-at="1719000000000"');
    expect(html).toContain('/library/read/');
  });
});

describe('tocTitle (#45)', () => {
  it('keeps only the 《》 inner content, dropping the repetitive prefix', () => {
    expect(tocTitle('论文阅读笔记：《Signals: Trajectory Sampling and Replay》'))
      .toBe('Signals: Trajectory Sampling and Replay');
  });
  it('preserves a trailing annotation after 》', () => {
    expect(tocTitle('论文阅读笔记：《Agent-as-a-Judge》（原始 + 综述）'))
      .toBe('Agent-as-a-Judge（原始 + 综述）');
  });
  it('leaves a title without 《》 unchanged', () => {
    expect(tocTitle('Breaking the Observability Tax')).toBe('Breaking the Observability Tax');
  });
});

describe('renderTopic panel layout (#45)', () => {
  const v: TopicView = {
    slug: 'trace', path: 'trace', available: true, oneline: 'triage', language: 'zh',
    sources: [{ kind: 'arxiv', summary: 'agent' }],
    researchQuestions: [{ id: 'RQ1', text: 'how' }],
    docs: [{ path: '.researcher/thesis.md', label: 'Thesis' }],
    notes: [{ path: 'notes/active/05_obs.md', num: '05', title: '论文阅读笔记：《Breaking the Observability Tax》', zone: 'active', pin: false, score: 0.7, dwell: 1 }],
    papers: [{ id: '2401.00001', file: 'papers/2401.00001.pdf' }],
    seen: [{ id: 'arxiv:1', source: 'arxiv', first_seen_run: 'r1', decision: 'deep-read', reason: 'x' }],
    watermark: { last_run_completed_at: '2026-06-20T10:00:00Z', last_run_window: { from: 'a', to: 'b' }, last_run_id: 'r1' },
  };
  it('shows the 《》 inner title in the TOC with the full title as a hover tooltip', () => {
    const html = renderTopic(v);
    expect(html).toContain('<span class="t">Breaking the Observability Tax</span>');
    expect(html).toContain('title="论文阅读笔记：《Breaking the Observability Tax》"');
  });
  it('wires a draggable left-panel resizer driven by a CSS width variable, persisted', () => {
    const html = renderTopic(v);
    expect(html).toContain('id="col-resizer"');     // drag handle element
    expect(html).toContain('--left-w');               // left column width is a CSS variable
    expect(html).toContain('researcher:leftW');       // width persisted in localStorage
  });
  it('collapses the right panel by default with a toggle to expand, persisted', () => {
    const html = renderTopic(v);
    expect(html).toContain('id="right-toggle"');      // expand/collapse control
    expect(html).toContain('id="right-panel"');       // the collapsible aside
    expect(html).toContain('researcher:rightOpen');   // open state persisted in localStorage
    expect(html).toContain('class="three-col"');      // default: not expanded
    expect(html).not.toContain('three-col right-open'); // right panel starts collapsed
  });
});

describe('renderTopic run controls', () => {
  const baseView: TopicView = {
    slug: 'trace', path: 'trace', available: true, oneline: 'o', language: 'zh',
    sources: [], researchQuestions: [], docs: [], notes: [], papers: [], seen: [], watermark: null,
  };

  it('renders the run popover skeleton', () => {
    const html = renderTopic(baseView);
    expect(html).toContain('id="run-pop"');
    expect(html).toContain('id="run-stages"');
    expect(html).toContain('id="run-out"');
    expect(html).toContain('id="run-wrap"');
    expect(html).toContain('id="run-bar"');
    expect(html).toContain('id="run-status"');
    expect(html).toContain('id="run-elapsed"');
    expect(html).toContain('id="run-hide"');
    expect(html).not.toContain('data-active-task');
  });

  it('embeds the active run when one is passed', () => {
    const html = renderTopic(baseView, { taskId: 'task-7', startedAt: 1719000000000 });
    expect(html).toContain('data-active-task="task-7"');
    expect(html).toContain('data-started-at="1719000000000"');
  });
});
