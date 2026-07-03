import { marked } from 'marked';
import type { DashboardModel, LibraryPaperDetailView, LibraryPaperSummary, LibraryView, TopicCard, TopicView, WorkspaceHomeModel } from './discovery.js';
import type { Zone } from '../state/zone.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();

// TOC display title: per-paper note headings share a fixed "…笔记：《title》" shell.
// Strip the repetitive prefix and the 《》 brackets, keeping the inner title plus any
// trailing annotation (e.g. （原始 + 综述）). A heading without 《》 is returned as-is.
export function tocTitle(full: string): string {
  const m = /《([^》]*)》(.*)$/.exec(full);
  return m ? (m[1] + m[2]).trim() : full.trim();
}

// Split a leading YAML frontmatter block from the markdown body. Returns fm=null
// when there is no `---` fence so plain docs (thesis, report, H1-titled notes)
// render untouched.
function splitFrontmatter(md: string): { fm: Record<string, string> | null; body: string } {
  if (!md.startsWith('---')) return { fm: null, body: md };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { fm: null, body: md };
  const fm: Record<string, string> = {};
  for (const line of md.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: md.slice(end + 4).replace(/^\s*\n/, '') };
}

const FM_TITLE_KEYS = new Set(['paper', 'title']);
const INTERNAL_FM_KEYS = new Set(['zone', 'tags', 'pin', 'score', 'dwell']);
const WIDE_META_KEYS = new Set([
  'abstract',
  'summary',
  'notes',
  '分类轴',
  '角色定位',
  '摘要',
  '总结',
]);
type IntegratedZone = Exclude<Zone, 'pending'>;
const NOTE_ZONE_LABELS: Record<IntegratedZone, string> = {
  active: 'Active',
  buffer: 'Buffer',
  history: 'History',
};

// Format one frontmatter value: authors array → comma list, arxiv → link, else plain.
function fmValue(key: string, raw: string): string {
  if (key === 'authors') {
    let authors: string[] = [];
    try { authors = JSON.parse(raw); }
    catch { authors = raw.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean); }
    return authors.map((a) => escapeHtml(String(a))).join(', ');
  }
  if (key === 'arxiv') {
    const id = unquote(raw);
    return id ? `<a href="https://arxiv.org/abs/${encodeURIComponent(id)}" target="_blank">${escapeHtml(id)}</a>` : '';
  }
  if (key === 'url' || key.endsWith('_url')) {
    const url = unquote(raw);
    return url ? `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a>` : '';
  }
  return escapeHtml(unquote(raw));
}

function metaRowClass(key: string, value: string): string {
  const text = value.replace(/<[^>]*>/g, '').trim();
  return WIDE_META_KEYS.has(key) || text.length > 220 ? ' class="wide"' : '';
}

// A per-paper note's structured frontmatter → title + an aligned key/value table
// (the .fm CSS kit), instead of dumping the raw YAML into the body.
function noteMasthead(fm: Record<string, string>): string {
  const title = unquote(fm.paper ?? fm.title ?? '');
  const rows = Object.entries(fm)
    .filter(([k]) => !FM_TITLE_KEYS.has(k) && !INTERNAL_FM_KEYS.has(k))
    .map(([k, raw]) => [k, fmValue(k, raw)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `<div${metaRowClass(k, v)}><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`)
    .join('');
  if (!title && !rows) return '';
  return (title ? `<h1 class="note-title">${escapeHtml(title)}</h1>` : '') +
    (rows ? `<dl class="fm">${rows}</dl>` : '');
}

function stripDuplicateLeadingH1(body: string, title: string): string {
  if (!title) return body;
  const m = /^#[ \t]+([^\n]+)\n?/.exec(body);
  if (!m) return body;
  const norm = (s: string) => unquote(s).replace(/\s+/g, ' ').trim();
  return norm(m[1]) === norm(title) ? body.slice(m[0].length).replace(/^\s*\n/, '') : body;
}

// A leading `# H1` + a `> **Key:** value` blockquote (report.md / H1-titled notes)
// is really a masthead — markdown collapses the lines into one flowing paragraph.
// Lift it into the aligned .fm table instead. Returns null when the block isn't a
// clean key/value masthead, so ordinary blockquotes render normally.
function mastheadBlockquote(body: string): { html: string; rest: string } | null {
  const m = /^(#[ \t][^\n]*\n)\s*\n?((?:[ \t]*>[^\n]*(?:\n|$))+)/.exec(body);
  if (!m) return null;
  const rows: { k: string; v: string }[] = [];
  for (const line of m[2].split('\n')) {
    const content = line.trim().replace(/^>\s?/, '').trim();
    if (!content) continue;
    const km = /^\*\*\s*(.+?)\s*[:：]?\s*\*\*[:：]?\s*(.*)$/.exec(content);
    if (!km) return null; // a non key/value line → not a masthead, let marked handle it
    rows.push({ k: km[1].trim(), v: km[2].trim() });
  }
  if (rows.length < 2) return null;
  const dl = `<dl class="fm">` + rows.map((r) =>
    `<div${metaRowClass(r.k, r.v)}><dt>${escapeHtml(r.k)}</dt><dd>${marked.parseInline(r.v, { async: false })}</dd></div>`,
  ).join('') + `</dl>`;
  return { html: (marked.parse(m[1], { async: false }) as string) + dl, rest: body.slice(m[0].length) };
}

function leadingMetaParagraph(body: string): { html: string; rest: string } | null {
  const m = /^(#[ \t][^\n]*\n)\s*\n?((?:[ \t]*>[^\n]*(?:\n|$))+)/.exec(body);
  if (!m) return null;
  const quote = m[2]
    .split('\n')
    .map((line) => line.trim().replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
  const rows: { k: string; v: string }[] = [];
  const re = /\*\*\s*(.+?)\s*[:：]?\s*\*\*[:：]?\s*([\s\S]*?)(?=\s+\*\*\s*.+?\s*[:：]?\s*\*\*[:：]?|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(quote)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) continue;
    rows.push({ k: key, v: value });
  }
  if (rows.length < 2) return null;
  const dl = `<dl class="fm compact">` + rows.map((r) =>
    `<div${metaRowClass(r.k, r.v)}><dt>${escapeHtml(r.k)}</dt><dd>${marked.parseInline(r.v, { async: false })}</dd></div>`,
  ).join('') + `</dl>`;
  return { html: (marked.parse(m[1], { async: false }) as string) + dl, rest: body.slice(m[0].length) };
}

export function renderDoc(markdown: string): string {
  const { fm, body } = splitFrontmatter(markdown);
  if (fm) {
    const title = unquote(fm.paper ?? fm.title ?? '');
    const displayBody = stripDuplicateLeadingH1(body, title);
    const mast = leadingMetaParagraph(displayBody);
    const head = noteMasthead(fm);
    if (mast) {
      const mastHtml = head ? mast.html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '') : mast.html;
      return head + mastHtml + (marked.parse(mast.rest, { async: false }) as string);
    }
    return head + (marked.parse(displayBody, { async: false }) as string);
  }
  const mast = mastheadBlockquote(body);
  if (mast) return mast.html + (marked.parse(mast.rest, { async: false }) as string);
  return marked.parse(body, { async: false }) as string;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/static/app.css"></head>` +
    `<body>${body}</body></html>`;
}

function topbar(root: string, active: 'workspace' | 'library' | 'topics' | 'topic' = 'workspace'): string {
  const item = (href: string, label: string, key: typeof active) =>
    `<a class="nav-link${active === key ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<header class="topbar"><a class="brand" href="/">researcher</a>` +
    `<span class="root">${escapeHtml(root)}</span>` +
    `<nav class="topnav" aria-label="Primary">` +
      item('/library', 'Library', 'library') +
      item('/topics', 'Topics', 'topics') +
    `</nav></header>`;
}

function fmtShortDate(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : escapeHtml(iso);
}

function renderTagChips(tags: string[]): string {
  return tags.length
    ? `<span class="paper-tags">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</span>`
    : '<span class="muted">no tags</span>';
}

function renderPaperCard(p: LibraryPaperSummary, variant: 'row' | 'compact' | 'detail' = 'row'): string {
  const relation = p.relation ? `<span class="paper-relation">${escapeHtml(p.relation)}</span>` : '';
  const counts = `${p.readStatus} · ${p.linkedTopicCount} link${p.linkedTopicCount === 1 ? '' : 's'} · ${p.integratedTopicCount} integrated`;
  const searchText = [
    p.displayTitle,
    p.canonicalId,
    p.sourceLabel,
    p.readStatus,
    p.relation,
    ...p.tags,
  ].filter(Boolean).join(' ').toLowerCase();
  return `<article class="paper-card ${variant}" data-search="${escapeHtml(searchText)}" data-status="${escapeHtml(p.readStatus)}" data-linked="${p.linkedTopicCount > 0 ? '1' : '0'}" data-integrated="${p.integratedTopicCount > 0 ? '1' : '0'}">` +
    `<div class="paper-main">` +
      `<a class="paper-title-link" href="/library/p/${encodeURIComponent(p.id)}">${escapeHtml(p.displayTitle)}</a>` +
      `<div class="paper-id mono">${escapeHtml(p.canonicalId)}</div>` +
    `</div>` +
    `<span class="source-badge">${escapeHtml(p.sourceLabel)}</span>` +
    `<div class="paper-tag-cell">${renderTagChips(p.tags)}</div>` +
    `<div class="paper-state">${escapeHtml(counts)}${relation}</div>` +
    `<div class="paper-updated">${fmtShortDate(p.updatedAt)}</div>` +
  `</article>`;
}

export function renderLibrary(v: LibraryView): string {
  const topicOptions = v.topics
    .map((t) => `<option value="${escapeHtml(t.path)}">${escapeHtml(t.path)}</option>`)
    .join('');
  const papers = v.papers.map((p) => renderPaperCard(p)).join('');
  const addPaperModal = `<div id="add-paper-modal" class="modal-backdrop" hidden>` +
    `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-paper-title">` +
      `<div class="modal-head"><h2 id="add-paper-title">Add paper</h2>` +
      `<button class="icon-button" type="button" data-close-add-paper aria-label="Close">x</button></div>` +
      `<form class="add-paper-form" action="/library/add" method="post">` +
        `<label>Paper source<input name="input" required placeholder="arXiv id, arXiv URL, or http(s) URL"></label>` +
        `<label>Tags<input name="tags" placeholder="survey, benchmark"></label>` +
        `<label>Topic context<select name="topic"><option value="">none</option>${topicOptions}</select></label>` +
        `<button class="primary" type="submit">Add paper</button>` +
      `</form>` +
    `</div>` +
  `</div>`;
  const body = topbar(v.root, 'library') +
    `<main class="library-shell no-selection">` +
      `<aside class="library-rail">` +
        `<div class="library-rail-head"><h2>Papers</h2><span>${v.papers.length}</span></div>` +
        `<label class="library-search">Search<input type="search" placeholder="Title, tag, source" data-library-search></label>` +
        `<div class="library-filters" role="group" aria-label="Library filters">` +
          `<button class="active" type="button" data-filter="all" aria-pressed="true">All</button>` +
          `<button type="button" data-filter="unread" aria-pressed="false">Unread</button>` +
          `<button type="button" data-filter="read" aria-pressed="false">Read</button>` +
          `<button type="button" data-filter="linked" aria-pressed="false">Linked</button>` +
          `<button type="button" data-filter="integrated" aria-pressed="false">Integrated</button>` +
        `</div>` +
      `</aside>` +
      `<section class="library-main">` +
        `<div class="library-head"><div><h1>Library</h1><p>Workspace papers, reads, tags, and topic relations.</p></div>` +
        `<button class="primary" type="button" data-open-add-paper>Add paper</button></div>` +
        `<div class="paper-list-grid">` +
          `<div class="paper-card paper-header"><span>Paper</span><span>Source</span><span>Tags</span><span>State</span><span>Updated</span></div>` +
          `${papers || '<p class="empty-state">No papers yet.</p>'}` +
          `<p class="empty-state library-no-results" hidden>No papers match the current filters.</p>` +
        `</div>` +
      `</section>` +
    `</main>${addPaperModal}<script>${LIBRARY_JS}</script>`;
  return page('Library · researcher', body);
}

function renderPaperDetailPanel(v: LibraryPaperDetailView): string {
  const linkedTopicIds = new Set(v.links.filter((l) => l.surfaceType === 'topic').map((l) => l.surfaceId));
  const preferredTopic = linkedTopicIds.size === 1 ? [...linkedTopicIds][0] : undefined;
  const topicOptions = v.topics
    .filter((t) => t.available)
    .map((t) => {
      const selected = t.path === preferredTopic ? ' selected' : '';
      const linked = linkedTopicIds.has(t.path) ? ' · linked' : '';
      return `<option value="${escapeHtml(t.path)}"${selected}>${escapeHtml(t.path)}${linked}</option>`;
    })
    .join('');
  const contextOptions = `<option value="">none</option>${topicOptions}`;
  const reads = renderReads(v.reads);
  const links = v.links.map((l) =>
    `<li><b>${escapeHtml(l.surfaceId)}</b> <span class="paper-relation">${escapeHtml(l.relation)}</span></li>`
  ).join('');
  const integrations = v.integrations.map((i) =>
    `<li><b>${escapeHtml(i.topicId)}</b> ${i.zone ? `<span class="source-badge">${escapeHtml(i.zone)}</span>` : ''} ` +
    `<span class="mono">${escapeHtml(i.notePath ?? i.integratedAt)}</span></li>`
  ).join('');
  const firstLink = v.links.find((l) => l.surfaceType === 'topic');
  const miniMap = firstLink
    ? `<div class="mini-map"><div class="mini-node"><b>Paper</b><span>${escapeHtml(v.paper.readStatus)}</span></div>` +
      `<div class="mini-edge"></div><div class="mini-node"><b>Topic</b><span>${escapeHtml(firstLink.surfaceId)} · ${escapeHtml(firstLink.relation)}</span></div></div>`
    : '<p class="muted">No topic relation yet.</p>';
  return `<section class="selected-paper">` +
    `<div class="selected-paper-head"><h2>Selected paper</h2>${renderStatusBadge(v.paper.readStatus)}</div>` +
    `${renderPaperCard(v.paper, 'detail')}` +
    `${renderDeepReadAction(v.paper.id, v.paper.readStatus, contextOptions)}` +
    `<div class="detail-grid inline">` +
      `<div class="detail-panel"><h2>Reads</h2><ul class="meta-list">${reads || '<li>—</li>'}</ul></div>` +
      `<div class="detail-panel"><h2>Relations</h2><ul class="meta-list">${links || '<li>—</li>'}</ul></div>` +
      `<div class="detail-panel"><h2>Integrations</h2><ul class="meta-list">${integrations || '<li>—</li>'}</ul></div>` +
      `<div class="detail-panel"><h2>Mini map</h2>${miniMap}</div>` +
    `</div>` +
  `</section>`;
}

interface ActiveTaskView {
  taskId: string;
  startedAt: number;
}

const LIBRARY_READ_STAGE_LABELS: Record<string, string> = {
  'fetch-source': 'Fetch source',
  'draft-read': 'Draft read artifact',
  'record-read': 'Record Library state',
};

function renderDeepReadAction(
  paperId: string,
  status: LibraryPaperSummary['readStatus'],
  contextOptions: string,
  activeRead: ActiveTaskView | null = null,
): string {
  if (status === 'reading') {
    const attrs = activeRead
      ? ` data-library-task="${escapeHtml(activeRead.taskId)}" data-started-at="${activeRead.startedAt}"`
      : '';
    const stages = Object.entries(LIBRARY_READ_STAGE_LABELS).map(([name, label], i) =>
      `<li class="${i === 0 ? 'active' : 'pending'}" data-stage="${escapeHtml(name)}"><span class="mk">${i === 0 ? '↻' : '·'}</span>${escapeHtml(label)}</li>`
    ).join('');
    return `<div class="read-status-panel" role="status" aria-live="polite">` +
      `<div class="read-status-copy"><span class="pulse-dot"></span><div><b>Reading and parsing</b>` +
      `<p id="library-read-status"${attrs}>Extracting paper text and drafting a Library read artifact.</p></div></div>` +
      `<button class="primary" type="button" disabled>Deep read</button>` +
      `<ol id="library-read-stages" class="run-stages library-read-stages">${stages}</ol>` +
      `<pre id="library-read-log" class="library-read-log"></pre>` +
    `</div>`;
  }
  return `<form class="deep-read-form" action="/library/read" method="post">` +
    `<input type="hidden" name="paperId" value="${escapeHtml(paperId)}">` +
    `<label>Context<select name="topic">${contextOptions}</select></label>` +
    `<button class="primary" type="submit">Deep read</button>` +
  `</form>`;
}

function renderReads(reads: LibraryPaperDetailView['reads']): string {
  return reads.map((r) => {
    const path = r.artifactPath ?? r.id;
    const label = r.artifactPath ? basename(path) : r.id;
    return `<li class="read-item">${renderStatusBadge(r.status)}` +
      `<span class="read-path mono" title="${escapeHtml(path)}">${escapeHtml(label)}</span></li>`;
  }).join('');
}

function renderStatusBadge(status: LibraryPaperSummary['readStatus']): string {
  return `<span class="status-badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export function renderLibraryPaper(v: LibraryPaperDetailView, activeRead: ActiveTaskView | null = null): string {
  const readSurface = v.latestReadArtifact
    ? `<section class="reader read-surface"><div class="read-artifact-head"><h2>Read artifact</h2><span class="mono">${escapeHtml(v.latestReadArtifact.path)}</span></div>${renderDoc(v.latestReadArtifact.markdown)}</section>`
    : `<section class="detail-panel read-surface"><h2>Reads</h2><ul class="meta-list">${renderReads(v.reads) || '<li>—</li>'}</ul></section>`;
  const body = topbar(v.paper.id, 'library') +
    `<main class="paper-detail-shell">` +
      `<section class="paper-detail-main">` +
        `<a class="back-link" href="/library">Library</a>` +
        `<div class="library-head"><div><h1>Paper detail</h1><p>${escapeHtml(v.paper.displayTitle)}</p></div>${renderStatusBadge(v.paper.readStatus)}</div>` +
        `${renderPaperCard(v.paper, 'detail')}` +
        readSurface +
      `</section>` +
      `<aside class="paper-inspector">${renderPaperInspector(v, activeRead)}</aside>` +
    `</main>${v.paper.readStatus === 'reading' ? `<script>${LIBRARY_READ_JS}</script>` : ''}`;
  return page(`${v.paper.displayTitle} · researcher`, body);
}

function renderPaperInspector(v: LibraryPaperDetailView, activeRead: ActiveTaskView | null = null): string {
  const linkedTopicIds = new Set(v.links.filter((l) => l.surfaceType === 'topic').map((l) => l.surfaceId));
  const preferredTopic = linkedTopicIds.size === 1 ? [...linkedTopicIds][0] : undefined;
  const topicOptions = v.topics
    .filter((t) => t.available)
    .map((t) => {
      const selected = t.path === preferredTopic ? ' selected' : '';
      const linked = linkedTopicIds.has(t.path) ? ' · linked' : '';
      return `<option value="${escapeHtml(t.path)}"${selected}>${escapeHtml(t.path)}${linked}</option>`;
    })
    .join('');
  const links = v.links.map((l) =>
    `<li><b>${escapeHtml(l.surfaceId)}</b> <span class="paper-relation">${escapeHtml(l.relation)}</span></li>`
  ).join('');
  const integrations = v.integrations.map((i) =>
    `<li><b>${escapeHtml(i.topicId)}</b> ${i.zone ? `<span class="source-badge">${escapeHtml(i.zone)}</span>` : ''} ` +
    `<span class="mono">${escapeHtml(i.notePath ?? i.integratedAt)}</span></li>`
  ).join('');
  const firstLink = v.links.find((l) => l.surfaceType === 'topic');
  const miniMap = firstLink
    ? `<div class="mini-map"><div class="mini-node"><b>Paper</b><span>${escapeHtml(v.paper.readStatus)}</span></div>` +
      `<div class="mini-edge"></div><div class="mini-node"><b>Topic</b><span>${escapeHtml(firstLink.surfaceId)} · ${escapeHtml(firstLink.relation)}</span></div></div>`
    : '<p class="muted">No topic relation yet.</p>';
  return `<section class="detail-panel"><h2>Actions</h2>${renderDeepReadAction(v.paper.id, v.paper.readStatus, `<option value="">none</option>${topicOptions}`, activeRead)}</section>` +
    `<section class="detail-panel"><h2>Relations</h2><ul class="meta-list">${links || '<li>—</li>'}</ul></section>` +
    `<section class="detail-panel"><h2>Integrations</h2><ul class="meta-list">${integrations || '<li>—</li>'}</ul></section>` +
    `<section class="detail-panel"><h2>Mini map</h2>${miniMap}</section>`;
}

const LIBRARY_READ_JS = `
const libStatus = document.getElementById('library-read-status');
const libStages = document.getElementById('library-read-stages');
const libLog = document.getElementById('library-read-log');
const libStageLabels = ${JSON.stringify(LIBRARY_READ_STAGE_LABELS)};
let libPlan = Object.keys(libStageLabels), libCurrent = libPlan[0], libDone = false;

function renderLibraryStages() {
  if (!libStages) return;
  const currentIndex = libCurrent ? libPlan.indexOf(libCurrent) : -1;
  libStages.innerHTML = libPlan.map((name, i) => {
    let cls = 'pending', mk = '\\u00b7';
    if (libDone || (currentIndex >= 0 && i < currentIndex)) { cls = 'done'; mk = '\\u2713'; }
    else if (i === currentIndex) { cls = 'active'; mk = '\\u27f3'; }
    return '<li class="' + cls + '" data-stage="' + name + '"><span class="mk">' + mk + '</span>' + (libStageLabels[name] || name) + '</li>';
  }).join('');
}

function appendLibraryLog(line) {
  if (!libLog) return;
  libLog.textContent += line + '\\n';
  libLog.scrollTop = libLog.scrollHeight;
}

if (libStatus && libStatus.dataset.libraryTask) {
  renderLibraryStages();
  const es = new EventSource('/library/read/' + encodeURIComponent(libStatus.dataset.libraryTask) + '/stream');
  es.addEventListener('plan', (ev) => { libPlan = JSON.parse(ev.data).stages; renderLibraryStages(); });
  es.addEventListener('stage', (ev) => {
    libCurrent = JSON.parse(ev.data).name;
    if (libStatus) libStatus.textContent = 'Current stage: ' + (libStageLabels[libCurrent] || libCurrent) + '.';
    renderLibraryStages();
  });
  es.addEventListener('line', (ev) => appendLibraryLog(JSON.parse(ev.data)));
  es.addEventListener('end', (ev) => {
    es.close();
    let data = {};
    try { data = JSON.parse(ev.data || '{}'); } catch {}
    libDone = data.status === 'done' || data.exitCode === 0;
    if (libStatus) libStatus.textContent = libDone ? 'Read artifact recorded. Refreshing to show the completed read.' : 'Read failed. Check the log below.';
    renderLibraryStages();
    if (libDone) window.setTimeout(() => window.location.reload(), 900);
  });
  es.onerror = () => appendLibraryLog('progress connection closed');
} else {
  renderLibraryStages();
  appendLibraryLog('Live stage stream is unavailable for this restored reading state.');
}
`;

const LIBRARY_JS = `
const addPaperModal = document.getElementById('add-paper-modal');
const openAddPaper = document.querySelector('[data-open-add-paper]');
const closeAddPaper = document.querySelector('[data-close-add-paper]');
const librarySearch = document.querySelector('[data-library-search]');
const libraryFilterButtons = Array.from(document.querySelectorAll('[data-filter]'));
const libraryCards = Array.from(document.querySelectorAll('.paper-card.row'));
const libraryNoResults = document.querySelector('.library-no-results');
let activeLibraryFilter = 'all';

function cardMatchesFilter(card) {
  if (activeLibraryFilter === 'all') return true;
  if (activeLibraryFilter === 'linked') return card.dataset.linked === '1';
  if (activeLibraryFilter === 'integrated') return card.dataset.integrated === '1';
  return card.dataset.status === activeLibraryFilter;
}

function applyLibraryFilters() {
  const query = (librarySearch?.value || '').trim().toLowerCase();
  let visible = 0;
  libraryCards.forEach((card) => {
    const matchesSearch = !query || (card.dataset.search || '').includes(query);
    const show = matchesSearch && cardMatchesFilter(card);
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (libraryNoResults) libraryNoResults.hidden = visible > 0 || libraryCards.length === 0;
}

librarySearch?.addEventListener('input', applyLibraryFilters);
libraryFilterButtons.forEach((button) => button.addEventListener('click', () => {
  activeLibraryFilter = button.dataset.filter || 'all';
  libraryFilterButtons.forEach((b) => {
    const active = b === button;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  applyLibraryFilters();
}));
applyLibraryFilters();

function showAddPaper() {
  if (!addPaperModal) return;
  addPaperModal.hidden = false;
  addPaperModal.querySelector('input[name="input"]')?.focus();
}
function hideAddPaper() {
  if (!addPaperModal) return;
  addPaperModal.hidden = true;
  openAddPaper?.focus();
}
openAddPaper?.addEventListener('click', showAddPaper);
closeAddPaper?.addEventListener('click', hideAddPaper);
addPaperModal?.addEventListener('click', (e) => {
  if (e.target === addPaperModal) hideAddPaper();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && addPaperModal && !addPaperModal.hidden) hideAddPaper();
});
`;

// ISO 8601 → YYYY-MM-DD; never expose the raw timestamp in the UI.
function fmtDate(iso: string | null): string {
  if (!iso) return 'never run';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : escapeHtml(iso);
}

// Triage intake bar + legend, built from the committed seen-ledger counts.
function triageBar(c: TopicCard['decisionCounts']): string {
  const total = c['deep-read'] + c.skim + c.reject;
  if (total === 0) return '';
  const segs = ([['deep', c['deep-read']], ['skim', c.skim], ['reject', c.reject]] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="seg ${k}" style="flex:${n}"></span>`)
    .join('');
  return `<div class="triage">${segs}</div>` +
    `<div class="legend">` +
      `<span class="lg deep">${c['deep-read']}</span>` +
      `<span class="lg skim">${c.skim}</span>` +
      `<span class="lg reject">${c.reject}</span>` +
      `<span class="lg-key">deep / skim / reject</span>` +
    `</div>`;
}

export function renderWorkspaceHome(m: WorkspaceHomeModel): string {
  const topicPreview = m.activeTopics.map((t) =>
    `<li><a href="/t/${t.slug}">${escapeHtml(t.path)}</a><span>${t.noteCount} notes · ${fmtDate(t.lastRun)}</span></li>`
  ).join('');
  const body = topbar(m.root, 'workspace') +
    `<main class="workspace-home">` +
      `<section class="workspace-hero"><h1>Workspace Home</h1><p>Research topics, paper intake, and reading state for this workspace.</p></section>` +
      `<section class="metric-grid">` +
        `<div class="metric"><b>${m.topicCounts.active}</b><span>${m.topicCounts.active} active topics</span></div>` +
        `<div class="metric"><b>${m.topicCounts.available}</b><span>${m.topicCounts.available} available topics</span></div>` +
        `<div class="metric"><b>${m.libraryCounts.papers}</b><span>papers</span></div>` +
        `<div class="metric"><b>${m.libraryCounts.reading}</b><span>reading</span></div>` +
      `</section>` +
      `<section class="home-columns">` +
        `<div><h2>Active Topics</h2><ul class="home-list">${topicPreview || '<li class="muted">No active topics.</li>'}</ul><a href="/topics">View all topics</a></div>` +
        `<div><h2>Library</h2><p>${m.libraryCounts.papers} papers · ${m.libraryCounts.unread} unread · ${m.libraryCounts.read} read · ${m.libraryCounts.linked} linked · ${m.libraryCounts.integrated} integrated</p><a href="/library">Open library</a></div>` +
      `</section>` +
    `</main>`;
  return page('Workspace Home · researcher', body);
}

export function renderTopics(m: DashboardModel): string {
  const cards = m.topics.map((t) => {
    const tags: string[] = [];
    if (!t.active) tags.push('<span class="tag dormant">dormant</span>');
    if (!t.available) tags.push('<span class="tag missing">unavailable</span>');
    const title = t.available
      ? `<a class="card-title" href="/t/${t.slug}">` +
        `${t.active ? '<span class="dot"></span>' : ''}${escapeHtml(t.path)}</a>`
      : `<span class="card-title">${escapeHtml(t.path)}</span>`;
    const oneline = t.available
      ? `<p class="card-oneline">${escapeHtml(t.oneline) || '<span class="muted">no one-line set</span>'}</p>`
      : `<p class="card-oneline muted">submodule missing or not a researcher topic</p>`;
    const foot = t.available
      ? `<div class="card-foot">` +
          `<div class="stats">${t.noteCount} ${t.noteCount === 1 ? 'note' : 'notes'} · ${fmtDate(t.lastRun)}</div>` +
          triageBar(t.decisionCounts) +
        `</div>`
      : '';
    return `<div class="card${t.available ? '' : ' card-disabled'}">` +
      `<div class="card-head">${title} ${tags.join(' ')}</div>` +
      `${oneline}${foot}</div>`;
  }).join('');
  const body = topbar(m.root, 'topics') +
    `<main class="topics-page"><div class="page-head"><h1>Topics</h1><p>Topic workspaces declared by this super-repo.</p></div>` +
    `<div class="grid">${cards || '<p class="empty-state">No topics in manifest.</p>'}</div></main>`;
  return page('Topics · researcher', body);
}

export const renderDashboard = renderTopics;

export function renderTopic(
  v: TopicView,
  activeRun: { taskId: string; startedAt: number } | null = null,
): string {
  if (!v.available) {
    const body = `<header class="topbar"><a class="brand" href="/">researcher</a>` +
      `<span class="root">${escapeHtml(v.path)}</span><h1 class="sr-only">Topic: ${escapeHtml(v.path)}</h1></header>` +
      `<main class="notice">Topic unavailable — submodule missing or no .researcher/.</main>`;
    return page(`${v.path} · unavailable`, body);
  }
  const docTree = v.docs.map((d) =>
    `<li><a href="/t/${v.slug}/doc?path=${encodeURIComponent(d.path)}" class="doc-link" data-path="${encodeURIComponent(d.path)}">${escapeHtml(d.label)}</a></li>`
  ).join('');
  const noteGroups = (Object.keys(NOTE_ZONE_LABELS) as IntegratedZone[]).map((zone) => {
    const notes = v.notes.filter((n) => n.zone === zone);
    if (!notes.length) return '';
    const items = notes.map((n) => {
      const meta = `${n.zone}${n.pin ? ' · pinned' : ''} · score ${n.score.toFixed(2)} · dwell ${n.dwell}`;
      return `<li><a href="/t/${v.slug}/doc?path=${encodeURIComponent(n.path)}" class="doc-link" data-path="${encodeURIComponent(n.path)}" title="${escapeHtml(n.title)}">` +
        `<span class="num">${escapeHtml(n.num)}</span><span class="t">${escapeHtml(tocTitle(n.title))}</span>` +
        `<span class="note-meta" title="${escapeHtml(meta)}">` +
          `<span class="zone-badge ${zone}">${escapeHtml(zone)}</span>` +
          `${n.pin ? '<span class="pin-badge" title="Pinned">pin</span>' : ''}` +
        `</span></a></li>`;
    }).join('');
    return `<div class="note-zone"><div class="note-zone-head">` +
      `<span>${NOTE_ZONE_LABELS[zone]}</span><span class="h3-count">${notes.length}</span>` +
      `</div><ol class="note-tree">${items}</ol></div>`;
  }).join('');
  const paperList = v.papers.map((p) =>
    `<li><a href="/t/${v.slug}/paper?id=${encodeURIComponent(p.id)}" target="_blank">${escapeHtml(p.id)}</a></li>`
  ).join('');
  const sourceList = v.sources.map((s) =>
    `<li><b>${escapeHtml(s.kind)}</b>: ${escapeHtml(s.summary)}</li>`).join('');
  const rqList = v.researchQuestions.map((q) =>
    `<li><b>${escapeHtml(q.id)}</b> ${escapeHtml(q.text)}</li>`).join('');
  const seenRows = v.seen.slice(-20).reverse().map((e) =>
    `<li class="seen-item">` +
      `<div class="seen-head">` +
        `<span class="seen-id mono">${escapeHtml(e.id)}</span>` +
        `<span class="seen-dec ${escapeHtml(e.decision)}">${escapeHtml(e.decision)}</span>` +
      `</div>` +
      `<p class="seen-reason">${escapeHtml(e.reason)}</p>` +
    `</li>`).join('');
  const wm = v.watermark
    ? `last run ${fmtDate(v.watermark.last_run_completed_at)} · <span class="mono">${escapeHtml(v.watermark.last_run_id)}</span>`
    : 'never run';
  const related = v.relatedPapers ?? [];
  const relatedRows = related.map((p) => renderPaperCard(p, 'compact')).join('');

  const runAttrs = activeRun
    ? ` data-active-task="${escapeHtml(activeRun.taskId)}" data-started-at="${activeRun.startedAt}"`
    : '';
  const runWrap =
    `<div class="run-wrap" id="run-wrap">` +
    `<button id="run-btn" data-slug="${v.slug}" data-run="/t/${v.slug}/run" aria-expanded="false"${runAttrs}>Run</button>` +
    `<div id="run-pop" class="run-pop" hidden>` +
      `<div id="run-bar" class="run-bar">` +
        `<span id="run-status" class="run-status">idle</span>` +
        `<span id="run-elapsed" class="run-elapsed mono"></span>` +
        `<button id="run-hide" class="run-hide" type="button">hide</button>` +
      `</div>` +
      `<ol id="run-stages" class="run-stages"></ol>` +
      `<pre id="run-out"></pre>` +
    `</div></div>`;

  const body =
    `<header class="topbar"><a class="brand" href="/">researcher</a>` +
    `<span class="root">${escapeHtml(v.path)}</span>` +
    `<h1 class="sr-only">Topic: ${escapeHtml(v.path)}</h1>` +
    `<button id="right-toggle" class="panel-toggle" type="button" aria-expanded="false" aria-controls="right-panel" title="Toggle info panel">Info</button>` +
    `${runWrap}</header>` +
    `<main class="three-col${related.length ? ' right-open' : ''}" id="cols" data-default-right-open="${related.length ? '1' : '0'}">` +
      `<aside class="left"><h3>Docs</h3><ul class="doc-tree">${docTree}</ul>` +
        (v.notes.length ? `<h3>Notes <span class="h3-count">${v.notes.length}</span></h3>${noteGroups}` : '') +
        `<h3>Papers</h3><ul class="paper-list">${paperList || '<li class="muted">No PDFs</li>'}</ul></aside>` +
      `<div class="col-resizer" id="col-resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>` +
      `<section class="reader" id="reader"><p class="hint">Select a document.</p></section>` +
      `<aside class="right" id="right-panel"><h3>About</h3>` +
        `<p class="about">${escapeHtml(v.oneline) || '<span class="muted">no one-line set</span>'}` +
        `${v.language ? ` <span class="lang">${escapeHtml(v.language)}</span>` : ''}</p>` +
        (related.length ? `<h3>Related papers <span class="h3-count">${related.length}</span></h3><div class="related-papers">${relatedRows}</div>` : '') +
        `<h3>Sources</h3><ul class="meta-list">${sourceList || '<li>—</li>'}</ul>` +
        `<h3>Questions</h3><ul class="meta-list">${rqList || '<li>—</li>'}</ul>` +
        `<h3>State</h3><p class="state">${wm}</p>` +
        `<h3>Seen <span class="h3-count">${v.seen.length}</span></h3>` +
        `<ul class="seen-list">${seenRows || '<li class="muted">—</li>'}</ul>` +
      `</aside>` +
    `</main>` +
    `<script>${TOPIC_JS}</script>`;
  return page(`${v.path} · researcher`, body);
}

const TOPIC_JS = `
const slug = document.getElementById('run-btn')?.dataset.slug;
const reader = document.getElementById('reader');
async function loadDoc(path) {
  const res = await fetch('/t/' + slug + '/doc?path=' + encodeURIComponent(path));
  if (res.ok) { reader.innerHTML = await res.text(); reader.scrollTop = 0; }
}
document.querySelectorAll('.doc-link').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  loadDoc(decodeURIComponent(a.dataset.path));
}));
// Relative links inside a rendered doc (e.g. report.md's Papers/Thesis links)
// are in-workspace paths — load them into the reader instead of letting the
// browser navigate to a non-existent route. External/scheme/anchor links pass through.
reader.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || !reader.contains(a)) return;
  const href = a.getAttribute('href') || '';
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return;
  e.preventDefault();
  const path = href.split('#')[0];
  if (/\\.pdf$/i.test(path)) {
    window.open('/t/' + slug + '/paper?id=' + encodeURIComponent(path.replace(/^.*\\//, '').replace(/\\.pdf$/i, '')), '_blank');
    return;
  }
  loadDoc(path);
});
const runBtn = document.getElementById('run-btn');
const pop = document.getElementById('run-pop');
const out = document.getElementById('run-out');
const stagesEl = document.getElementById('run-stages');
const statusEl = document.getElementById('run-status');
const elapsedEl = document.getElementById('run-elapsed');
const wrap = document.getElementById('run-wrap');

let running = false, plan = null, current = null, timer = null, finished = false;

function fmtElapsed(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return m ? m + 'm' + String(ss).padStart(2, '0') + 's' : ss + 's';
}
function setBtnLabel() {
  if (!running) { runBtn.textContent = 'Run'; return; }
  const i = (plan && current) ? plan.indexOf(current) : -1;
  runBtn.textContent = i >= 0
    ? '\\u27f3 ' + current + ' (' + (i + 1) + '/' + plan.length + ')'
    : '\\u27f3 ' + (current || 'starting');
}
function renderStages() {
  if (!plan) { stagesEl.innerHTML = ''; return; }
  const ci = current ? plan.indexOf(current) : -1;
  stagesEl.innerHTML = plan.map((name, i) => {
    let cls = 'pending', mk = '\\u00b7';
    if (finished || (ci >= 0 && i < ci)) { cls = 'done'; mk = '\\u2713'; }
    else if (i === ci) { cls = 'active'; mk = '\\u27f3'; }
    return '<li class="' + cls + '"><span class="mk">' + mk + '</span>' + name + '</li>';
  }).join('');
}
const append = (t) => { out.textContent += t; out.scrollTop = out.scrollHeight; };
function openPop() { pop.hidden = false; runBtn.setAttribute('aria-expanded', 'true'); }
function closePop() { pop.hidden = true; runBtn.setAttribute('aria-expanded', 'false'); }

function startTimer(t0) {
  const tick = () => { elapsedEl.textContent = fmtElapsed(Math.floor((Date.now() - t0) / 1000)); };
  tick();
  timer = setInterval(tick, 1000);
}
function finish(label, cls) {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  finished = (cls === 'ok');
  statusEl.textContent = label; statusEl.className = 'run-status ' + cls;
  renderStages(); setBtnLabel();
  runBtn.classList.remove('is-running');
}

function subscribe(taskId, t0) {
  running = true;
  runBtn.classList.add('is-running');
  statusEl.textContent = 'running'; statusEl.className = 'run-status running';
  startTimer(t0); setBtnLabel();
  const es = new EventSource('/t/' + slug + '/run/' + taskId + '/stream');
  es.addEventListener('plan', (ev) => { plan = JSON.parse(ev.data).stages; renderStages(); setBtnLabel(); });
  es.addEventListener('stage', (ev) => { current = JSON.parse(ev.data).name; renderStages(); setBtnLabel(); });
  es.addEventListener('line', (ev) => append(JSON.parse(ev.data) + '\\n'));
  es.addEventListener('end', (ev) => {
    es.close();
    let data = {};
    try { data = JSON.parse(ev.data || '{}'); } catch {}
    if (data.status === 'done' || data.exitCode === 0) {
      append('\\n\\u2713 run finished.\\n');
      finish('done', 'ok');
    } else {
      append('\\n\\u2717 run failed' + (data.exitCode == null ? '' : ' (exit ' + data.exitCode + ')') + '.\\n');
      finish('error', 'err');
    }
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { append('\\n\\u2717 connection closed.\\n'); finish('disconnected', 'err'); } };
}

async function startRun() {
  out.textContent = ''; plan = null; current = null; stagesEl.innerHTML = ''; finished = false;
  openPop();
  running = true; runBtn.classList.add('is-running');
  statusEl.textContent = 'starting'; statusEl.className = 'run-status running';
  setBtnLabel();
  try {
    const res = await fetch('/t/' + slug + '/run', { method: 'POST' });
    if (res.status === 409) { append('A run is already in progress for this topic.\\n'); finish('busy', 'err'); return; }
    if (!res.ok) { append('Could not start run (HTTP ' + res.status + ').\\n'); finish('failed', 'err'); return; }
    const { taskId } = await res.json();
    append('\\u25b6 run started — stages call the model and can be quiet for minutes.\\n   Safe to leave this open; the elapsed clock shows it is still alive.\\n\\n');
    subscribe(taskId, Date.now());
  } catch (err) {
    append('\\n\\u2717 ' + (err && err.message ? err.message : err) + '\\n');
    finish('error', 'err');
  }
}

if (runBtn) runBtn.addEventListener('click', () => {
  if (running) { pop.hidden ? openPop() : closePop(); return; }
  startRun();
});
document.getElementById('run-hide')?.addEventListener('click', closePop);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) closePop(); });
document.addEventListener('click', (e) => {
  if (pop && !pop.hidden && wrap && !wrap.contains(e.target)) closePop();
});

// Reconnect to an in-flight run after a page refresh — same subscribe path, popover stays collapsed.
if (runBtn && runBtn.dataset.activeTask) {
  append('\\u00b7 reconnected to a run in progress.\\n\\n');
  subscribe(runBtn.dataset.activeTask, Number(runBtn.dataset.startedAt));
}

// --- panel layout (#45): draggable left rail + collapsible right rail, both persisted ---
const cols = document.getElementById('cols');
const resizer = document.getElementById('col-resizer');
const rightToggle = document.getElementById('right-toggle');
const LEFT_W_KEY = 'researcher:leftW';
const RIGHT_OPEN_KEY = 'researcher:rightOpen';

const savedW = localStorage.getItem(LEFT_W_KEY);
if (cols && savedW) cols.style.setProperty('--left-w', savedW + 'px');

function applyRightOpen(open) {
  if (cols) cols.classList.toggle('right-open', open);
  if (rightToggle) rightToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
const savedRightOpen = localStorage.getItem(RIGHT_OPEN_KEY);
applyRightOpen(savedRightOpen === null ? cols?.dataset.defaultRightOpen === '1' : savedRightOpen === '1');
if (rightToggle) rightToggle.addEventListener('click', () => {
  const open = !(cols && cols.classList.contains('right-open'));
  applyRightOpen(open);
  localStorage.setItem(RIGHT_OPEN_KEY, open ? '1' : '0');
});

if (resizer && cols) {
  const MIN = 160, MAX = 560;
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const w = Math.max(MIN, Math.min(MAX, e.clientX - cols.getBoundingClientRect().left));
    cols.style.setProperty('--left-w', w + 'px');
  };
  resizer.addEventListener('mousedown', (e) => {
    dragging = true; resizer.classList.add('dragging');
    document.body.style.userSelect = 'none'; e.preventDefault();
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    const w = cols.style.getPropertyValue('--left-w').replace('px', '').trim();
    if (w) localStorage.setItem(LEFT_W_KEY, w);
  });
}
`;
