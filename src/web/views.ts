import { marked } from 'marked';
import katex from 'katex';
import type { DashboardModel, LibraryPaperDetailView, LibraryPaperSummary, LibraryView, TopicCard, TopicView, WorkspaceHomeModel } from './discovery.js';
import { displayLibraryReadMarkdown } from './library-read-sections.js';
import { sanitizeHtml } from './sanitize-html.js';
import type { Zone } from '../state/zone.js';
import {
  compactLibraryReadIdentityFm,
  isLibraryReadFrontmatter,
  serializeLibraryReadIdentityFm,
  splitFrontmatter,
  stripDuplicateLeadingH1,
  unquoteFm,
} from '../markdown/frontmatter.js';



/** marked → HTML with XSS hardening for untrusted note/report/read bodies (#77). */
function markedHtml(markdown: string): string {
  return sanitizeHtml(marked.parse(wrapBareTexMath(markdown ?? ''), { async: false }) as string);
}
function markedInline(markdown: string): string {
  return sanitizeHtml(marked.parseInline(wrapBareTexMath(markdown ?? ''), { async: false }) as string);
}

/**
 * Library reads often emit TeX sub/superscripts without `$` / `\(` (#159).
 * Wrap those atoms so the existing KaTeX extension can render them.
 * Skip fenced/inline code and already-delimited math; leave snake_case alone.
 */
function wrapBareTexMath(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const skipped = matchMathSkip(rest);
    if (skipped !== undefined) {
      out += skipped;
      i += skipped.length;
      continue;
    }
    const atom = matchBareTexAtom(rest);
    if (atom !== undefined) {
      out += isWordyIdentifier(atom) ? atom : `$${atom}$`;
      i += atom.length;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

function matchMathSkip(src: string): string | undefined {
  if (src.startsWith('```')) {
    const end = src.indexOf('```', 3);
    return end < 0 ? src : src.slice(0, end + 3);
  }
  if (src.startsWith('`')) {
    const end = src.indexOf('`', 1);
    return end < 0 ? '`' : src.slice(0, end + 1);
  }
  if (src.startsWith('$$')) {
    const end = src.indexOf('$$', 2);
    return end < 0 ? src : src.slice(0, end + 2);
  }
  if (src.startsWith('\\[')) {
    const end = src.indexOf('\\]', 2);
    return end < 0 ? src : src.slice(0, end + 2);
  }
  if (src.startsWith('\\(')) {
    const end = src.indexOf('\\)', 2);
    return end < 0 ? src : src.slice(0, end + 2);
  }
  if (src.startsWith('$')) {
    const m = /^\$((?:\\.|[^\n$\\])+?)\$(?!\$)/.exec(src);
    if (m) return m[0];
  }
  return undefined;
}

function matchBareTexAtom(src: string): string | undefined {
  const base = /^(?:\\[A-Za-z]+|[A-Za-z][A-Za-z0-9]*|[Α-Ωα-ω∞½])/.exec(src);
  if (!base) return undefined;
  let len = base[0].length;
  let attached = 0;
  while (true) {
    const rest = src.slice(len);
    const part = /^(_\{[^}]+\}|\^\{[^}]+\}|_[A-Za-z0-9](?![A-Za-z0-9])|\^[A-Za-z0-9]+(?![A-Za-z0-9]))/.exec(rest);
    if (!part) break;
    attached += 1;
    len += part[0].length;
  }
  if (attached === 0) return undefined;
  return src.slice(0, len);
}

function isWordyIdentifier(atom: string): boolean {
  return /^[A-Za-z]{3,}[A-Za-z0-9]*_[A-Za-z0-9]$/.test(atom) && !/[\^{]/.test(atom);
}

function renderMath(src: string, displayMode: boolean): string {
  return katex.renderToString(src, {
    displayMode,
    output: 'mathml',
    throwOnError: false,
  });
}

function firstIndex(src: string, needles: string[]): number {
  let best = -1;
  for (const n of needles) {
    const i = src.indexOf(n);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src: string) { return firstIndex(src, ['$$', '\\[']); },
      tokenizer(src: string) {
        const dollars = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:\n|$)/.exec(src);
        if (dollars) return { type: 'mathBlock', raw: dollars[0], text: dollars[1].trim() };
        const brackets = /^\\\[(?:[ \t]*\n)?([\s\S]+?)(?:\n[ \t]*)?\\\](?:\n|$)/.exec(src);
        if (brackets) return { type: 'mathBlock', raw: brackets[0], text: brackets[1].trim() };
      },
      renderer(token) {
        return `<div class="math-display">${renderMath(String(token.text ?? ''), true)}</div>`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src: string) { return firstIndex(src, ['\\(', '$']); },
      tokenizer(src: string) {
        if (src.startsWith('$$')) return;
        const paren = /^\\\(([\s\S]+?)\\\)/.exec(src);
        if (paren) return { type: 'mathInline', raw: paren[0], text: paren[1].trim() };
        const m = /^\$((?:\\.|[^\n$\\])+?)\$(?!\$)/.exec(src);
        if (!m) return;
        return { type: 'mathInline', raw: m[0], text: m[1].trim() };
      },
      renderer(token) {
        return `<span class="math-inline">${renderMath(String(token.text ?? ''), false)}</span>`;
      },
    },
  ],
});

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const unquote = unquoteFm;

// TOC display title: per-paper note headings share a fixed "…笔记：《title》" shell.
// Strip the repetitive prefix and the 《》 brackets, keeping the inner title plus any
// trailing annotation (e.g. （原始 + 综述）). A heading without 《》 is returned as-is.
export function tocTitle(full: string): string {
  const m = /《([^》]*)》(.*)$/.exec(full);
  return m ? (m[1] + m[2]).trim() : full.trim();
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
    `<div${metaRowClass(r.k, r.v)}><dt>${escapeHtml(r.k)}</dt><dd>${markedInline(r.v)}</dd></div>`,
  ).join('') + `</dl>`;
  return { html: markedHtml(m[1]) + dl, rest: body.slice(m[0].length) };
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
    `<div${metaRowClass(r.k, r.v)}><dt>${escapeHtml(r.k)}</dt><dd>${markedInline(r.v)}</dd></div>`,
  ).join('') + `</dl>`;
  return { html: markedHtml(m[1]) + dl, rest: body.slice(m[0].length) };
}

/** User paper notes: full markdown (lists, emphasis, code, links). No frontmatter/masthead. */
function renderNoteMarkdown(markdown: string): string {
  const src = markdown.trim();
  if (!src) return '';
  return markedHtml(src);
}

/** Markdown → HTML for previews (thesis draft, docs). */
export function renderMarkdown(markdown: string): string {
  return markedHtml(markdown ?? '');
}

export interface RenderDocOptions {
  /**
   * Resolve a Library read artifact path referenced by a Topic integration note
   * (e.g. `.researcher-workspace/library/papers/.../read_….md`). Used to hydrate
   * compact identity for notes written after #132 stripped all metadata.
   */
  resolveLibraryReadArtifact?: (relPath: string) => string | null | undefined;
}

export function renderDoc(markdown: string, opts: RenderDocOptions = {}): string {
  const { fm, body } = splitFrontmatter(markdown);
  if (fm && isLibraryReadFrontmatter(fm)) {
    // Top-level library-read artifact opened as a doc: compact identity, no system keys.
    const title = unquote(fm.paper ?? fm.title ?? '');
    let displayBody = stripDuplicateLeadingH1(body, title);
    displayBody = displayLibraryReadMarkdown(displayBody);
    const head =
      (title ? `<h1 class="note-title">${escapeHtml(title)}</h1>` : '') +
      renderLibraryReadIdentityFm(fm);
    return head + markedHtml(displayBody);
  }
  if (fm) {
    const title = unquote(fm.paper ?? fm.title ?? '');
    let displayBody = stripDuplicateLeadingH1(body, title);
    displayBody = hydrateLibraryReadIdentityFromArtifact(displayBody, opts.resolveLibraryReadArtifact);
    displayBody = liftNestedLibraryReadFrontmatter(displayBody);
    const mast = leadingMetaParagraph(displayBody);
    const head = noteMasthead(fm);
    if (mast) {
      const mastHtml = head ? mast.html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '') : mast.html;
      return head + mastHtml + markedHtml(mast.rest);
    }
    return head + markedHtml(displayBody);
  }
  let lifted = hydrateLibraryReadIdentityFromArtifact(body, opts.resolveLibraryReadArtifact);
  lifted = liftNestedLibraryReadFrontmatter(lifted);
  const mast = mastheadBlockquote(lifted);
  if (mast) return mast.html + markedHtml(mast.rest);
  return markedHtml(lifted);
}

/**
 * When `## Library read` has no nested identity fence, try the integration-note
 * artifact path and inject a compact identity fence before lift/render.
 */
function hydrateLibraryReadIdentityFromArtifact(
  md: string,
  resolve?: (relPath: string) => string | null | undefined,
): string {
  if (!resolve) return md;
  if (/(^##[ \t]+Library read[ \t]*\n)(?:[ \t]*\n)*---/m.test(md)) return md;
  const pathMatch = /Library read artifact `([^`]+)`/.exec(md);
  if (!pathMatch) return md;
  let artifact: string | null | undefined;
  try {
    artifact = resolve(pathMatch[1]);
  } catch {
    return md;
  }
  if (!artifact) return md;
  const identity = compactLibraryReadIdentityFm(splitFrontmatter(artifact.trim()).fm);
  if (!identity) return md;
  const fence = serializeLibraryReadIdentityFm(identity);
  return md.replace(
    /(^##[ \t]+Library read[ \t]*\n)(?:[ \t]*\n)*/m,
    `$1\n${fence}`,
  );
}

/**
 * Human-useful identity rows for a library-read FM block.
 * Never emits paper_id / read_id / kind / doc_type / empty tags.
 */
function renderLibraryReadIdentityFm(fm: Record<string, string>): string {
  const rows: string[] = [];
  const add = (key: string, value: string) => {
    if (!value) return;
    rows.push(`<div><dt>${escapeHtml(key)}</dt><dd>${value}</dd></div>`);
  };

  if (fm.authors) add('authors', fmValue('authors', fm.authors));

  const sourceId = unquote(fm.source_id ?? '');
  let hasArxiv = false;
  if (sourceId.startsWith('arxiv:')) {
    const id = sourceId.slice('arxiv:'.length);
    add('arxiv', fmValue('arxiv', id));
    hasArxiv = Boolean(id);
  } else {
    const sourceUrl = unquote(fm.source_url ?? '');
    const m = /arxiv\.org\/abs\/([^?\s#]+)/i.exec(sourceUrl);
    if (m) {
      add('arxiv', fmValue('arxiv', decodeURIComponent(m[1])));
      hasArxiv = true;
    }
  }

  if (fm.pdf_url) add('pdf', fmValue('pdf_url', fm.pdf_url));
  if (!hasArxiv && fm.source_url) add('source', fmValue('source_url', fm.source_url));

  return rows.length ? `<dl class="fm library-read-identity-fm">${rows.join('')}</dl>` : '';
}

/**
 * Legacy topic integration notes embedded the full library-read artifact (with
 * system frontmatter) under `## Library read`. Lift that fence into a compact
 * identity table and leave the reading body — never dump raw key: value prose.
 */
function liftNestedLibraryReadFrontmatter(md: string): string {
  return md.replace(
    /(^##[ \t]+Library read[ \t]*\n)(?:[ \t]*\n)*(---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))(?:[ \t]*\n)*(#[ \t]+[^\n]+\n)?/gm,
    (all, heading: string, fence: string, maybeH1: string | undefined) => {
      const { fm } = splitFrontmatter(fence);
      if (!fm || !isLibraryReadFrontmatter(fm)) return all;
      const title = unquote(fm.paper ?? fm.title ?? '');
      const identity = renderLibraryReadIdentityFm(fm);
      let keptH1 = '';
      if (maybeH1) {
        const stripped = stripDuplicateLeadingH1(maybeH1, title);
        if (stripped.trim()) keptH1 = stripped.endsWith('\n') ? stripped : `${stripped}\n`;
      }
      // Body after the optional H1 stays outside this match; only replace the
      // heading + system fence (+ duplicate title) with heading + identity.
      return `${heading}${identity ? `${identity}\n\n` : ''}${keptH1}`;
    },
  );
}

/** Body of a Library read artifact: strip duplicate title; no system frontmatter table. */
function renderLibraryReadBody(markdown: string, paperTitle: string): string {
  const { fm, body } = splitFrontmatter(markdown);
  const title = unquote(fm?.paper ?? fm?.title ?? '') || paperTitle;
  let displayBody = stripDuplicateLeadingH1(body, title);
  displayBody = stripDuplicateLeadingH1(displayBody, paperTitle);
  // Historical ## Brief shares the Essence first-screen slot (#98).
  displayBody = displayLibraryReadMarkdown(displayBody);
  return markedHtml(displayBody);
}

/**
 * Single identity block for the paper detail page (aligned .fm table).
 * Human-useful fields only — not paper_id / read_id / kind / doc_type.
 */
function renderPaperIdentityMeta(v: LibraryPaperDetailView): string {
  const fm = v.latestReadArtifact
    ? splitFrontmatter(v.latestReadArtifact.markdown).fm
    : null;
  const rows: string[] = [];
  const add = (key: string, value: string) => {
    if (!value) return;
    rows.push(`<div><dt>${escapeHtml(key)}</dt><dd>${value}</dd></div>`);
  };

  if (fm?.authors) add('authors', fmValue('authors', fm.authors));

  if (v.paper.canonicalId.startsWith('arxiv:')) {
    const id = v.paper.canonicalId.slice('arxiv:'.length);
    add(
      'arxiv',
      `<a href="https://arxiv.org/abs/${encodeURIComponent(id)}" target="_blank">${escapeHtml(id)}</a>`,
    );
  } else if (v.paper.canonicalId) {
    add('id', escapeHtml(v.paper.canonicalId));
  }

  if (fm?.source_url) add('source', fmValue('source_url', fm.source_url));
  if (fm?.pdf_url) add('pdf', fmValue('pdf_url', fm.pdf_url));

  add(
    'tags',
    v.paper.tags.length ? renderTagChips(v.paper.tags) : '<span class="muted">none</span>',
  );
  add(
    'status',
    escapeHtml(
      `${v.paper.readStatus} · ${v.paper.linkedTopicCount} link${v.paper.linkedTopicCount === 1 ? '' : 's'} · ` +
      `${v.paper.integratedTopicCount} integrated · ${fmtShortDate(v.paper.updatedAt)}`,
    ),
  );

  return rows.length ? `<dl class="fm paper-identity-fm">${rows.join('')}</dl>` : '';
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

function renderPaperCard(
  p: LibraryPaperSummary,
  variant: 'row' | 'compact' | 'detail' = 'row',
  opts: { defaultHidden?: boolean; topicContext?: boolean } = {},
): string {
  let integrationBadge = '';
  if (opts.topicContext) {
    integrationBadge = p.integratedInTopic
      ? `<span class="paper-integration in-landscape">in landscape</span>`
      : `<span class="paper-integration pending-landscape">linked · not in landscape</span>`;
  }
  const stateBits = opts.topicContext
    ? escapeHtml(p.readStatus)
    : `${escapeHtml(p.readStatus)} · ${p.linkedTopicCount} link${p.linkedTopicCount === 1 ? '' : 's'} · ${p.integratedTopicCount} integrated`;
  const searchText = [
    p.displayTitle,
    p.canonicalId,
    p.sourceLabel,
    p.readStatus,
    ...(opts.topicContext
      ? [p.integratedInTopic ? 'in landscape' : 'not in landscape']
      : []),
    ...p.tags,
  ].filter(Boolean).join(' ').toLowerCase();
  const hidden = opts.defaultHidden ? ' hidden' : '';
  const arxivId = p.canonicalId.startsWith('arxiv:') ? p.canonicalId.slice('arxiv:'.length) : '';
  const integrateCta = opts.topicContext && !p.integratedInTopic && arxivId
    ? `<div class="paper-cta muted">Run will prefer this link, or <code>researcher add ${escapeHtml(arxivId)}</code></div>`
    : '';
  return `<article class="paper-card ${variant}"${hidden} data-search="${escapeHtml(searchText)}" data-status="${escapeHtml(p.readStatus)}" data-linked="${p.linkedTopicCount > 0 ? '1' : '0'}" data-integrated="${p.integratedTopicCount > 0 ? '1' : '0'}" data-in-topic="${p.integratedInTopic ? '1' : '0'}">` +
    `<div class="paper-main">` +
      `<a class="paper-title-link" href="/library/p/${encodeURIComponent(p.id)}">${escapeHtml(p.displayTitle)}</a>` +
      `<div class="paper-id mono">${escapeHtml(p.canonicalId)}</div>` +
      integrationBadge +
      integrateCta +
    `</div>` +
    `<span class="source-badge">${escapeHtml(p.sourceLabel)}</span>` +
    `<div class="paper-tag-cell">${renderTagChips(p.tags)}</div>` +
    `<div class="paper-state">${stateBits}</div>` +
    `<div class="paper-updated">${fmtShortDate(p.updatedAt)}</div>` +
  `</article>`;
}

function renderAddPaperModal(topicPaths: string[]): string {
  const topicOptions = topicPaths
    .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join('');
  return `<div id="add-paper-modal" class="modal-backdrop" hidden>` +
    `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-paper-title">` +
      `<div class="modal-head"><h2 id="add-paper-title">Add paper</h2>` +
      `<button class="icon-button" type="button" data-close-add-paper aria-label="Close">x</button></div>` +
      `<form class="modal-form add-paper-form" action="/library/add" method="post">` +
        `<label><span>Paper source</span><input name="input" required placeholder="arXiv id, arXiv URL, or http(s) URL"></label>` +
        `<label><span>Tags</span><input name="tags" placeholder="survey, benchmark"></label>` +
        `<label><span>Topic context</span><select name="topic"><option value="">none</option>${topicOptions}</select></label>` +
        `<button class="primary" type="submit">Add paper</button>` +
      `</form>` +
    `</div>` +
  `</div>`;
}

export function renderLibrary(v: LibraryView): string {
  const papers = v.papers.map((p) => renderPaperCard(p, 'row', {
    defaultHidden: p.linkedTopicCount > 0, // match default Unlinked filter
  })).join('');
  const body = topbar(v.root, 'library') +
    `<main class="library-shell no-selection">` +
      `<aside class="library-rail">` +
        `<div class="library-rail-head"><h2>Papers</h2><span>${v.papers.length}</span></div>` +
        `<label class="library-search">Search<input type="search" placeholder="Title, tag, source" data-library-search></label>` +
        `<div class="library-filters" role="group" aria-label="Library filters">` +
          `<button class="active" type="button" data-filter="unlinked" aria-pressed="true">Unlinked</button>` +
          `<button type="button" data-filter="all" aria-pressed="false">All</button>` +
          `<button type="button" data-filter="unread" aria-pressed="false">Unread</button>` +
          `<button type="button" data-filter="read" aria-pressed="false">Read</button>` +
          `<button type="button" data-filter="linked" aria-pressed="false">Linked</button>` +
          `<button type="button" data-filter="integrated" aria-pressed="false">Integrated</button>` +
        `</div>` +
      `</aside>` +
      `<section class="library-main">` +
        `<div class="library-head"><div><h1>Library</h1><p>Workspace papers, reads, tags, and topic links.</p></div>` +
        `<button class="primary" type="button" data-open-add-paper>Add paper</button></div>` +
        `<div class="paper-list-grid">` +
          `<div class="paper-card paper-header"><span>Paper</span><span>Source</span><span>Tags</span><span>State</span><span>Updated</span></div>` +
          `${papers || '<p class="empty-state">No papers yet.</p>'}` +
          `<p class="empty-state library-no-results" hidden>No papers match the current filters.</p>` +
        `</div>` +
      `</section>` +
    `</main>${renderAddPaperModal(v.topics.map((t) => t.path))}<script>${LIBRARY_JS}</script>`;
  return page('Library · researcher', body);
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

function renderDeepReadForm(paperId: string, label: string, force = false): string {
  return `<form class="deep-read-form" action="/library/read" method="post">` +
    `<input type="hidden" name="paperId" value="${escapeHtml(paperId)}">` +
    (force ? '<input type="hidden" name="force" value="1">' : '') +
    `<button class="primary" type="submit">${escapeHtml(label)}</button>` +
  `</form>`;
}

function renderDeepReadAction(
  paperId: string,
  status: LibraryPaperSummary['readStatus'],
  activeRead: ActiveTaskView | null = null,
  lastError?: string,
): string {
  if (status === 'reading') {
    if (!activeRead) {
      return `<div class="read-status-panel stale" role="status" aria-live="polite">` +
        `<div class="read-status-copy"><span class="stale-dot"></span><div><b>Read interrupted</b>` +
        `<p>This paper was restored in a reading state, but no active read task is running. The previous task likely stopped before recording a final state.</p></div></div>` +
        renderDeepReadForm(paperId, 'Retry deep read', true) +
      `</div>`;
    }
    const attrs = ` data-library-task="${escapeHtml(activeRead.taskId)}" data-started-at="${activeRead.startedAt}" data-paper-id="${escapeHtml(paperId)}"`;
    const stages = Object.entries(LIBRARY_READ_STAGE_LABELS).map(([name, label], i) =>
      `<li class="${i === 0 ? 'active' : 'pending'}" data-stage="${escapeHtml(name)}"><span class="mk">${i === 0 ? '↻' : '·'}</span>${escapeHtml(label)}</li>`
    ).join('');
    return `<div class="read-status-panel" role="status" aria-live="polite">` +
      `<div class="read-status-copy"><span class="pulse-dot"></span><div><b id="library-read-heading">Reading and parsing</b>` +
      `<p id="library-read-status"${attrs}>Extracting paper text and drafting a Library read artifact.</p></div></div>` +
      `<button id="library-read-retry" class="primary" type="button" disabled>Deep read</button>` +
      `<ol id="library-read-stages" class="run-stages library-read-stages">${stages}</ol>` +
      `<pre id="library-read-log" class="library-read-log"></pre>` +
    `</div>`;
  }
  if (status === 'failed') {
    const err = lastError
      ? `<p class="read-error mono">${escapeHtml(lastError)}</p>`
      : `<p>The previous deep read failed. Retry to run it again.</p>`;
    return `<div class="read-status-panel stale" role="status">` +
      `<div class="read-status-copy"><span class="stale-dot"></span><div><b>Read failed</b>${err}</div></div>` +
      renderDeepReadForm(paperId, 'Retry deep read', true) +
    `</div>`;
  }
  const isRerun = status === 'read';
  return renderDeepReadForm(paperId, isRerun ? 'Re-run read' : 'Deep read', isRerun);
}

function topicLinksOf(v: LibraryPaperDetailView) {
  return v.links.filter((l) => l.surfaceType === 'topic');
}

function unlinkedSuggestions(v: LibraryPaperDetailView) {
  const linked = new Set(topicLinksOf(v).map((l) => l.surfaceId));
  return (v.topicSuggestions ?? []).filter((s) => !linked.has(s.topicId));
}

function shouldShowTopicSuggest(v: LibraryPaperDetailView): boolean {
  if (unlinkedSuggestions(v).length === 0) return false;
  // Multi-link or any integration: facts dominate; hide Suggest.
  if (v.paper.linkedTopicCount >= 2) return false;
  if (v.integrations.length > 0 || v.paper.integratedTopicCount > 0) return false;
  return true;
}

function renderTopicSuggestList(v: LibraryPaperDetailView): string {
  if (!shouldShowTopicSuggest(v)) return '';
  const suggestions = unlinkedSuggestions(v);
  const weak = v.paper.linkedTopicCount === 1;
  const heading = weak ? 'Also consider' : 'Suggest';
  const items = suggestions.map((s) =>
    `<button type="button" class="topic-suggest-item" ` +
      `data-suggest-topic="${escapeHtml(s.topicId)}" ` +
      `data-rationale="${escapeHtml(s.rationaleDraft)}">` +
      `<span class="topic-suggest-id mono">${escapeHtml(s.topicId)}</span>` +
      `<span class="topic-suggest-score mono" title="heuristic score">${s.score.toFixed(0)}</span>` +
      `<span class="topic-suggest-why muted">${escapeHtml(s.reason)}</span>` +
    `</button>`,
  ).join('');
  return `<div class="topic-suggest${weak ? ' is-weak' : ''}" data-topic-suggest>` +
    `<div class="topic-suggest-head"><span>${heading}</span>` +
      `<span class="muted topic-suggest-hint">pick → edit below → Link</span></div>` +
    `<div class="topic-suggest-list" role="list">${items}</div>` +
    `<p class="topic-suggest-status muted" data-suggest-status hidden></p>` +
  `</div>`;
}

function paperDetailHref(paperId: string, editTopic?: string): string {
  const base = `/library/p/${encodeURIComponent(paperId)}`;
  return editTopic ? `${base}?edit=${encodeURIComponent(editTopic)}` : base;
}

function renderLinkTopicAction(v: LibraryPaperDetailView, editTopic?: string): string {
  const linkedTopicIds = new Set(topicLinksOf(v).map((l) => l.surfaceId));
  const editing = editTopic && linkedTopicIds.has(editTopic)
    ? topicLinksOf(v).find((l) => l.surfaceId === editTopic)
    : undefined;

  if (editing) {
    const why = escapeHtml(editing.rationale ?? '');
    const form =
      `<form id="topic-link-form" class="topic-link-form" action="/library/link" method="post">` +
        `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
        `<input type="hidden" name="topic" value="${escapeHtml(editing.surfaceId)}">` +
        `<p class="topic-link-manual-head">Update <span class="mono">${escapeHtml(editing.surfaceId)}</span></p>` +
        `<div class="topic-link-fields">` +
          `<label>Why (optional)<input name="rationale" value="${why}" placeholder="why this topic"></label>` +
        `</div>` +
        `<button class="primary topic-link-submit" type="submit">Update</button>` +
        `<a class="secondary" href="${paperDetailHref(v.paper.id)}">Cancel</a>` +
      `</form>`;
    return `<div class="topic-link-panel">${form}</div>`;
  }

  const unlinked = v.topics.filter((t) => t.available && !linkedTopicIds.has(t.path));
  const suggest = renderTopicSuggestList(v);
  if (unlinked.length === 0) {
    return `<div class="topic-link-panel"><p class="muted">All available topics are linked.</p></div>`;
  }
  const topicOptions =
    `<option value="" selected disabled>Select topic…</option>` +
    unlinked.map((t) => `<option value="${escapeHtml(t.path)}">${escapeHtml(t.path)}</option>`).join('');
  const button = linkedTopicIds.size >= 1 ? 'Link another topic' : 'Link topic';
  const form =
    `<form id="topic-link-form" class="topic-link-form" action="/library/link" method="post">` +
      `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
      (suggest
        ? `<div class="topic-link-manual-head muted">Details <span class="topic-link-manual-or">or pick topic yourself</span></div>`
        : '') +
      `<div class="topic-link-fields">` +
        `<label>Topic<select name="topic" required>${topicOptions}</select></label>` +
        `<label>Why (optional)<input name="rationale" placeholder="why this topic"></label>` +
      `</div>` +
      `<button class="primary topic-link-submit" type="submit">${button}</button>` +
    `</form>`;
  const script = suggest ? `<script>${TOPIC_SUGGEST_JS}</script>` : '';
  return `<div class="topic-link-panel">${suggest}${form}</div>${script}`;
}

/** Marker TOPIC_SUGGEST_JS: fill form only — never POST /library/link. */
const TOPIC_SUGGEST_JS = `/* TOPIC_SUGGEST_JS */
(function () {
  var form = document.getElementById('topic-link-form');
  var root = document.querySelector('[data-topic-suggest]');
  if (!form || !root) return;
  var topicSel = form.querySelector('select[name="topic"]');
  var ratInput = form.querySelector('input[name="rationale"]');
  var status = root.querySelector('[data-suggest-status]');
  var submit = form.querySelector('.topic-link-submit');
  root.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-suggest-topic]') : null;
    if (!btn || !root.contains(btn)) return;
    ev.preventDefault();
    var topic = btn.getAttribute('data-suggest-topic') || '';
    var rat = btn.getAttribute('data-rationale') || '';
    if (topicSel) {
      topicSel.value = topic;
      topicSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (ratInput) ratInput.value = rat;
    root.querySelectorAll('.topic-suggest-item').forEach(function (el) {
      el.classList.toggle('is-selected', el === btn);
    });
    form.classList.add('has-suggest-pick');
    if (status) {
      status.hidden = false;
      status.textContent = 'Selected ' + topic + ' — review details, then press Link topic.';
    }
    if (submit) submit.focus({ preventScroll: true });
  });
})();`;

function renderReads(reads: LibraryPaperDetailView['reads']): string {
  return reads.map((r) => {
    const path = r.artifactPath ?? r.id;
    const label = r.artifactPath ? basename(path) : r.id;
    const err = r.lastError ? ` <span class="read-error mono" title="${escapeHtml(r.lastError)}">${escapeHtml(r.lastError)}</span>` : '';
    return `<li class="read-item">${renderStatusBadge(r.status)}` +
      `<span class="read-path mono" title="${escapeHtml(path)}">${escapeHtml(label)}</span>${err}</li>`;
  }).join('');
}

function renderStatusBadge(status: LibraryPaperSummary['readStatus']): string {
  return `<span class="status-badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

const PAPER_NOTE_KINDS = ['note', 'clarification', 'caveat', 'idea', 'question'] as const;

function renderPaperNotes(v: LibraryPaperDetailView): string {
  const kindOptions = PAPER_NOTE_KINDS.map((k) =>
    `<option value="${k}"${k === 'note' ? ' selected' : ''}>${k}</option>`,
  ).join('');
  const items = v.notes.map((n) => {
    const pinLabel = n.pinned ? 'Unpin' : 'Pin';
    const pinAction = n.pinned ? 'unpin' : 'pin';
    return `<li class="paper-note${n.pinned ? ' is-pinned' : ''}">` +
      `<div class="paper-note-head">` +
        `<span class="note-kind">${escapeHtml(n.kind)}</span>` +
        `${n.pinned ? '<span class="note-pin-badge">pinned</span>' : ''}` +
        `<span class="note-time mono" title="${escapeHtml(n.updatedAt)}">${escapeHtml(fmtShortDate(n.updatedAt))}</span>` +
      `</div>` +
      `<div class="paper-note-body">${renderNoteMarkdown(n.body)}</div>` +
      `<div class="paper-note-actions">` +
        `<form action="/library/note" method="post">` +
          `<input type="hidden" name="action" value="${pinAction}">` +
          `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
          `<input type="hidden" name="noteId" value="${escapeHtml(n.id)}">` +
          `<button class="secondary note-action-btn" type="submit">${pinLabel}</button>` +
        `</form>` +
        `<form action="/library/note" method="post" onsubmit="return confirm('Delete this note?');">` +
          `<input type="hidden" name="action" value="delete">` +
          `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
          `<input type="hidden" name="noteId" value="${escapeHtml(n.id)}">` +
          `<button class="danger note-action-btn" type="submit">Delete</button>` +
        `</form>` +
      `</div>` +
    `</li>`;
  }).join('');

  return `<section class="detail-panel paper-notes-panel" id="notes">` +
    `<div class="paper-notes-head">` +
      `<h2>Notes</h2>` +
      `<span class="muted">Your attention on this paper — survives re-read</span>` +
    `</div>` +
    `<form class="paper-note-form" action="/library/note" method="post">` +
      `<input type="hidden" name="action" value="create">` +
      `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
      `<label class="note-body-label">New note` +
        `<textarea name="body" rows="3" required placeholder="Markdown ok — e.g. **selection** not generation"></textarea>` +
      `</label>` +
      `<div class="paper-note-form-row">` +
        `<label>Kind<select name="kind">${kindOptions}</select></label>` +
        `<label class="note-pin-check"><input type="checkbox" name="pinned" value="1"> Pin</label>` +
        `<button class="primary" type="submit">Add note</button>` +
      `</div>` +
    `</form>` +
    `<ul class="paper-note-list">${items || '<li class="muted paper-note-empty">No notes yet. Capture what you want to remember.</li>'}</ul>` +
  `</section>`;
}

export function renderLibraryPaper(
  v: LibraryPaperDetailView,
  activeRead: ActiveTaskView | null = null,
  editTopic?: string,
): string {
  const noteCount = v.notes.length;
  // Page-level CTA: same .primary language as Add paper / Deep read / Add note.
  const notesJump =
    `<a class="primary paper-jump-notes" href="#notes">` +
      `Notes${noteCount > 0 ? ` · ${noteCount}` : ''}` +
    `</a>`;
  const identity = renderPaperIdentityMeta(v);
  const readBody = v.latestReadArtifact
    ? renderLibraryReadBody(v.latestReadArtifact.markdown, v.paper.displayTitle)
    : `<div class="read-empty">` +
        `<p class="muted">No deep-read artifact yet.</p>` +
        `<ul class="meta-list">${renderReads(v.reads) || '<li>—</li>'}</ul>` +
      `</div>`;
  const pathHint = v.latestReadArtifact
    ? `<span class="mono read-path" title="${escapeHtml(v.latestReadArtifact.path)}">${escapeHtml(basename(v.latestReadArtifact.path))}</span>`
    : '';
  const readSurface =
    `<section class="reader read-surface paper-doc" id="read">` +
      `<div class="read-artifact-head">` +
        `<h2 class="sr-only">Deep read</h2>` +
        pathHint +
      `</div>` +
      identity +
      readBody +
    `</section>`;
  // Breadcrumb (wayfinding), not a second primary nav — Library is the parent list.
  const crumb =
    `<nav class="paper-crumb" aria-label="Breadcrumb">` +
      `<a class="secondary paper-crumb-back" href="/library">` +
        `<span class="paper-crumb-arrow" aria-hidden="true">←</span> Library` +
      `</a>` +
      `<span class="paper-crumb-sep" aria-hidden="true">/</span>` +
      `<span class="paper-crumb-here">Paper</span>` +
    `</nav>`;
  const body = topbar(v.paper.id, 'library') +
    `<main class="paper-detail-shell">` +
      `<section class="paper-detail-main">` +
        crumb +
        `<div class="library-head paper-doc-head">` +
          `<div>` +
            `<h1>${escapeHtml(v.paper.displayTitle)}</h1>` +
            `<p class="mono paper-canonical">${escapeHtml(v.paper.canonicalId)}` +
              `${v.paper.sourceLabel ? ` · ${escapeHtml(v.paper.sourceLabel)}` : ''}</p>` +
          `</div>` +
          `<div class="paper-head-actions">` +
            notesJump +
            renderStatusBadge(v.paper.readStatus) +
          `</div>` +
        `</div>` +
        readSurface +
        renderPaperNotes(v) +
      `</section>` +
      `<aside class="paper-inspector">${renderPaperInspector(v, activeRead, editTopic)}</aside>` +
    `</main>` +
    `${v.paper.readStatus === 'reading' && activeRead ? `<script>${LIBRARY_READ_JS}</script>` : ''}`;
  return page(`${v.paper.displayTitle} · researcher`, body);
}

function renderLinkedTopicRows(v: LibraryPaperDetailView): string {
  const integrated = new Set(v.integrations.map((i) => i.topicId));
  const rows = topicLinksOf(v).map((l) => {
    const badge = integrated.has(l.surfaceId)
      ? `<span class="source-badge">in landscape</span>`
      : `<span class="muted">not in landscape</span>`;
    const why = l.rationale
      ? `<p class="linked-topic-why muted">${escapeHtml(l.rationale)}</p>`
      : '';
    return `<li class="linked-topic-row">` +
      `<div class="linked-topic-head">` +
        `<b>${escapeHtml(l.surfaceId)}</b> ${badge}` +
        `<span class="linked-topic-actions">` +
          `<a class="link-button" href="${paperDetailHref(v.paper.id, l.surfaceId)}">Edit</a>` +
          `<form class="inline-form" action="/library/unlink" method="post" onsubmit="return confirm('Remove this topic link?');">` +
            `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
            `<input type="hidden" name="topic" value="${escapeHtml(l.surfaceId)}">` +
            `<button type="submit" class="link-button">Unlink</button>` +
          `</form>` +
        `</span>` +
      `</div>${why}</li>`;
  }).join('');
  return rows || '<li>—</li>';
}

function renderMiniMap(v: LibraryPaperDetailView): string {
  const links = topicLinksOf(v);
  if (links.length === 0) return '<p class="muted">No topic link yet.</p>';
  const topics = links
    .map((l) => `<div class="mini-node"><b>Topic</b><span>${escapeHtml(l.surfaceId)}</span></div>`)
    .join('');
  return `<div class="mini-map${links.length > 1 ? ' is-multi' : ''}">` +
    `<div class="mini-node"><b>Paper</b><span>${escapeHtml(v.paper.readStatus)}</span></div>` +
    `<div class="mini-edge"></div>` +
    `<div class="mini-map-topics">${topics}</div>` +
    `</div>`;
}

function renderPaperInspector(
  v: LibraryPaperDetailView,
  activeRead: ActiveTaskView | null = null,
  editTopic?: string,
): string {
  const integrations = v.integrations.map((i) =>
    `<li><b>${escapeHtml(i.topicId)}</b> ${i.zone ? `<span class="source-badge">${escapeHtml(i.zone)}</span>` : ''} ` +
    `<span class="mono">${escapeHtml(i.notePath ?? i.integratedAt)}</span></li>`
  ).join('');
  const latestReadError = [...v.reads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.lastError;
  const canDelete = v.paper.linkedTopicCount === 0 && v.links.length === 0 && v.integrations.length === 0;
  const deleteAction = canDelete
    ? `<section class="detail-panel danger-panel"><h2>Delete</h2>` +
      `<p class="muted">Remove this unlinked paper and its Library reads from the workspace.</p>` +
      `<form class="deep-read-form" action="/library/delete" method="post"` +
      ` onsubmit="return confirm('Delete this paper from the Library? This cannot be undone.');">` +
      `<input type="hidden" name="paperId" value="${escapeHtml(v.paper.id)}">` +
      `<button class="danger" type="submit">Delete from Library</button>` +
      `</form></section>`
    : `<section class="detail-panel"><h2>Delete</h2>` +
      `<p class="muted">Linked or integrated papers cannot be deleted. Unlink from all topics first.</p></section>`;
  return `<section class="detail-panel"><h2>Actions</h2>${renderDeepReadAction(v.paper.id, v.paper.readStatus, activeRead, latestReadError)}</section>` +
    `<section class="detail-panel"><h2>Linked topics</h2><ul class="meta-list">${renderLinkedTopicRows(v)}</ul></section>` +
    `<section class="detail-panel"><h2>Topic link</h2>${renderLinkTopicAction(v, editTopic)}</section>` +
    `<section class="detail-panel"><h2>Mini map</h2>${renderMiniMap(v)}</section>` +
    `<section class="detail-panel"><h2>Integrations</h2><ul class="meta-list">${integrations || '<li>—</li>'}</ul></section>` +
    deleteAction;
}

const LIBRARY_READ_JS = `
const libStatus = document.getElementById('library-read-status');
const libStages = document.getElementById('library-read-stages');
const libLog = document.getElementById('library-read-log');
const libHeading = document.getElementById('library-read-heading');
const libRetry = document.getElementById('library-read-retry');
const libStageLabels = ${JSON.stringify(LIBRARY_READ_STAGE_LABELS)};
let libPlan = Object.keys(libStageLabels), libCurrent = libPlan[0], libDone = false, libFailed = false;

function renderLibraryStages() {
  if (!libStages) return;
  const currentIndex = libCurrent ? libPlan.indexOf(libCurrent) : -1;
  libStages.innerHTML = libPlan.map((name, i) => {
    let cls = 'pending', mk = '\\u00b7';
    if (libFailed && i === currentIndex) { cls = 'error'; mk = '!'; }
    else if (libDone || (currentIndex >= 0 && i < currentIndex)) { cls = 'done'; mk = '\\u2713'; }
    else if (i === currentIndex) { cls = 'active'; mk = '\\u27f3'; }
    return '<li class="' + cls + '" data-stage="' + name + '"><span class="mk">' + mk + '</span>' + (libStageLabels[name] || name) + '</li>';
  }).join('');
}

function enableLibraryRetry() {
  if (!libRetry) return;
  libRetry.disabled = false;
  libRetry.textContent = 'Retry';
  libRetry.addEventListener('click', () => {
    const paperId = libStatus && libStatus.dataset.paperId;
    if (!paperId) { window.location.reload(); return; }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/library/read';
    form.innerHTML = '<input type="hidden" name="paperId" value="' + paperId + '">' +
      '<input type="hidden" name="force" value="1">';
    document.body.appendChild(form);
    form.submit();
  }, { once: true });
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
    libFailed = !libDone;
    if (libHeading) libHeading.textContent = libDone ? 'Read complete' : 'Read failed';
    if (libStatus) libStatus.textContent = libDone ? 'Read artifact recorded. Refreshing to show the completed read.' : 'Read failed. Refresh to retry, or check the log below.';
    renderLibraryStages();
    if (libDone) window.setTimeout(() => window.location.reload(), 900);
    else enableLibraryRetry();
  });
  es.onerror = () => appendLibraryLog('progress connection closed');
} else {
  renderLibraryStages();
  appendLibraryLog('Live stage stream is unavailable for this restored reading state.');
}
`;

// Shared by Library and Workspace Home — modal open/close only.
const ADD_PAPER_JS = `
const addPaperModal = document.getElementById('add-paper-modal');
const openAddPaperButtons = Array.from(document.querySelectorAll('[data-open-add-paper]'));
const closeAddPaper = document.querySelector('[data-close-add-paper]');

function showAddPaper() {
  if (!addPaperModal) return;
  addPaperModal.hidden = false;
  addPaperModal.querySelector('input[name="input"]')?.focus();
}
function hideAddPaper() {
  if (!addPaperModal) return;
  addPaperModal.hidden = true;
  openAddPaperButtons[0]?.focus();
}
openAddPaperButtons.forEach((btn) => btn.addEventListener('click', showAddPaper));
closeAddPaper?.addEventListener('click', hideAddPaper);
addPaperModal?.addEventListener('click', (e) => {
  if (e.target === addPaperModal) hideAddPaper();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && addPaperModal && !addPaperModal.hidden) hideAddPaper();
});
`;

const LIBRARY_JS = `
const librarySearch = document.querySelector('[data-library-search]');
const libraryFilterButtons = Array.from(document.querySelectorAll('[data-filter]'));
const libraryCards = Array.from(document.querySelectorAll('.paper-card.row'));
const libraryNoResults = document.querySelector('.library-no-results');
// Default inbox: papers not yet linked to any topic.
let activeLibraryFilter = 'unlinked';

function cardMatchesFilter(card) {
  if (activeLibraryFilter === 'all') return true;
  if (activeLibraryFilter === 'unlinked') return card.dataset.linked !== '1';
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
  activeLibraryFilter = button.dataset.filter || 'unlinked';
  libraryFilterButtons.forEach((b) => {
    const active = b === button;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  applyLibraryFilters();
}));
applyLibraryFilters();
` + ADD_PAPER_JS;

// ISO 8601 → YYYY-MM-DD; never expose the raw timestamp in the UI.
function fmtDate(iso: string | null): string {
  if (!iso) return 'never run';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : escapeHtml(iso);
}

// Relative age for home / activity surfaces. Absolute date stays in title attr.
function fmtRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return fmtDate(iso);
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  if (day < 60) return `${Math.round(day / 7)}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 18) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
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

type HomePrimaryCta =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'add-paper'; label: string };

function homePrimaryCta(m: WorkspaceHomeModel): HomePrimaryCta {
  const reading = m.attention.find((a) => a.kind === 'reading');
  if (reading) return { kind: 'link', href: reading.href, label: 'Continue reading' };
  if (m.libraryCounts.unlinked > 0) return { kind: 'link', href: '/library', label: 'Review library' };
  // Empty library: intake is the primary job.
  if (m.libraryCounts.papers === 0) return { kind: 'add-paper', label: 'Add paper' };
  if (m.activeTopics.length > 0) return { kind: 'link', href: `/t/${m.activeTopics[0].slug}`, label: 'Open topic' };
  return { kind: 'link', href: '/topics', label: 'View topics' };
}

function homeHeroActions(m: WorkspaceHomeModel): string {
  const cta = homePrimaryCta(m);
  const primary = cta.kind === 'add-paper'
    ? `<button class="primary home-cta" type="button" data-open-add-paper>${escapeHtml(cta.label)}</button>`
    : `<a class="primary home-cta" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>`;
  // Secondary Add paper only when primary is something else — avoid two identical CTAs.
  const secondary = cta.kind === 'add-paper'
    ? ''
    : `<button class="secondary home-cta-secondary" type="button" data-open-add-paper>Add paper</button>`;
  return `<div class="home-actions">${primary}${secondary}</div>`;
}

function homeMetric(
  href: string,
  value: number | string,
  label: string,
  opts: { emphasize?: boolean; zeroMuted?: boolean } = {},
): string {
  const n = typeof value === 'number' ? value : null;
  const classes = [
    'metric',
    opts.emphasize ? 'metric-hot' : '',
    opts.zeroMuted && n === 0 ? 'metric-zero' : '',
  ].filter(Boolean).join(' ');
  const display = opts.zeroMuted && n === 0 ? '—' : escapeHtml(String(value));
  return `<a class="${classes}" href="${href}"><b>${display}</b><span>${escapeHtml(label)}</span></a>`;
}

function homeAttention(m: WorkspaceHomeModel): string {
  if (m.attention.length === 0) {
    return `<div class="home-panel home-attention">` +
      `<h2>Needs attention</h2>` +
      `<p class="home-empty">Nothing needs you right now. Topics are current and the library inbox is clear.</p>` +
      `<a href="/library">Browse library</a>` +
    `</div>`;
  }
  const items = m.attention.map((a) =>
    `<li class="attention-item kind-${escapeHtml(a.kind)}">` +
      `<div class="attention-body">` +
        `<a class="attention-title" href="${escapeHtml(a.href)}">${escapeHtml(a.title)}</a>` +
        `<span class="attention-detail">${escapeHtml(a.detail)}</span>` +
      `</div>` +
      `<a class="attention-cta" href="${escapeHtml(a.href)}">${escapeHtml(a.cta)}</a>` +
    `</li>`,
  ).join('');
  return `<div class="home-panel home-attention">` +
    `<h2>Needs attention</h2>` +
    `<ul class="attention-list">${items}</ul>` +
  `</div>`;
}

function homeTopics(m: WorkspaceHomeModel): string {
  const rows = m.activeTopics.map((t) => {
    const abs = fmtDate(t.lastRun);
    const rel = fmtRelative(t.lastRun);
    const stale = abs === 'never run' || rel.endsWith('w ago') || rel.endsWith('mo ago') || rel.endsWith('y ago');
    return `<li class="${stale ? 'is-stale' : ''}">` +
      `<span class="topic-dot" aria-hidden="true"></span>` +
      `<a href="/t/${t.slug}">${escapeHtml(t.path)}</a>` +
      `<span title="${escapeHtml(abs)}">${t.noteCount} notes · ${escapeHtml(rel)}</span>` +
    `</li>`;
  }).join('');
  return `<div class="home-panel home-topics">` +
    `<h2>Active Topics</h2>` +
    `<ul class="home-list">${rows || '<li class="muted">No active topics.</li>'}</ul>` +
    `<a href="/topics">View all topics</a>` +
  `</div>`;
}

function homeLibrary(m: WorkspaceHomeModel): string {
  const lc = m.libraryCounts;
  const pct = lc.papers > 0 ? Math.round((lc.integrated / lc.papers) * 100) : 0;
  const recent = m.recentPapers.map((p) =>
    `<li>` +
      `<a href="/library/p/${encodeURIComponent(p.id)}">${escapeHtml(p.displayTitle)}</a>` +
      `<span>${escapeHtml(p.readStatus)} · ${escapeHtml(fmtRelative(p.updatedAt))}</span>` +
    `</li>`,
  ).join('');
  return `<section class="home-panel home-library">` +
    `<div class="home-library-head">` +
      `<h2>Library health</h2>` +
      `<a href="/library">Open library →</a>` +
    `</div>` +
    `<div class="health-bar" role="img" aria-label="${lc.integrated} of ${lc.papers} papers integrated">` +
      `<span style="width:${pct}%"></span>` +
    `</div>` +
    `<p class="health-caption"><b>${lc.integrated}</b> / ${lc.papers} integrated · ${pct}%</p>` +
    `<dl class="health-stats">` +
      `<div><dt>Unread</dt><dd>${lc.unread}</dd></div>` +
      `<div><dt>Reading</dt><dd>${lc.reading}</dd></div>` +
      `<div><dt>Linked</dt><dd>${lc.linked}</dd></div>` +
      `<div><dt>Unlinked</dt><dd>${lc.unlinked}</dd></div>` +
      `<div><dt>Failed</dt><dd>${lc.failed}</dd></div>` +
      `<div><dt>To integrate</dt><dd>${lc.toIntegrate}</dd></div>` +
    `</dl>` +
    (recent
      ? `<h3 class="home-subhead">Recent papers</h3><ul class="home-list recent-papers">${recent}</ul>`
      : `<p class="home-empty">No papers yet — use Add paper above.</p>`) +
  `</section>`;
}

export function renderWorkspaceHome(m: WorkspaceHomeModel): string {
  const topicSub = m.topicCounts.active === m.topicCounts.total && m.topicCounts.total > 0
    ? 'all active'
    : `${m.topicCounts.active} active`;
  const readingHref = m.attention.find((a) => a.kind === 'reading')?.href ?? '/library';
  const activity = m.lastActivity
    ? `last activity ${fmtRelative(m.lastActivity)}`
    : 'no activity yet';
  const heroMeta = [
    `${m.topicCounts.active} active topic${m.topicCounts.active === 1 ? '' : 's'}`,
    `${m.libraryCounts.papers} paper${m.libraryCounts.papers === 1 ? '' : 's'}`,
    activity,
  ].join(' · ');

  const body = topbar(m.root, 'workspace') +
    `<main class="workspace-home">` +
      `<section class="workspace-hero">` +
        `<div>` +
          `<h1>${escapeHtml(m.name)}</h1>` +
          `<p>${escapeHtml(heroMeta)}</p>` +
        `</div>` +
        homeHeroActions(m) +
      `</section>` +
      `<section class="metric-grid">` +
        homeMetric('/topics', m.topicCounts.total, topicSub) +
        homeMetric('/library', m.libraryCounts.papers, `${m.libraryCounts.read} read`) +
        homeMetric('/library', m.libraryCounts.unlinked, 'to link', {
          emphasize: m.libraryCounts.unlinked > 0,
          zeroMuted: true,
        }) +
        homeMetric(readingHref, m.libraryCounts.reading, 'reading', {
          emphasize: m.libraryCounts.reading > 0,
          zeroMuted: true,
        }) +
      `</section>` +
      `<section class="home-columns">` +
        homeAttention(m) +
        homeTopics(m) +
      `</section>` +
      homeLibrary(m) +
    `</main>` +
    renderAddPaperModal(m.topicPaths) +
    `<script>${ADD_PAPER_JS}</script>`;
  return page(`${m.name} · researcher`, body);
}

export interface AddTopicFormState {
  path?: string;
  oneline?: string;
  error?: string;
  /** When true, open the modal on page load (e.g. after a failed create). */
  open?: boolean;
}

function renderAddTopicModal(state: AddTopicFormState = {}): string {
  const openAttr = state.open || state.error ? '' : ' hidden';
  const err = state.error
    ? `<p class="form-error" role="alert">${escapeHtml(state.error)}</p>`
    : '';
  return `<div id="add-topic-modal" class="modal-backdrop"${openAttr}>` +
    `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-topic-title">` +
      `<div class="modal-head"><h2 id="add-topic-title">New topic</h2>` +
      `<button class="icon-button" type="button" data-close-add-topic aria-label="Close">x</button></div>` +
      `<form class="modal-form add-topic-form" action="/topics" method="post">` +
        `<label><span>Folder name</span>` +
          `<input name="path" required placeholder="world-model" value="${escapeHtml(state.path ?? '')}" autocomplete="off" data-slug-input>` +
          `<span class="field-hint">Directory id under the workspace. Spaces become hyphens (<code>world model</code> → <code>world-model</code>). Chinese belongs in One-line below.</span>` +
          `<span class="field-hint slug-preview" data-slug-preview hidden></span>` +
        `</label>` +
        `<label><span>One-line intent</span>` +
          `<input name="oneline" required placeholder="World model 领域研究进展…" value="${escapeHtml(state.oneline ?? '')}" autocomplete="off">` +
          `<span class="field-hint">Any language. One sentence: what this pillar is about.</span>` +
        `</label>` +
        err +
        `<p class="modal-hint">Creates a local topic directory and registers it. Next step: Complete setup (thesis + sources) before Run.</p>` +
        `<button class="primary" type="submit">Create topic</button>` +
      `</form>` +
    `</div>` +
  `</div>`;
}

const ADD_TOPIC_JS = `
const addTopicModal = document.getElementById('add-topic-modal');
const openAddTopicButtons = Array.from(document.querySelectorAll('[data-open-add-topic]'));
const closeAddTopic = document.querySelector('[data-close-add-topic]');

function showAddTopic() {
  if (!addTopicModal) return;
  addTopicModal.hidden = false;
  addTopicModal.querySelector('input[name="path"]')?.focus();
  updateSlugPreview();
}
function hideAddTopic() {
  if (!addTopicModal) return;
  addTopicModal.hidden = true;
  openAddTopicButtons[0]?.focus();
}
function slugifySeg(s) {
  // NOTE: this block is embedded in a server-side template literal — backslashes
  // must be double-escaped so the browser receives real regex escapes (\\s, \\/).
  return String(s || '').trim().toLowerCase()
    .replace(/\\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}
function updateSlugPreview() {
  const input = addTopicModal?.querySelector('[data-slug-input]');
  const preview = addTopicModal?.querySelector('[data-slug-preview]');
  if (!input || !preview) return;
  const raw = input.value.trim();
  if (!raw) { preview.hidden = true; preview.textContent = ''; return; }
  const slug = raw.replace(/\\/+$/,'').split('/').map(slugifySeg).filter(Boolean).join('/');
  if (slug && slug !== raw) {
    preview.hidden = false;
    preview.textContent = 'Will create folder: ' + slug;
  } else {
    preview.hidden = true;
    preview.textContent = '';
  }
}
openAddTopicButtons.forEach((btn) => btn.addEventListener('click', showAddTopic));
closeAddTopic?.addEventListener('click', hideAddTopic);
addTopicModal?.addEventListener('click', (e) => {
  if (e.target === addTopicModal) hideAddTopic();
});
addTopicModal?.querySelector('[data-slug-input]')?.addEventListener('input', updateSlugPreview);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && addTopicModal && !addTopicModal.hidden) hideAddTopic();
});
if (addTopicModal && !addTopicModal.hidden) updateSlugPreview();
`;

export function renderTopics(m: DashboardModel, addTopic: AddTopicFormState = {}): string {
  const cards = m.topics.map((t) => {
    const tags: string[] = [];
    if (!t.active) tags.push('<span class="tag dormant">dormant</span>');
    if (!t.available) tags.push('<span class="tag missing">unavailable</span>');
    if (t.needsSetup && t.hasOpenQuestions) tags.push('<span class="tag blocked">blocked</span>');
    else if (t.needsSetup) tags.push('<span class="tag setup">needs setup</span>');
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
  const newCard =
    `<button type="button" class="card card-new" data-open-add-topic>` +
      `<div class="card-head"><span class="card-title card-new-title"><span class="card-plus" aria-hidden="true">+</span>New topic</span></div>` +
      `<p class="card-oneline">Start a new research pillar</p>` +
    `</button>`;
  const flash = addTopic.error && !addTopic.open
    ? `<div class="page-flash error" role="alert">${escapeHtml(addTopic.error)}</div>`
    : '';
  const body = topbar(m.root, 'topics') +
    `<main class="topics-page"><div class="page-head"><h1>Topics</h1><p>Topic workspaces declared by this super-repo.</p></div>` +
    flash +
    `<div class="grid">${cards}${newCard}</div></main>` +
    renderAddTopicModal(addTopic) +
    `<script>${ADD_TOPIC_JS}</script>`;
  return page('Topics · researcher', body);
}

export const renderDashboard = renderTopics;

export function renderTopic(
  v: TopicView,
  activeRun: { taskId: string; startedAt: number } | null = null,
  opts: { openSetup?: boolean } = {},
): string {
  if (!v.available) {
    const body = `<header class="topbar"><a class="brand" href="/">researcher</a>` +
      `<span class="root">${escapeHtml(v.path)}</span><h1 class="sr-only">Topic: ${escapeHtml(v.path)}</h1></header>` +
      `<main class="notice">Topic unavailable — submodule missing or no .researcher/.</main>`;
    return page(`${v.path} · unavailable`, body);
  }
  const runBlocked = v.needsSetup || !v.soulReady;
  let setupNotice = '';
  if (v.hasOpenQuestions) {
    setupNotice =
      `<div class="setup-banner" role="status">` +
        `<div class="setup-banner-text">` +
          `<strong>Blocked.</strong> Run paused — answer ` +
          `<a href="/t/${v.slug}/doc?path=${encodeURIComponent('.researcher/open_questions.md')}" class="doc-link" data-path="${encodeURIComponent('.researcher/open_questions.md')}">open_questions.md</a>` +
          `, then Resume setup or remove the file when resolved.` +
        `</div>` +
        `<button type="button" class="primary" data-open-topic-setup>Resume setup</button>` +
      `</div>`;
  } else if (runBlocked) {
    setupNotice =
      `<div class="setup-banner" role="status">` +
        `<div class="setup-banner-text">` +
          `<strong>Needs setup.</strong> This topic has no research soul yet (thesis + sources). ` +
          `Complete setup before running.` +
        `</div>` +
        `<button type="button" class="primary" data-open-topic-setup>Complete setup</button>` +
      `</div>`;
  } else if (v.landscapeEmpty && (v.pendingRelatedCount ?? 0) > 0) {
    const n = v.pendingRelatedCount;
    const sample = (v.relatedPapers ?? []).find((p) => !p.integratedInTopic);
    const arxiv = sample?.canonicalId?.startsWith('arxiv:')
      ? sample.canonicalId.slice('arxiv:'.length)
      : '';
    setupNotice =
      `<div class="setup-banner landscape-empty" role="status">` +
        `<div class="setup-banner-text">` +
          `<strong>Landscape is empty.</strong> ` +
          `${n} Library paper${n === 1 ? '' : 's'} linked to this topic, but none are written into notes/landscape yet. ` +
          `Click <b>Run</b> to integrate the oldest linked candidate` +
          (arxiv ? ` (or <code>researcher add ${escapeHtml(arxiv)}</code>)` : '') +
          `, or open a paper under <b>Linked (Library)</b>.` +
        `</div>` +
      `</div>`;
  } else if (v.landscapeEmpty) {
    setupNotice =
      `<div class="setup-banner landscape-empty" role="status">` +
        `<div class="setup-banner-text">` +
          `<strong>Landscape is empty.</strong> ` +
          `No papers have been synthesized into this topic yet. Run discover, or link a Library paper and Run.` +
        `</div>` +
      `</div>`;
  }
  const setupModal = runBlocked ? renderTopicSetupModal(v) : '';
  const docTree = v.docs.map((d) =>
    `<li><a href="/t/${v.slug}/doc?path=${encodeURIComponent(d.path)}" class="doc-link" data-path="${encodeURIComponent(d.path)}">${escapeHtml(d.label)}</a></li>`
  ).join('');
  const noteGroups = (Object.keys(NOTE_ZONE_LABELS) as IntegratedZone[]).map((zone) => {
    const notes = v.notes
      .filter((n) => n.zone === zone)
      .slice()
      .sort((a, b) => Number(b.num) - Number(a.num));
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
  // A link is actionable before integration. Keep pending Library papers in the
  // left navigation, beside the local files, so linking has immediate feedback.
  const pendingRelated = related.filter((p) => !p.integratedInTopic);
  const pendingRelatedRows = pendingRelated.map((p) =>
    `<li><a href="/library/p/${encodeURIComponent(p.id)}" title="${escapeHtml(p.displayTitle)}">` +
      `${escapeHtml(p.displayTitle)}</a><span class="library-link-state">linked</span></li>`,
  ).join('');

  const runDisabled = runBlocked && !activeRun
    ? ` disabled title="Complete setup before running" aria-disabled="true"`
    : '';
  const runAttrs = activeRun
    ? ` data-active-task="${escapeHtml(activeRun.taskId)}" data-started-at="${activeRun.startedAt}"`
    : '';
  const runWrap =
    `<div class="run-wrap" id="run-wrap">` +
    `<button id="run-btn" data-slug="${v.slug}" data-run="/t/${v.slug}/run" aria-expanded="false"${runAttrs}${runDisabled}>Run</button>` +
    `<label class="run-discover-opt" title="When off, Run only integrates Library-linked papers">` +
      `<input id="run-discover" type="checkbox"> Discover new papers` +
    `</label>` +
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
    `<div class="topbar-actions">` +
      `<button id="right-toggle" class="panel-toggle" type="button" aria-expanded="false" aria-controls="right-panel" title="Toggle info panel">Info</button>` +
      `${runWrap}` +
    `</div></header>` +
    setupNotice +
    `<main class="three-col${related.length ? ' right-open' : ''}" id="cols" data-default-right-open="${related.length ? '1' : '0'}">` +
      `<aside class="left"><h3>Docs</h3><ul class="doc-tree">${docTree}</ul>` +
        (pendingRelated.length
          ? `<h3>Linked (Library) <span class="h3-count">${pendingRelated.length}</span></h3>` +
            `<ul class="paper-list library-link-list">${pendingRelatedRows}</ul>`
          : '') +
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
    setupModal +
    `<script${opts.openSetup && runBlocked ? ' data-auto-open-setup' : ''}>${TOPIC_JS}${runBlocked ? TOPIC_SETUP_JS : ''}</script>`;
  return page(`${v.path} · researcher`, body);
}

function renderTopicSetupModal(v: TopicView): string {
  return `<div id="topic-setup-modal" class="modal-backdrop" hidden>` +
    `<div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="topic-setup-title">` +
      `<div class="modal-head"><h2 id="topic-setup-title">Complete setup</h2>` +
      `<button class="icon-button" type="button" data-close-topic-setup aria-label="Close">x</button></div>` +
      `<div id="topic-setup-form-pane" class="modal-form">` +
        `<p class="modal-hint">AI drafts <code>thesis.md</code> and <code>project.yaml</code> from a short intent. You review before anything is written.</p>` +
        `<label><span>One-line intent</span>` +
          `<input id="setup-oneline" name="oneline" required value="${escapeHtml(v.oneline)}" placeholder="What is this pillar about?">` +
        `</label>` +
        `<label><span>Stake / decision <span class="muted">(optional)</span></span>` +
          `<textarea id="setup-stake" name="stake" rows="2" placeholder="Who decides, what is at stake, what artifact?"></textarea>` +
        `</label>` +
        `<label><span>Seed keywords <span class="muted">(optional)</span></span>` +
          `<input id="setup-seeds" name="seeds" placeholder="arxiv query phrases">` +
        `</label>` +
        `<label><span>Language</span>` +
          `<input id="setup-language" name="language" value="${escapeHtml(v.language || 'zh')}" placeholder="zh or en">` +
        `</label>` +
        `<p id="topic-setup-error" class="form-error" hidden></p>` +
        `<div class="modal-actions">` +
          `<button class="primary" type="button" id="topic-setup-generate">Generate draft</button>` +
        `</div>` +
      `</div>` +
      `<div id="topic-setup-review-pane" class="setup-review" hidden>` +
        `<div class="setup-review-scroll">` +
          `<p class="modal-hint">Review the draft, then apply to this topic repo.</p>` +
          `<h3 class="setup-review-h">Thesis</h3>` +
          `<div id="setup-thesis-preview" class="setup-md reader" tabindex="0"></div>` +
          `<h3 class="setup-review-h">project.yaml</h3>` +
          `<pre id="setup-yaml-preview" class="setup-code"></pre>` +
          `<p id="topic-setup-apply-error" class="form-error" hidden></p>` +
        `</div>` +
        `<div class="modal-actions setup-review-actions">` +
          `<button class="secondary" type="button" id="topic-setup-back">Back</button>` +
          `<button class="secondary" type="button" id="topic-setup-regen">Regenerate</button>` +
          `<button class="primary" type="button" id="topic-setup-apply">Apply</button>` +
        `</div>` +
      `</div>` +
    `</div>` +
  `</div>`;
}

const TOPIC_SETUP_JS = `
(function () {
  const modal = document.getElementById('topic-setup-modal');
  if (!modal) return;
  const openBtns = Array.from(document.querySelectorAll('[data-open-topic-setup]'));
  const closeBtn = document.querySelector('[data-close-topic-setup]');
  const formPane = document.getElementById('topic-setup-form-pane');
  const reviewPane = document.getElementById('topic-setup-review-pane');
  const errEl = document.getElementById('topic-setup-error');
  const applyErr = document.getElementById('topic-setup-apply-error');
  const genBtn = document.getElementById('topic-setup-generate');
  const applyBtn = document.getElementById('topic-setup-apply');
  const backBtn = document.getElementById('topic-setup-back');
  const regenBtn = document.getElementById('topic-setup-regen');
  const thesisPre = document.getElementById('setup-thesis-preview');
  const yamlPre = document.getElementById('setup-yaml-preview');
  let draft = null;
  const topicSlug = document.getElementById('run-btn')?.dataset.slug || '';

  function show() { modal.hidden = false; document.getElementById('setup-oneline')?.focus(); }
  function hide() { modal.hidden = true; showForm(); }
  function showForm() {
    formPane.hidden = false; reviewPane.hidden = true; draft = null;
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  }
  function showReview(d) {
    draft = d;
    // Prefer server-rendered HTML; fall back to escaped preformatted text.
    if (d.thesisHtml) thesisPre.innerHTML = d.thesisHtml;
    else thesisPre.textContent = d.thesisMd || '';
    yamlPre.textContent = d.projectYaml || '';
    formPane.hidden = true; reviewPane.hidden = false;
    if (applyErr) { applyErr.hidden = true; applyErr.textContent = ''; }
    // Reset scroll so the top of the thesis is visible.
    const sc = reviewPane.querySelector('.setup-review-scroll');
    if (sc) sc.scrollTop = 0;
    thesisPre.scrollTop = 0;
  }
  function formBody() {
    const fd = new URLSearchParams();
    fd.set('oneline', document.getElementById('setup-oneline')?.value?.trim() || '');
    fd.set('stake', document.getElementById('setup-stake')?.value?.trim() || '');
    fd.set('seeds', document.getElementById('setup-seeds')?.value?.trim() || '');
    fd.set('language', document.getElementById('setup-language')?.value?.trim() || '');
    return fd;
  }
  async function generate() {
    const fd = formBody();
    if (!fd.get('oneline')) {
      errEl.hidden = false; errEl.textContent = 'One-line intent is required.';
      return;
    }
    genBtn.disabled = true; genBtn.textContent = 'Generating…';
    errEl.hidden = true; errEl.textContent = '';
    try {
      const res = await fetch('/t/' + topicSlug + '/setup/generate', { method: 'POST', body: fd });
      const text = await res.text();
      if (!res.ok) throw new Error(text || ('HTTP ' + res.status));
      showReview(JSON.parse(text));
    } catch (e) {
      errEl.hidden = false; errEl.textContent = e.message || String(e);
    } finally {
      genBtn.disabled = false; genBtn.textContent = 'Generate draft';
    }
  }
  async function apply() {
    if (!draft) return;
    applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
    applyErr.hidden = true;
    try {
      const fd = new URLSearchParams();
      fd.set('oneline', document.getElementById('setup-oneline')?.value?.trim() || '');
      fd.set('projectYaml', draft.projectYaml);
      fd.set('thesisMd', draft.thesisMd);
      const res = await fetch('/t/' + topicSlug + '/setup/apply', { method: 'POST', body: fd, redirect: 'follow' });
      if (!res.ok) throw new Error(await res.text() || ('HTTP ' + res.status));
      window.location.href = '/t/' + topicSlug;
    } catch (e) {
      applyErr.hidden = false; applyErr.textContent = e.message || String(e);
      applyBtn.disabled = false; applyBtn.textContent = 'Apply';
    }
  }
  openBtns.forEach((b) => b.addEventListener('click', show));
  closeBtn?.addEventListener('click', hide);
  modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) hide();
  });
  genBtn?.addEventListener('click', generate);
  regenBtn?.addEventListener('click', () => { showForm(); generate(); });
  backBtn?.addEventListener('click', showForm);
  applyBtn?.addEventListener('click', apply);
  if (document.currentScript && document.currentScript.hasAttribute('data-auto-open-setup')) {
    show();
  } else if (new URLSearchParams(location.search).get('setup') === '1') {
    show();
  }
})();
`;

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
  let errStreak = 0;
  let settled = false;
  const settle = (label, cls, msg) => {
    if (settled) return;
    settled = true;
    try { es.close(); } catch {}
    if (msg) append(msg);
    finish(label, cls);
  };
  const es = new EventSource('/t/' + slug + '/run/' + taskId + '/stream');
  es.addEventListener('plan', (ev) => { errStreak = 0; plan = JSON.parse(ev.data).stages; renderStages(); setBtnLabel(); });
  es.addEventListener('stage', (ev) => { errStreak = 0; current = JSON.parse(ev.data).name; renderStages(); setBtnLabel(); });
  es.addEventListener('line', (ev) => { errStreak = 0; append(JSON.parse(ev.data) + '\\n'); });
  es.addEventListener('end', (ev) => {
    let data = {};
    try { data = JSON.parse(ev.data || '{}'); } catch {}
    if (data.endReason === 'unknown') {
      settle('gone', 'err', '\\n\\u2717 run task not found (serve may have restarted).\\n');
      return;
    }
    if (data.status === 'done' || data.exitCode === 0) {
      const outcome = data.outcome || '';
      const log = out.textContent || '';
      if (outcome === 'thin-signal' || /signal too thin|open_questions\\.md/i.test(log)) {
        settle('blocked', 'err', '\\n\\u26a0 soul too thin - open_questions.md written. Reloading...n');
        setTimeout(() => { location.reload(); }, 600);
        return;
      }
      if (outcome === 'no-candidate') {
        settle('no candidate', 'warn',
          '\\n\\u25cb no deep-read candidate this tick.\\n' +
          '   Landscape was NOT updated.\\n' +
          '   Link a Library paper or wait for discover hits, then Run again.\\n');
        return;
      }
      if (outcome === 'no-queries') {
        settle('no queries', 'warn',
          '\\n\\u25cb no arxiv queries configured - discover skipped.\\n' +
          '   Landscape was NOT updated.\\n');
        return;
      }
      if (outcome === 'all-integrated') {
        settle('all integrated', 'warn',
          '\\n\\u25cb All linked integrated.\\n' +
          '   Landscape was NOT updated.\\n' +
          '   Link another paper, or check Discover new papers and Run again.\\n');
        return;
      }
      if (outcome === 'nothing-to-run') {
        settle('nothing to run', 'warn',
          '\\n\\u25cb Nothing to run.\\n' +
          '   No pending linked Library paper and Discover is off.\\n' +
          '   Link a paper, or check Discover new papers and Run again.\\n');
        return;
      }
      settle('done', 'ok', '\\n\\u2713 run finished' + (outcome ? ' (' + outcome + ')' : '') + '.\\n');
      if (outcome === 'completed' || /deep-read:/i.test(log)) {
        setTimeout(() => { location.reload(); }, 800);
      }
    } else {
      settle('error', 'err', '\\n\\u2717 run failed' + (data.exitCode == null ? '' : ' (exit ' + data.exitCode + ')') + '.\\n');
    }
  });
  // EventSource auto-reconnects; stop after repeated errors so we never infinite-RUNNING.
  es.onerror = () => {
    errStreak++;
    if (es.readyState === EventSource.CLOSED || errStreak >= 3) {
      settle('disconnected', 'err', '\\n\\u2717 progress connection lost.\\n');
    }
  };
}

async function startRun() {
  out.textContent = ''; plan = null; current = null; stagesEl.innerHTML = ''; finished = false;
  openPop();
  running = true; runBtn.classList.add('is-running');
  statusEl.textContent = 'starting'; statusEl.className = 'run-status running';
  setBtnLabel();
  try {
    const discover = document.getElementById('run-discover')?.checked === true;
    const res = await fetch('/t/' + slug + '/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discover }),
    });
    if (res.status === 409) {
      let body = {};
      try { body = await res.json(); } catch {}
      if (body.error === 'setup_required') {
        append('Setup required before Run:\\n' + ((body.reasons || []).join('\\n') || 'complete setup first') + '\\n');
        finish('setup', 'err');
        document.querySelector('[data-open-topic-setup]')?.click();
        return;
      }
      append('A run is already in progress for this topic.\\n');
      finish('busy', 'err');
      return;
    }
    if (!res.ok) { append('Could not start run (HTTP ' + res.status + ').\\n'); finish('failed', 'err'); return; }
    const { taskId } = await res.json();
    append('\\u25b6 run started — model stages can be quiet for a few minutes.\\n   Watch for stage changes or new log lines; the timer alone is not a heartbeat.\\n\\n');
    subscribe(taskId, Date.now());
  } catch (err) {
    append('\\n\\u2717 ' + (err && err.message ? err.message : err) + '\\n');
    finish('error', 'err');
  }
}

if (runBtn) runBtn.addEventListener('click', () => {
  if (runBtn.disabled || runBtn.getAttribute('aria-disabled') === 'true') return;
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
