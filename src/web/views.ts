import { marked } from 'marked';
import type { DashboardModel, TopicCard, TopicView } from './discovery.js';
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
    const mast = leadingMetaParagraph(body);
    const head = noteMasthead(fm);
    if (mast) {
      const mastHtml = head ? mast.html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '') : mast.html;
      return head + mastHtml + (marked.parse(mast.rest, { async: false }) as string);
    }
    return head + (marked.parse(body, { async: false }) as string);
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

export function renderDashboard(m: DashboardModel): string {
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
  const body = `<header class="topbar"><span class="brand">researcher</span>` +
    `<span class="root">${escapeHtml(m.root)}</span></header>` +
    `<main class="grid">${cards || '<p class="empty-state">No topics in manifest.</p>'}</main>`;
  return page('researcher · workspace', body);
}

export function renderTopic(
  v: TopicView,
  activeRun: { taskId: string; startedAt: number } | null = null,
): string {
  if (!v.available) {
    const body = `<header class="topbar"><a class="brand" href="/">researcher</a>` +
      `<span class="root">${escapeHtml(v.path)}</span></header>` +
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
    `<button id="right-toggle" class="panel-toggle" type="button" aria-expanded="false" aria-controls="right-panel" title="Toggle info panel">Info</button>` +
    `${runWrap}</header>` +
    `<main class="three-col" id="cols">` +
      `<aside class="left"><h3>Docs</h3><ul class="doc-tree">${docTree}</ul>` +
        (v.notes.length ? `<h3>Notes <span class="h3-count">${v.notes.length}</span></h3>${noteGroups}` : '') +
        `<h3>Papers</h3><ul class="paper-list">${paperList || '<li class="muted">No PDFs</li>'}</ul></aside>` +
      `<div class="col-resizer" id="col-resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>` +
      `<section class="reader" id="reader"><p class="hint">Select a document.</p></section>` +
      `<aside class="right" id="right-panel"><h3>About</h3>` +
        `<p class="about">${escapeHtml(v.oneline) || '<span class="muted">no one-line set</span>'}` +
        `${v.language ? ` <span class="lang">${escapeHtml(v.language)}</span>` : ''}</p>` +
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
applyRightOpen(localStorage.getItem(RIGHT_OPEN_KEY) === '1');
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
