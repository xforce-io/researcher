import { describe, it, expect } from 'vitest';
import { escapeHtml, renderDoc, renderDashboard, renderTopic } from '../../src/web/views.js';
import type { DashboardModel, TopicView } from '../../src/web/discovery.js';

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<a> & "b"')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });
});

describe('renderDoc', () => {
  it('renders markdown headings to html', () => {
    expect(renderDoc('# Hello')).toContain('<h1>Hello</h1>');
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
});

describe('renderDashboard', () => {
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
    const html = renderDashboard(m);
    expect(html).toContain('/t/trace');
    expect(html).toContain('triage &lt;x&gt;');     // escaped
    expect(html).toContain('class="card-foot"');     // meta row must match the styled CSS class
    expect(html).toMatch(/dormant|inactive/i);       // dormant marker for decision
    expect(html).toMatch(/unavailable|missing/i);    // unavailable marker
  });
  it('uses the styled triage bar / legend / stats, note count, and formatted date', () => {
    const html = renderDashboard(m);
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
    notes: [{ path: 'notes/01_signals.md', num: '01', title: 'Signals: trajectory triage' }],
    papers: [{ id: '2401.00001', file: 'papers/2401.00001.pdf' }],
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
    expect(html).toContain('class="about"');           // About uses the styled paragraph
    expect(html).toContain('class="meta-list"');        // Sources/Questions use the styled list
    expect(html).toContain('class="seen-list"');       // seen ledger is a list, not a table
    expect(html).toContain('class="seen-dec deep-read"'); // decision rendered as a colored chip
    expect(html).not.toContain('<table');              // no narrow 3-col table
  });
  it('shows an unavailable notice when topic has no .researcher', () => {
    const html = renderTopic({ ...v, available: false, docs: [], papers: [], seen: [], sources: [], researchQuestions: [] });
    expect(html).toMatch(/unavailable|missing/i);
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
