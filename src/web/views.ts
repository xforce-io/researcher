import { marked } from 'marked';
import type { DashboardModel, TopicCard, TopicView } from './discovery.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderDoc(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
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
  const paperList = v.papers.map((p) =>
    `<li><a href="/t/${v.slug}/paper?id=${encodeURIComponent(p.id)}" target="_blank">${escapeHtml(p.id)}</a></li>`
  ).join('');
  const sourceList = v.sources.map((s) =>
    `<li><b>${escapeHtml(s.kind)}</b>: ${escapeHtml(s.summary)}</li>`).join('');
  const rqList = v.researchQuestions.map((q) =>
    `<li><b>${escapeHtml(q.id)}</b> ${escapeHtml(q.text)}</li>`).join('');
  const seenRows = v.seen.slice(-20).reverse().map((e) =>
    `<tr><td>${escapeHtml(e.id)}</td><td>${escapeHtml(e.decision)}</td><td>${escapeHtml(e.reason)}</td></tr>`).join('');
  const wm = v.watermark
    ? `last run ${escapeHtml(v.watermark.last_run_completed_at)} (${escapeHtml(v.watermark.last_run_id)})`
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
    `${runWrap}</header>` +
    `<main class="three-col">` +
      `<aside class="left"><h3>Docs</h3><ul class="doc-tree">${docTree}</ul>` +
        `<h3>Papers</h3><ul class="paper-list">${paperList || '<li>—</li>'}</ul></aside>` +
      `<section class="reader" id="reader"><p class="hint">Select a document.</p></section>` +
      `<aside class="right"><h3>About</h3><p>${escapeHtml(v.oneline)} <i>(${escapeHtml(v.language)})</i></p>` +
        `<h3>Sources</h3><ul>${sourceList || '<li>—</li>'}</ul>` +
        `<h3>Questions</h3><ul>${rqList || '<li>—</li>'}</ul>` +
        `<h3>State</h3><p>${wm}</p>` +
        `<table class="seen"><thead><tr><th>id</th><th>decision</th><th>reason</th></tr></thead><tbody>${seenRows}</tbody></table>` +
      `</aside>` +
    `</main>` +
    `<script>${TOPIC_JS}</script>`;
  return page(`${v.path} · researcher`, body);
}

const TOPIC_JS = `
const slug = document.getElementById('run-btn')?.dataset.slug;
document.querySelectorAll('.doc-link').forEach(a => a.addEventListener('click', async (e) => {
  e.preventDefault();
  const path = a.dataset.path;
  const res = await fetch('/t/' + slug + '/doc?path=' + path);
  document.getElementById('reader').innerHTML = await res.text();
}));
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
  es.addEventListener('end', () => { es.close(); append('\\n\\u2713 run finished.\\n'); finish('done', 'ok'); });
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
`;
