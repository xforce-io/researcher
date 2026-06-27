# researcher serve — Web Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `researcher serve` command that starts a local SSR web console over a workspace super-repo, showing each topic's research artifacts read-only and letting the user trigger `researcher run` per topic with live SSE logs.

**Architecture:** A thin SSR web layer in `src/web/` over the existing CLI. `discovery.ts` aggregates the manifest + each topic's `.researcher/` and artifacts into pure view models; `views.ts` renders models to HTML; `tasks.ts` runs `researcher run` as a per-topic-serial subprocess and streams stdout; `server.ts` wires them onto Node's built-in `http`. The real research work stays in each submodule's native `run` pipeline.

**Tech Stack:** TypeScript (ESM, NodeNext), Node built-in `http`, `marked` (new dep, markdown→HTML), `execa` (existing), `zod` (existing), vitest.

## Global Constraints

- ESM + NodeNext: every intra-repo import uses a `.js` extension (e.g. `./discovery.js`), matching the existing codebase.
- No web framework. HTTP via Node built-in `http` only.
- Exactly one new runtime dependency: `marked`. No other new deps.
- Reuse existing loaders — `loadWorkspaceManifest`, `loadProjectYaml`, `Seen`, `readWatermark`, `resolveProjectResearcherDir` — do not re-implement parsing.
- Server binds `127.0.0.1` only. No auth, no persistence of task history.
- `slug` = `encodeURIComponent(topic.path)`; decode before filesystem use.
- Tests follow the existing fixture style: `mkdtempSync(join(tmpdir(), ...))`, build a temp dir tree, assert, no network.

---

## File Structure

- `src/web/safe-path.ts` — path-traversal guards for `doc` and `paper` routes (pure).
- `src/web/discovery.ts` — read manifest + topic artifacts → `DashboardModel` / `TopicView` (read-only IO).
- `src/web/views.ts` — pure model→HTML functions + markdown rendering + escaping.
- `src/web/tasks.ts` — `TaskRegistry`: per-slug-serial subprocess run + ring-buffer + subscribe (only side-effectful unit).
- `src/web/server.ts` — `http` server, routing, static serving; `startServer(opts)`.
- `src/web/static/app.css` — ink-and-paper styling.
- `src/cli.ts` — add the `serve` subcommand (modify).
- Tests mirror under `tests/web/`.

---

### Task 1: Path-safety guards + `marked` dependency

**Files:**
- Create: `src/web/safe-path.ts`
- Test: `tests/web/safe-path.test.ts`
- Modify: `package.json` (add `marked` dependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `safeDocPath(topicDir: string, rel: string): string | null` — returns absolute path iff resolved path stays inside `topicDir`, ends in `.md`, and exists; else `null`.
  - `safePaperPath(topicDir: string, id: string): string | null` — returns absolute path of `papers/<id>.pdf` iff it resolves inside `topicDir` and exists; else `null`.

- [ ] **Step 1: Add `marked` and install**

Run:
```bash
cd /Users/xupeng/dev/github/researcher
npm install marked@^14
```
Expected: `package.json` `dependencies` now includes `"marked": "^14...."`; `npm ls marked` shows it resolved.

- [ ] **Step 2: Write the failing test**

Create `tests/web/safe-path.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeDocPath, safePaperPath } from '../../src/web/safe-path.js';

let topic: string;
beforeAll(() => {
  topic = mkdtempSync(join(tmpdir(), 'rsw-safe-'));
  mkdirSync(join(topic, 'notes'), { recursive: true });
  mkdirSync(join(topic, 'papers'), { recursive: true });
  writeFileSync(join(topic, 'notes', '01_a.md'), '# a');
  writeFileSync(join(topic, 'papers', '2401.00001.pdf'), '%PDF');
});

describe('safeDocPath', () => {
  it('accepts an existing .md inside the topic', () => {
    expect(safeDocPath(topic, 'notes/01_a.md')).toBe(join(topic, 'notes/01_a.md'));
  });
  it('rejects traversal outside the topic', () => {
    expect(safeDocPath(topic, '../../etc/passwd')).toBeNull();
  });
  it('rejects non-.md files', () => {
    expect(safeDocPath(topic, 'papers/2401.00001.pdf')).toBeNull();
  });
  it('rejects a missing file', () => {
    expect(safeDocPath(topic, 'notes/zzz.md')).toBeNull();
  });
});

describe('safePaperPath', () => {
  it('accepts an existing pdf by id', () => {
    expect(safePaperPath(topic, '2401.00001')).toBe(join(topic, 'papers/2401.00001.pdf'));
  });
  it('rejects traversal in id', () => {
    expect(safePaperPath(topic, '../notes/01_a')).toBeNull();
  });
  it('rejects a missing pdf', () => {
    expect(safePaperPath(topic, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/web/safe-path.test.ts`
Expected: FAIL — cannot resolve `../../src/web/safe-path.js`.

- [ ] **Step 4: Write minimal implementation**

Create `src/web/safe-path.ts`:
```ts
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** True iff `child` is `base` or strictly inside it (after symlink-free resolve). */
function isInside(base: string, child: string): boolean {
  const b = resolve(base);
  const c = resolve(child);
  return c === b || c.startsWith(b + sep);
}

/** Absolute path of a `.md` doc inside the topic, or null if unsafe/missing. */
export function safeDocPath(topicDir: string, rel: string): string | null {
  const abs = resolve(topicDir, rel);
  if (!isInside(topicDir, abs)) return null;
  if (!abs.endsWith('.md')) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

/** Absolute path of `papers/<id>.pdf` inside the topic, or null if unsafe/missing. */
export function safePaperPath(topicDir: string, id: string): string | null {
  const abs = resolve(topicDir, 'papers', `${id}.pdf`);
  if (!isInside(topicDir, abs)) return null;
  if (!existsSync(abs)) return null;
  return abs;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/web/safe-path.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/web/safe-path.ts tests/web/safe-path.test.ts
git commit -m "feat(web): path-safety guards + marked dep (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Discovery — view models

**Files:**
- Create: `src/web/discovery.ts`
- Test: `tests/web/discovery.test.ts`

**Interfaces:**
- Consumes: `loadWorkspaceManifest`, `resolveWorkspaceManifestPath`, `WORKSPACE_MANIFEST` from `../workspace/manifest.js`; `loadProjectYaml` from `../config/project-yaml.js`; `Seen`, `SeenEntry` from `../state/seen.js`; `readWatermark`, `Watermark` from `../state/watermark.js`; `resolveProjectResearcherDir` from `../paths.js`.
- Produces:
  - Types `TopicCard`, `DashboardModel`, `DocRef`, `SourceSummary`, `TopicView` (shapes below).
  - `loadDashboard(root: string): DashboardModel`
  - `loadTopic(root: string, slug: string): TopicView | null` — `null` if slug not in manifest.

- [ ] **Step 1: Write the failing test**

Create `tests/web/discovery.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDashboard, loadTopic } from '../../src/web/discovery.js';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rsw-disc-'));
  writeFileSync(join(root, 'researcher.workspace.yml'),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n  - { path: decision, active: false }\n');

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
});

describe('loadDashboard', () => {
  it('lists all topics with active/available flags', () => {
    const m = loadDashboard(root);
    expect(m.topics.map((t) => t.path)).toEqual(['trace', 'decision']);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/discovery.test.ts`
Expected: FAIL — cannot resolve `../../src/web/discovery.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/discovery.ts`:
```ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../workspace/manifest.js';
import { loadProjectYaml } from '../config/project-yaml.js';
import { Seen, type SeenEntry } from '../state/seen.js';
import { readWatermark, type Watermark } from '../state/watermark.js';
import { resolveProjectResearcherDir } from '../paths.js';

export interface TopicCard {
  slug: string;
  path: string;
  active: boolean;
  available: boolean;
  oneline: string;
  paperCount: number;
  lastRun: string | null;
  decisionCounts: { 'deep-read': number; skim: number; reject: number };
}
export interface DashboardModel {
  root: string;
  topics: TopicCard[];
}
export interface DocRef { path: string; label: string; }
export interface SourceSummary { kind: string; summary: string; }
export interface TopicView {
  slug: string;
  path: string;
  available: boolean;
  oneline: string;
  language: string;
  sources: SourceSummary[];
  researchQuestions: { id: string; text: string }[];
  docs: DocRef[];
  papers: { id: string; file: string }[];
  seen: SeenEntry[];
  watermark: Watermark | null;
}

const slugOf = (p: string) => encodeURIComponent(p);

function isAvailable(topicDir: string): boolean {
  return existsSync(topicDir) && existsSync(resolveProjectResearcherDir(topicDir));
}

function readSeen(topicDir: string): SeenEntry[] {
  const path = join(resolveProjectResearcherDir(topicDir), 'state/seen.jsonl');
  if (!existsSync(path)) return [];
  const out: SeenEntry[] = [];
  const seen = new Seen(path);
  // Seen has no iterator; re-read is overkill — expose entries via a small read here.
  for (const line of (await0(path))) out.push(line);
  return out;
}

// Local minimal JSONL reader (Seen validates+indexes but doesn't expose a list).
function await0(path: string): SeenEntry[] {
  const { readFileSync } = require('node:fs');
  const { SeenEntrySchema } = require('../state/seen.js');
  const res: SeenEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    res.push(SeenEntrySchema.parse(JSON.parse(line)));
  }
  return res;
}

function listPdfs(topicDir: string): { id: string; file: string }[] {
  const dir = join(topicDir, 'papers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.pdf'))
    .sort()
    .map((f) => ({ id: f.replace(/\.pdf$/, ''), file: `papers/${f}` }));
}

function listNoteNotes(topicDir: string): DocRef[] {
  const dir = join(topicDir, 'notes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d\d_.*\.md$/.test(f))     // NN_*.md, excludes 00_research_landscape
    .filter((f) => f !== '00_research_landscape.md')
    .sort()
    .map((f) => ({ path: `notes/${f}`, label: f }));
}

function buildDocs(topicDir: string): DocRef[] {
  const docs: DocRef[] = [];
  const add = (rel: string, label: string) => {
    if (existsSync(join(topicDir, rel))) docs.push({ path: rel, label });
  };
  add('.researcher/thesis.md', 'Thesis');
  add('notes/00_research_landscape.md', 'Landscape');
  add('report.md', 'Report');
  docs.push(...listNoteNotes(topicDir));
  return docs;
}

function sourceSummary(s: { kind: string; queries?: string[]; inbox_dir?: string }): SourceSummary {
  if (s.kind === 'x-inbox') return { kind: s.kind, summary: s.inbox_dir ?? '(no inbox_dir)' };
  return { kind: s.kind, summary: (s.queries ?? []).join(', ') };
}

export function loadDashboard(root: string): DashboardModel {
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  const topics: TopicCard[] = manifest.topics.map((t) => {
    const topicDir = join(root, t.path);
    const available = isAvailable(topicDir);
    let oneline = '';
    const counts = { 'deep-read': 0, skim: 0, reject: 0 } as TopicCard['decisionCounts'];
    let lastRun: string | null = null;
    if (available) {
      const rDir = resolveProjectResearcherDir(topicDir);
      try { oneline = loadProjectYaml(join(rDir, 'project.yaml')).meta.topic_oneline ?? ''; } catch { /* leave blank */ }
      for (const e of readSeen(topicDir)) counts[e.decision]++;
      lastRun = readWatermark(join(rDir, 'state/watermark.json'))?.last_run_completed_at ?? null;
    }
    return {
      slug: slugOf(t.path), path: t.path, active: t.active, available,
      oneline, paperCount: listPdfs(topicDir).length, lastRun, decisionCounts: counts,
    };
  });
  return { root, topics };
}

export function loadTopic(root: string, slug: string): TopicView | null {
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  const decoded = decodeURIComponent(slug);
  const topic = manifest.topics.find((t) => t.path === decoded);
  if (!topic) return null;
  const topicDir = join(root, topic.path);
  const available = isAvailable(topicDir);
  if (!available) {
    return {
      slug, path: topic.path, available: false, oneline: '', language: '',
      sources: [], researchQuestions: [], docs: [], papers: [], seen: [], watermark: null,
    };
  }
  const rDir = resolveProjectResearcherDir(topicDir);
  let oneline = '', language = '', sources: SourceSummary[] = [], rqs: { id: string; text: string }[] = [];
  try {
    const py = loadProjectYaml(join(rDir, 'project.yaml'));
    oneline = py.meta.topic_oneline ?? '';
    language = py.meta.language;
    sources = py.sources.map(sourceSummary);
    rqs = py.research_questions;
  } catch { /* partial topic: leave config-derived fields empty */ }
  return {
    slug, path: topic.path, available: true, oneline, language,
    sources, researchQuestions: rqs,
    docs: buildDocs(topicDir),
    papers: listPdfs(topicDir),
    seen: readSeen(topicDir),
    watermark: readWatermark(join(rDir, 'state/watermark.json')),
  };
}
```

> Note for implementer: `Seen` indexes but does not expose its entries as a list. Rather than the `require`-based shim sketched above, add a clean reader: in `src/state/seen.ts` add a method `entries(): SeenEntry[] { return [...this.index.values()]; }`, then in `discovery.ts` replace `readSeen` with:
> ```ts
> function readSeen(topicDir: string): SeenEntry[] {
>   const path = join(resolveProjectResearcherDir(topicDir), 'state/seen.jsonl');
>   if (!existsSync(path)) return [];
>   return new Seen(path).entries();
> }
> ```
> Delete the `await0` shim. Adding `entries()` keeps a single JSONL parser (DRY). Commit the `seen.ts` change with this task.

- [ ] **Step 4: Add `entries()` to `Seen` and finalize `readSeen`**

Modify `src/state/seen.ts` — add inside the `Seen` class:
```ts
  entries(): SeenEntry[] {
    return [...this.index.values()];
  }
```
Then in `src/web/discovery.ts` use the clean `readSeen` from the note above and remove the `await0` shim and its call.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/web/discovery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/web/discovery.ts src/state/seen.ts tests/web/discovery.test.ts
git commit -m "feat(web): discovery view models for dashboard + topic (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Views — HTML rendering

**Files:**
- Create: `src/web/views.ts`
- Test: `tests/web/views.test.ts`

**Interfaces:**
- Consumes: `DashboardModel`, `TopicView` from `./discovery.js`; `marked` from `marked`.
- Produces:
  - `escapeHtml(s: string): string`
  - `renderDoc(markdown: string): string` — fragment HTML from markdown.
  - `renderDashboard(m: DashboardModel): string` — full HTML page.
  - `renderTopic(v: TopicView): string` — full HTML page (left doc tree, empty reader pane, right meta, Run button).

- [ ] **Step 1: Write the failing test**

Create `tests/web/views.test.ts`:
```ts
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
});

describe('renderDashboard', () => {
  const m: DashboardModel = {
    root: '/ws',
    topics: [
      { slug: 'trace', path: 'trace', active: true, available: true, oneline: 'triage <x>',
        paperCount: 3, lastRun: '2026-06-20T10:00:00Z', decisionCounts: { 'deep-read': 1, skim: 2, reject: 0 } },
      { slug: 'decision', path: 'decision', active: false, available: false, oneline: '',
        paperCount: 0, lastRun: null, decisionCounts: { 'deep-read': 0, skim: 0, reject: 0 } },
    ],
  };
  it('lists topic paths and links to detail pages', () => {
    const html = renderDashboard(m);
    expect(html).toContain('/t/trace');
    expect(html).toContain('triage &lt;x&gt;');     // escaped
    expect(html).toMatch(/dormant|inactive/i);       // dormant marker for decision
    expect(html).toMatch(/unavailable|missing/i);    // unavailable marker
  });
});

describe('renderTopic', () => {
  const v: TopicView = {
    slug: 'trace', path: 'trace', available: true, oneline: 'triage', language: 'zh',
    sources: [{ kind: 'arxiv', summary: 'agent' }],
    researchQuestions: [{ id: 'RQ1', text: 'how' }],
    docs: [{ path: '.researcher/thesis.md', label: 'Thesis' }],
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
  });
  it('shows an unavailable notice when topic has no .researcher', () => {
    const html = renderTopic({ ...v, available: false, docs: [], papers: [], seen: [], sources: [], researchQuestions: [] });
    expect(html).toMatch(/unavailable|missing/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/views.test.ts`
Expected: FAIL — cannot resolve `../../src/web/views.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/views.ts`:
```ts
import { marked } from 'marked';
import type { DashboardModel, TopicView } from './discovery.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      ? `<a class="card-title" href="/t/${encodeURIComponent(t.slug)}">${escapeHtml(t.path)}</a>`
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

export function renderTopic(v: TopicView): string {
  if (!v.available) {
    const body = `<header class="topbar"><a class="brand" href="/">researcher</a>` +
      `<span class="root">${escapeHtml(v.path)}</span></header>` +
      `<main class="notice">Topic unavailable — submodule missing or no .researcher/.</main>`;
    return page(`${v.path} · unavailable`, body);
  }
  const docTree = v.docs.map((d) =>
    `<li><a href="#" class="doc-link" data-path="${encodeURIComponent(d.path)}">${escapeHtml(d.label)}</a></li>`
  ).join('');
  const paperList = v.papers.map((p) =>
    `<li><a href="/t/${encodeURIComponent(v.slug)}/paper?id=${encodeURIComponent(p.id)}" target="_blank">${escapeHtml(p.id)}</a></li>`
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

  const body =
    `<header class="topbar"><a class="brand" href="/">researcher</a>` +
    `<span class="root">${escapeHtml(v.path)}</span>` +
    `<button id="run-btn" data-slug="${encodeURIComponent(v.slug)}">Run</button></header>` +
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
    `<div id="run-log" class="run-log" hidden><pre id="run-out"></pre></div>` +
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/views.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/views.ts tests/web/views.test.ts
git commit -m "feat(web): SSR views for dashboard + topic (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Task registry — run subprocess + SSE buffer

**Files:**
- Create: `src/web/tasks.ts`
- Test: `tests/web/tasks.test.ts`

**Interfaces:**
- Consumes: `execa` (only in the default runner).
- Produces:
  - `type Runner = (cwd: string, onLine: (line: string) => void) => Promise<number>` (resolves process exit code).
  - `interface RunTask { id: string; slug: string; lines: string[]; status: 'running' | 'done' | 'error'; exitCode: number | null; }`
  - `class TaskRegistry` with:
    - `constructor(opts?: { runner?: Runner; bufferLines?: number; idSeq?: () => string })`
    - `isBusy(slug: string): boolean`
    - `start(slug: string, cwd: string): RunTask` — throws `Error('busy')` if `isBusy(slug)`.
    - `get(id: string): RunTask | undefined`
    - `subscribe(id: string, onLine: (line: string) => void, onEnd: (t: RunTask) => void): () => void` — replays buffered lines immediately, then live; returns unsubscribe. If task already ended, calls `onEnd` after replay.

- [ ] **Step 1: Write the failing test**

Create `tests/web/tasks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TaskRegistry, type Runner } from '../../src/web/tasks.js';

// A controllable fake runner: emits the given lines then exits with `code`.
function fakeRunner(lines: string[], code = 0, delayMs = 0): Runner {
  return async (_cwd, onLine) => {
    for (const l of lines) { onLine(l); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); }
    return code;
  };
}

let seq = 0;
const idSeq = () => `t${++seq}`;

describe('TaskRegistry', () => {
  it('runs a task and buffers lines, then marks done', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['a', 'b'], 0), idSeq });
    const task = reg.start('trace', '/ws/trace');
    expect(task.status).toBe('running');
    await new Promise((r) => setTimeout(r, 10));
    const t = reg.get(task.id)!;
    expect(t.lines).toEqual(['a', 'b']);
    expect(t.status).toBe('done');
    expect(t.exitCode).toBe(0);
  });

  it('rejects a concurrent start for the same slug', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    reg.start('trace', '/ws/trace');
    expect(reg.isBusy('trace')).toBe(true);
    expect(() => reg.start('trace', '/ws/trace')).toThrow('busy');
  });

  it('allows different slugs concurrently', () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['x'], 0, 50), idSeq });
    reg.start('a', '/ws/a');
    expect(() => reg.start('b', '/ws/b')).not.toThrow();
  });

  it('replays buffered lines and signals end to a late subscriber', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['one', 'two'], 0), idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    const got: string[] = []; let ended = false;
    reg.subscribe(task.id, (l) => got.push(l), () => { ended = true; });
    expect(got).toEqual(['one', 'two']);
    expect(ended).toBe(true);
  });

  it('marks status error on nonzero exit', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['boom'], 1), idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    expect(reg.get(task.id)!.status).toBe('error');
    expect(reg.get(task.id)!.exitCode).toBe(1);
  });

  it('caps the ring buffer at bufferLines', async () => {
    const reg = new TaskRegistry({ runner: fakeRunner(['1', '2', '3', '4'], 0), bufferLines: 2, idSeq });
    const task = reg.start('trace', '/ws/trace');
    await new Promise((r) => setTimeout(r, 10));
    expect(reg.get(task.id)!.lines).toEqual(['3', '4']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/tasks.test.ts`
Expected: FAIL — cannot resolve `../../src/web/tasks.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/web/tasks.ts`:
```ts
import { execa } from 'execa';

export type Runner = (cwd: string, onLine: (line: string) => void) => Promise<number>;

export interface RunTask {
  id: string;
  slug: string;
  lines: string[];
  status: 'running' | 'done' | 'error';
  exitCode: number | null;
}

interface Listener { onLine: (line: string) => void; onEnd: (t: RunTask) => void; }

let globalSeq = 0;
const defaultIdSeq = () => `task-${++globalSeq}`;

/** Default runner: spawn this CLI's `run` as a subprocess and stream stdout lines. */
export function defaultRunner(cliEntry: string): Runner {
  return async (cwd, onLine) => {
    const child = execa(process.execPath, [cliEntry, 'run'], { cwd, all: true, reject: false });
    let buf = '';
    child.all?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    const res = await child;
    if (buf.length) onLine(buf);
    return res.exitCode ?? 0;
  };
}

export class TaskRegistry {
  private readonly runner: Runner;
  private readonly bufferLines: number;
  private readonly idSeq: () => string;
  private readonly tasks = new Map<string, RunTask>();
  private readonly busy = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(opts?: { runner?: Runner; bufferLines?: number; idSeq?: () => string }) {
    this.runner = opts?.runner ?? defaultRunner(process.argv[1] ?? '');
    this.bufferLines = opts?.bufferLines ?? 2000;
    this.idSeq = opts?.idSeq ?? defaultIdSeq;
  }

  isBusy(slug: string): boolean {
    return this.busy.has(slug);
  }

  start(slug: string, cwd: string): RunTask {
    if (this.isBusy(slug)) throw new Error('busy');
    const task: RunTask = { id: this.idSeq(), slug, lines: [], status: 'running', exitCode: null };
    this.tasks.set(task.id, task);
    this.busy.add(slug);
    this.listeners.set(task.id, new Set());

    const onLine = (line: string) => {
      task.lines.push(line);
      if (task.lines.length > this.bufferLines) task.lines.shift();
      for (const l of this.listeners.get(task.id) ?? []) l.onLine(line);
    };
    this.runner(cwd, onLine)
      .then((code) => this.finish(task, code))
      .catch(() => this.finish(task, 1));
    return task;
  }

  private finish(task: RunTask, code: number): void {
    task.exitCode = code;
    task.status = code === 0 ? 'done' : 'error';
    this.busy.delete(task.slug);
    for (const l of this.listeners.get(task.id) ?? []) l.onEnd(task);
  }

  get(id: string): RunTask | undefined {
    return this.tasks.get(id);
  }

  subscribe(id: string, onLine: (line: string) => void, onEnd: (t: RunTask) => void): () => void {
    const task = this.tasks.get(id);
    if (!task) return () => {};
    for (const l of task.lines) onLine(l);              // replay buffer
    if (task.status !== 'running') { onEnd(task); return () => {}; }
    const listener: Listener = { onLine, onEnd };
    this.listeners.get(id)!.add(listener);
    return () => this.listeners.get(id)?.delete(listener);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/tasks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/tasks.ts tests/web/tasks.test.ts
git commit -m "feat(web): per-topic-serial run task registry with SSE buffer (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: HTTP server + routing + `serve` CLI command + CSS

**Files:**
- Create: `src/web/server.ts`
- Create: `src/web/static/app.css`
- Test: `tests/web/server.test.ts`
- Modify: `src/cli.ts` (add `serve` subcommand)
- Modify: `README.md` (document `researcher serve`)

**Interfaces:**
- Consumes: `loadDashboard`, `loadTopic` from `./discovery.js`; `renderDashboard`, `renderTopic`, `renderDoc` from `./views.js`; `safeDocPath`, `safePaperPath` from `./safe-path.js`; `TaskRegistry` from `./tasks.js`; `resolveProjectResearcherDir` from `../paths.js`; `WORKSPACE_MANIFEST`, `resolveWorkspaceManifestPath` from `../workspace/manifest.js`; `marked`/views for doc rendering.
- Produces:
  - `interface ServeOptions { root: string; port: number; registry?: TaskRegistry }`
  - `startServer(opts: ServeOptions): Promise<{ port: number; close: () => Promise<void> }>` — resolves once listening; `root` must contain `researcher.workspace.yml` (throws otherwise before listen).

- [ ] **Step 1: Write the failing test**

Create `tests/web/server.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/web/server.js';
import { TaskRegistry } from '../../src/web/tasks.js';

let root: string;
let server: { port: number; close: () => Promise<void> };
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'rsw-srv-'));
  writeFileSync(join(root, 'researcher.workspace.yml'),
    'version: 1\ntopics:\n  - { path: trace, active: true }\n');
  const trace = join(root, 'trace');
  mkdirSync(join(trace, '.researcher/state'), { recursive: true });
  writeFileSync(join(trace, '.researcher/project.yaml'),
    'meta:\n  topic_oneline: t\n  language: zh\nresearch_questions:\n  - { id: RQ1, text: how }\n' +
    'inclusion_criteria: []\nexclusion_criteria: []\nsources:\n  - { kind: arxiv, queries: [a] }\n' +
    'cadence:\n  default_interval_days: 7\n  backoff_after_empty_runs: 3\n');
  writeFileSync(join(trace, '.researcher/thesis.md'), '# Thesis\n\nbody');
  // a registry with a fake runner so POST /run never spawns a real process
  const registry = new TaskRegistry({ runner: async (_c, onLine) => { onLine('hello'); return 0; }, idSeq: (() => { let n = 0; return () => `t${++n}`; })() });
  server = await startServer({ root, port: 0, registry });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server.close(); });

it('serves the dashboard at /', async () => {
  const res = await fetch(base + '/');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('/t/trace');
});

it('serves a topic page', async () => {
  const res = await fetch(base + '/t/trace');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Thesis');
});

it('renders a safe doc and 404s a traversal', async () => {
  const ok = await fetch(base + '/t/trace/doc?path=' + encodeURIComponent('.researcher/thesis.md'));
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain('<h1>Thesis</h1>');
  const bad = await fetch(base + '/t/trace/doc?path=' + encodeURIComponent('../../etc/passwd'));
  expect(bad.status).toBe(404);
});

it('starts a run and streams via SSE', async () => {
  const res = await fetch(base + '/t/trace/run', { method: 'POST' });
  expect(res.status).toBe(200);
  const { taskId } = await res.json();
  const sse = await fetch(base + `/t/trace/run/${taskId}/stream`);
  const text = await sse.text();
  expect(text).toContain('hello');
  expect(text).toContain('event: end');
});

it('serves css', async () => {
  const res = await fetch(base + '/static/app.css');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/css');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/server.test.ts`
Expected: FAIL — cannot resolve `../../src/web/server.js`.

- [ ] **Step 3: Write the CSS**

Create `src/web/static/app.css`:
```css
:root { --paper:#faf8f3; --ink:#23211c; --muted:#8a8madd; --line:#e3ddd0; --accent:#4a7c59; }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.6 -apple-system,system-ui,"Segoe UI",sans-serif; color:var(--ink); background:var(--paper); }
.topbar { display:flex; align-items:center; gap:16px; padding:10px 18px; border-bottom:1px solid var(--line); }
.brand { font-weight:700; text-decoration:none; color:var(--ink); }
.root { color:#9b9688; font-size:13px; }
#run-btn { margin-left:auto; padding:6px 14px; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:5px; cursor:pointer; }
#run-btn:disabled { opacity:.5; cursor:default; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; padding:18px; }
.card { border:1px solid var(--line); border-radius:8px; padding:14px; background:#fff; }
.card-disabled { opacity:.55; }
.card-title { font-weight:600; text-decoration:none; color:var(--accent); }
.card-oneline { margin:6px 0; color:#55514a; }
.card-meta { font-size:12px; color:#9b9688; }
.tag { font-size:11px; padding:1px 6px; border-radius:10px; }
.tag.dormant { background:#efe9da; color:#857c63; }
.tag.missing { background:#f3dada; color:#9b3a3a; }
.three-col { display:grid; grid-template-columns:220px 1fr 300px; gap:0; height:calc(100vh - 49px); }
.left,.right { padding:14px; overflow:auto; border-right:1px solid var(--line); }
.right { border-right:none; border-left:1px solid var(--line); }
.reader { padding:22px 28px; overflow:auto; }
.doc-tree,.paper-list { list-style:none; padding:0; margin:0 0 14px; }
.doc-tree a { text-decoration:none; color:var(--accent); display:block; padding:3px 0; }
.seen { width:100%; font-size:12px; border-collapse:collapse; }
.seen td,.seen th { border-bottom:1px solid var(--line); text-align:left; padding:3px 4px; vertical-align:top; }
.run-log { position:fixed; bottom:0; left:0; right:0; max-height:40vh; overflow:auto; background:#1c1a16; color:#d8d2c4; }
.run-log pre { margin:0; padding:12px 16px; font:12px/1.5 ui-monospace,monospace; white-space:pre-wrap; }
.notice { padding:40px; color:#9b3a3a; }
.hint { color:#9b9688; }
```

- [ ] **Step 4: Write the server**

Create `src/web/server.ts`:
```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadTopic } from './discovery.js';
import { renderDashboard, renderTopic, renderDoc } from './views.js';
import { safeDocPath, safePaperPath } from './safe-path.js';
import { TaskRegistry } from './tasks.js';
import { resolveWorkspaceManifestPath } from '../workspace/manifest.js';

export interface ServeOptions { root: string; port: number; registry?: TaskRegistry; }

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

export async function startServer(opts: ServeOptions): Promise<{ port: number; close: () => Promise<void> }> {
  if (!existsSync(resolveWorkspaceManifestPath(opts.root))) {
    throw new Error(`no researcher.workspace.yml in ${opts.root} — serve requires a workspace super-repo`);
  }
  const registry = opts.registry ?? new TaskRegistry();

  const server = createServer((req, res) => {
    handle(req, res, opts.root, registry).catch((err) => {
      send(res, 500, 'text/plain', String(err instanceof Error ? err.message : err));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

async function handle(req: IncomingMessage, res: ServerResponse, root: string, registry: TaskRegistry): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  // GET /
  if (req.method === 'GET' && path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderDashboard(loadDashboard(root)));
  }
  // GET /static/app.css
  if (req.method === 'GET' && path === '/static/app.css') {
    const f = join(STATIC_DIR, 'app.css');
    if (!existsSync(f)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/css; charset=utf-8', readFileSync(f));
  }

  const m = path.match(/^\/t\/([^/]+)(\/doc|\/paper|\/run(?:\/([^/]+)\/stream)?)?$/);
  if (m) {
    const slug = m[1];
    const sub = m[2];
    const taskId = m[3];
    const decoded = decodeURIComponent(slug);
    const topicDir = join(root, decoded);

    // GET /t/:slug
    if (req.method === 'GET' && !sub) {
      const view = loadTopic(root, slug);
      if (!view) return send(res, 404, 'text/plain', 'unknown topic');
      return send(res, 200, 'text/html; charset=utf-8', renderTopic(view));
    }
    // GET /t/:slug/doc?path=...
    if (req.method === 'GET' && sub === '/doc') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = safeDocPath(topicDir, decodeURIComponent(rel));
      if (!abs) return send(res, 404, 'text/plain', 'not found');
      return send(res, 200, 'text/html; charset=utf-8', renderDoc(readFileSync(abs, 'utf8')));
    }
    // GET /t/:slug/paper?id=...
    if (req.method === 'GET' && sub === '/paper') {
      const id = url.searchParams.get('id') ?? '';
      const abs = safePaperPath(topicDir, decodeURIComponent(id));
      if (!abs) return send(res, 404, 'text/plain', 'not found');
      return send(res, 200, 'application/pdf', readFileSync(abs));
    }
    // POST /t/:slug/run
    if (req.method === 'POST' && sub === '/run') {
      if (registry.isBusy(decoded)) return send(res, 409, 'application/json', JSON.stringify({ error: 'busy' }));
      const task = registry.start(decoded, topicDir);
      return send(res, 200, 'application/json', JSON.stringify({ taskId: task.id }));
    }
    // GET /t/:slug/run/:taskId/stream  (SSE)
    if (req.method === 'GET' && taskId) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const unsub = registry.subscribe(
        taskId,
        (line) => res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`),
        () => { res.write(`event: end\ndata: {}\n\n`); res.end(); },
      );
      req.on('close', unsub);
      return;
    }
  }

  send(res, 404, 'text/plain', 'not found');
}
```

> Note on the SSE test: with a fast fake runner the task ends before subscribe, so `subscribe` replays the buffered line then immediately calls `onEnd`, which writes `event: end` and `res.end()` — the test's `await sse.text()` resolves. With a real subprocess the same path streams live.

- [ ] **Step 5: Run server test to verify it passes**

Run: `npx vitest run tests/web/server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Add the `serve` CLI command**

Modify `src/cli.ts` — add after the `run` command block (before `program.parseAsync`):
```ts
program
  .command('serve [path]')
  .description('Start a local web console over a workspace super-repo (researcher.workspace.yml)')
  .option('-p, --port <port>', 'port to listen on', '4500')
  .action(async (path: string | undefined, opts: { port: string }) => {
    const root = path ? (await import('node:path')).resolve(path) : process.cwd();
    const { startServer } = await import('./web/server.js');
    const { port } = await startServer({ root, port: Number(opts.port) });
    process.stdout.write(`researcher web console → http://127.0.0.1:${port}  (root: ${root})\n`);
  });
```

- [ ] **Step 7: Build and smoke-check the command wiring**

Run:
```bash
npm run build
node dist/cli.js serve --help
```
Expected: build succeeds; help shows `serve [path]` with `--port` option.

- [ ] **Step 8: Document in README**

Modify `README.md` — add a short section near the other commands:
```markdown
### `researcher serve [path]`

Start a local read-only web console over a workspace super-repo (a directory with
`researcher.workspace.yml`). Lists each topic, renders its thesis / landscape /
report / notes, and lets you trigger `researcher run` per topic with live logs.

```bash
researcher serve                 # serves the current super-repo on :4500
researcher serve ../research -p 8080
```

Binds `127.0.0.1` only; no auth. v1 is read-only plus run-triggering.
```

- [ ] **Step 9: Full test suite + commit**

Run: `npx vitest run`
Expected: all tests pass (existing + new `tests/web/*`).

```bash
git add src/web/server.ts src/web/static/app.css tests/web/server.test.ts src/cli.ts README.md
git commit -m "feat(web): http server, routes, serve command + css (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `serve` CLI command, workspace-only, `--port`, binds 127.0.0.1 → Task 5.
- `marked` as sole new dep → Task 1.
- Discovery of manifest topics + active/dormant/unavailable + artifacts aggregation → Task 2.
- Dashboard, topic detail (doc tree / reader / meta), doc render, paper inline → Tasks 3 + 5.
- Path-safety white-listing for doc/paper → Task 1 + enforced in Task 5 routes.
- Trigger run as per-topic-serial subprocess + SSE + 409 busy + ~2000-line ring buffer → Tasks 4 + 5.
- Non-goals (no edit/auth/persistence) → respected; no tasks add them.
- Tests for discovery, views, safe-path, tasks (fake runner), server smoke → Tasks 1-5.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one `await0`/`require` shim in Task 2 Step 3 is explicitly replaced by `Seen.entries()` in Task 2 Step 4 (called out in the note).

**Type consistency:** `RunTask`, `Runner`, `TaskRegistry` signatures identical across Tasks 4 and 5. `DashboardModel`/`TopicView`/`DocRef`/`SourceSummary` defined in Task 2, consumed unchanged in Tasks 3 and 5. `safeDocPath`/`safePaperPath` signatures identical in Tasks 1 and 5. SSE event names (`line`, `end`) match between server (Task 5) and the client JS (Task 3 `TOPIC_JS`).
