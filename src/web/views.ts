import { marked } from 'marked';
import type { DashboardModel, TopicView } from './discovery.js';

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

export function renderDashboard(m: DashboardModel): string {
  const cards = m.topics.map((t) => {
    const tags: string[] = [];
    if (!t.active) tags.push('<span class="tag dormant">dormant</span>');
    if (!t.available) tags.push('<span class="tag missing">unavailable</span>');
    const meta = t.available
      ? `<div class="card-meta">${t.paperCount} papers · last run ${t.lastRun ? escapeHtml(t.lastRun) : '—'} ` +
        `· ${t.decisionCounts['deep-read']}/${t.decisionCounts.skim}/${t.decisionCounts.reject} (deep/skim/reject)</div>`
      : `<div class="card-meta">submodule missing or not a researcher topic</div>`;
    const head = t.available
      ? `<a class="card-title" href="/t/${t.slug}">${escapeHtml(t.path)}</a>`
      : `<span class="card-title">${escapeHtml(t.path)}</span>`;
    return `<div class="card${t.available ? '' : ' card-disabled'}">` +
      `<div class="card-head">${head} ${tags.join(' ')}</div>` +
      `<div class="card-oneline">${escapeHtml(t.oneline)}</div>${meta}</div>`;
  }).join('');
  const body = `<header class="topbar"><span class="brand">researcher</span>` +
    `<span class="root">${escapeHtml(m.root)}</span></header>` +
    `<main class="grid">${cards || '<p>No topics in manifest.</p>'}</main>`;
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
if (runBtn) runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  const log = document.getElementById('run-log'); const out = document.getElementById('run-out');
  log.hidden = false; out.textContent = '';
  const res = await fetch('/t/' + slug + '/run', { method: 'POST' });
  if (res.status === 409) { out.textContent = 'already running…'; runBtn.disabled = false; return; }
  const { taskId } = await res.json();
  const es = new EventSource('/t/' + slug + '/run/' + taskId + '/stream');
  es.addEventListener('line', (ev) => { out.textContent += JSON.parse(ev.data) + '\\n'; out.scrollTop = out.scrollHeight; });
  es.addEventListener('end', () => { es.close(); runBtn.disabled = false; });
});
`;
