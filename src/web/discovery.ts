import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { loadWorkspaceManifest, resolveWorkspaceManifestPath } from '../workspace/manifest.js';
import { loadProjectYaml } from '../config/project-yaml.js';
import { Seen, type SeenEntry } from '../state/seen.js';
import { readWatermark, type Watermark } from '../state/watermark.js';
import { resolveProjectResearcherDir } from '../paths.js';
import { listIntegratedNotes } from '../state/note_index.js';
import type { Zone } from '../state/zone.js';
import { PaperLibrary } from '../library/store.js';
import type { Paper, PaperRead, PaperRelation, PaperSurfaceLink, TopicIntegration } from '../library/model.js';

export interface TopicCard {
  slug: string;
  path: string;
  active: boolean;
  available: boolean;
  oneline: string;
  noteCount: number;
  lastRun: string | null;
  decisionCounts: { 'deep-read': number; skim: number; reject: number };
}
export interface DashboardModel {
  root: string;
  topics: TopicCard[];
}
export interface DocRef { path: string; label: string; }
export interface NoteRef {
  path: string;
  num: string;
  title: string;
  zone: Zone;
  pin: boolean;
  score: number;
  dwell: number;
}
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
  notes: NoteRef[];
  papers: { id: string; file: string }[];
  relatedPapers?: LibraryPaperSummary[];
  seen: SeenEntry[];
  watermark: Watermark | null;
}
export interface LibraryTopicRef {
  slug: string;
  path: string;
  active: boolean;
  available: boolean;
}
export interface LibraryPaperSummary {
  id: string;
  displayTitle: string;
  canonicalId: string;
  sourceLabel: string;
  tags: string[];
  readStatus: PaperRead['status'] | 'unread';
  linkedTopicCount: number;
  integratedTopicCount: number;
  updatedAt: string;
  relation?: PaperRelation;
}
export interface LibraryView {
  root: string;
  topics: LibraryTopicRef[];
  papers: LibraryPaperSummary[];
  selectedPaper: LibraryPaperDetailView | null;
}
export interface LibraryPaperDetailView {
  root: string;
  paper: LibraryPaperSummary;
  reads: PaperRead[];
  links: PaperSurfaceLink[];
  integrations: TopicIntegration[];
}

const slugOf = (p: string) => encodeURIComponent(p);

function isAvailable(topicDir: string): boolean {
  return existsSync(topicDir) && existsSync(resolveProjectResearcherDir(topicDir));
}

function readSeen(topicDir: string): SeenEntry[] {
  const path = join(resolveProjectResearcherDir(topicDir), 'state/seen.jsonl');
  if (!existsSync(path)) return [];
  return new Seen(path).entries();
}

function listPdfs(topicDir: string): { id: string; file: string }[] {
  const dir = join(topicDir, 'papers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.pdf'))
    .sort()
    .map((f) => ({ id: f.replace(/\.pdf$/, ''), file: `papers/${f}` }));
}

function buildDocs(topicDir: string): DocRef[] {
  const docs: DocRef[] = [];
  const add = (rel: string, label: string) => {
    if (existsSync(join(topicDir, rel))) docs.push({ path: rel, label });
  };
  add('.researcher/thesis.md', 'Thesis');
  add('notes/00_research_landscape.md', 'Landscape');
  add('report.md', 'Report');
  return docs;
}

// Best-effort human title for a per-paper note: YAML frontmatter title/paper,
// else the first markdown H1, else a de-slugged filename.
function noteTitle(absFile: string, fallback: string): string {
  let head = '';
  try { head = readFileSync(absFile, 'utf8').slice(0, 2000); } catch { return fallback; }
  if (head.startsWith('---')) {
    const end = head.indexOf('\n---', 3);
    const fm = end > 0 ? head.slice(3, end) : head;
    const m = /^(?:title|paper)\s*:\s*"?(.+?)"?\s*$/m.exec(fm);
    if (m) return m[1].trim();
  }
  const h1 = /^#\s+(.+)$/m.exec(head);
  return h1 ? h1[1].trim() : fallback;
}

function listNotes(topicDir: string): NoteRef[] {
  return listIntegratedNotes(topicDir)
    .map((n) => ({
      path: n.relPath,
      num: String(n.num).padStart(2, '0'),
      title: noteTitle(n.absPath, n.filename.replace(/^\d+_/, '').replace(/\.md$/, '').replace(/_/g, ' ')),
      zone: n.zone,
      pin: n.fm.pin,
      score: n.fm.score,
      dwell: n.fm.dwell,
    }))
    .sort((a, b) => Number(a.num) - Number(b.num));
}

function noteCount(topicDir: string): number {
  return listIntegratedNotes(topicDir).length;
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
      oneline, noteCount: noteCount(topicDir), lastRun, decisionCounts: counts,
    };
  });
  return { root, topics };
}

function libraryTopics(root: string): LibraryTopicRef[] {
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  return manifest.topics.map((t) => {
    const topicDir = join(root, t.path);
    return { slug: slugOf(t.path), path: t.path, active: t.active, available: isAvailable(topicDir) };
  });
}

function sourceLabel(paper: Paper): string {
  if (paper.canonicalSource.kind === 'arxiv') return 'arXiv';
  return 'URL';
}

function paperDisplayTitle(paper: Paper): string {
  return paper.title ?? paper.canonicalSource.id;
}

function latestReadStatus(reads: PaperRead[]): LibraryPaperSummary['readStatus'] {
  if (reads.length === 0) return 'unread';
  return [...reads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].status;
}

function summarizePaper(lib: PaperLibrary, paper: Paper, relation?: PaperRelation): LibraryPaperSummary {
  const reads = lib.listReads(paper.id);
  const links = lib.listLinks(paper.id).filter((l) => l.surfaceType === 'topic');
  const integrations = lib.listIntegrations(paper.id);
  return {
    id: paper.id,
    displayTitle: paperDisplayTitle(paper),
    canonicalId: paper.canonicalSource.id,
    sourceLabel: sourceLabel(paper),
    tags: paper.tags,
    readStatus: latestReadStatus(reads),
    linkedTopicCount: new Set(links.map((l) => l.surfaceId)).size,
    integratedTopicCount: new Set(integrations.map((i) => i.topicId)).size,
    updatedAt: paper.updatedAt,
    relation,
  };
}

export function loadLibrary(root: string, selectedPaperId?: string | null): LibraryView {
  const lib = new PaperLibrary(root);
  const selectedPaper = selectedPaperId ? loadLibraryPaper(root, selectedPaperId) : null;
  return {
    root,
    topics: libraryTopics(root),
    papers: lib.listPapers().map((p) => summarizePaper(lib, p)),
    selectedPaper,
  };
}

export function loadLibraryPaper(root: string, paperId: string): LibraryPaperDetailView | null {
  const lib = new PaperLibrary(root);
  const paper = lib.getPaper(paperId);
  if (!paper) return null;
  return {
    root,
    paper: summarizePaper(lib, paper),
    reads: lib.listReads(paperId),
    links: lib.listLinks(paperId),
    integrations: lib.listIntegrations(paperId),
  };
}

/**
 * Resolve a URL slug to its on-disk topic directory, but ONLY if the decoded
 * slug is a topic declared in the workspace manifest AND the resulting path
 * stays inside `root`. Returns null otherwise — the single guard that stops a
 * crafted slug (e.g. "..%2F..%2Fsecrets") from escaping the workspace.
 */
export function resolveTopicDir(root: string, slug: string): string | null {
  const manifest = loadWorkspaceManifest(resolveWorkspaceManifestPath(root));
  const decoded = decodeURIComponent(slug);
  if (!manifest.topics.some((t) => t.path === decoded)) return null;
  const dir = resolve(root, decoded);
  const base = resolve(root);
  if (dir !== base && !dir.startsWith(base + sep)) return null; // defense in depth
  return dir;
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
      slug: slugOf(topic.path), path: topic.path, available: false, oneline: '', language: '',
      sources: [], researchQuestions: [], docs: [], notes: [], papers: [], relatedPapers: [], seen: [], watermark: null,
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
  const lib = new PaperLibrary(root);
  const relatedPapers = lib.listLinks()
    .filter((l) => l.surfaceType === 'topic' && l.surfaceId === topic.path)
    .map((l) => {
      const paper = lib.getPaper(l.paperId);
      return paper ? summarizePaper(lib, paper, l.relation) : null;
    })
    .filter((p): p is LibraryPaperSummary => p !== null);
  return {
    slug: slugOf(topic.path), path: topic.path, available: true, oneline, language,
    sources, researchQuestions: rqs,
    docs: buildDocs(topicDir),
    notes: listNotes(topicDir),
    papers: listPdfs(topicDir),
    relatedPapers,
    seen: readSeen(topicDir),
    watermark: readWatermark(join(rDir, 'state/watermark.json')),
  };
}
