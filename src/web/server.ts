import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadLibrary, loadLibraryPaper, loadTopic, loadWorkspaceHome, resolveTopicDir } from './discovery.js';
import { loadHomeTrending, type HomeTrendingLoader } from './home-trending.js';
import { renderHomeTrendingPanel, renderLibrary, renderLibraryPaper, renderTopic, renderDoc, renderMarkdown, renderTopics, renderWorkspaceHome } from './views.js';
import { safeDocPath, safePaperPath } from './safe-path.js';
import { TaskRegistry } from './tasks.js';
import { defaultLibraryReadRunner, type LibraryReadRunner } from './library-read.js';
import {
  applyTopicSetup,
  generateTopicSetup,
  type TopicSetupForm,
} from './topic-setup.js';
import { assessSoulReady } from './soul-ready.js';
import type { AgentRuntime } from '../adapter/interface.js';
import { resolveWorkspaceManifestPath } from '../workspace/manifest.js';
import { createWorkspaceTopic } from '../workspace/create-topic.js';
import { parseTags, runLibraryAdd, runLibraryDelete, runLibraryLink, runLibraryUnlink } from '../commands/library.js';
import { normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import type { Stage } from '../state/runs.js';

export interface ServeOptions {
  root: string;
  port: number;
  registry?: TaskRegistry;
  libraryReadRunner?: LibraryReadRunner;
  /** Test-only / override: agent used for Complete setup generate. */
  setupRuntime?: AgentRuntime;
  /** Test/override: 热榜 loader. Default is fetchTrendingPapers with a short timeout. */
  trendingLoader?: HomeTrendingLoader;
}

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');
const LIBRARY_READ_STAGES: Stage[] = ['fetch-source', 'draft-read', 'record-read'];

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location });
  res.end();
}

export async function startServer(opts: ServeOptions): Promise<{ port: number; close: () => Promise<void> }> {
  if (!existsSync(resolveWorkspaceManifestPath(opts.root))) {
    throw new Error(`no researcher.workspace.yml in ${opts.root} — serve requires a workspace super-repo`);
  }
  const registry = opts.registry ?? new TaskRegistry();
  const libraryReadRunner = opts.libraryReadRunner ?? defaultLibraryReadRunner;

  // TaskRegistry is in-memory only: any `reading` left on disk from a previous process is orphaned.
  const reclaimed = new PaperLibrary(opts.root).reclaimOrphanReads();
  if (reclaimed.length > 0) {
    process.stderr.write(
      `researcher serve: reclaimed ${reclaimed.length} orphan library read(s) still marked reading\n`,
    );
  }

  const server = createServer((req, res) => {
    handle(req, res, opts.root, registry, libraryReadRunner, opts.setupRuntime, opts.trendingLoader).catch((err) => {
      send(res, 500, 'text/plain', String(err instanceof Error ? err.message : err));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

function parseSetupForm(form: URLSearchParams): TopicSetupForm {
  return {
    oneline: form.get('oneline')?.trim() ?? '',
    stake: form.get('stake')?.trim() || undefined,
    seeds: form.get('seeds')?.trim() || undefined,
    language: form.get('language')?.trim() || undefined,
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  registry: TaskRegistry,
  libraryReadRunner: LibraryReadRunner,
  setupRuntime?: AgentRuntime,
  trendingLoader?: HomeTrendingLoader,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  // GET /
  if (req.method === 'GET' && path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderWorkspaceHome(loadWorkspaceHome(root)));
  }
  // GET /trending — Home 热榜 fragment; empty body when none / fail
  if (req.method === 'GET' && path === '/trending') {
    const page = await loadHomeTrending({ root, loader: trendingLoader });
    return send(res, 200, 'text/html; charset=utf-8', renderHomeTrendingPanel(page.items));
  }
  // GET /topics
  if (req.method === 'GET' && path === '/topics') {
    return send(res, 200, 'text/html; charset=utf-8', renderTopics(loadDashboard(root)));
  }
  // POST /topics — create a local topic pillar + register in workspace manifest
  if (req.method === 'POST' && path === '/topics') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const topicPath = form.get('path')?.trim() ?? '';
    const oneline = form.get('oneline')?.trim() ?? '';
    const fail = (error: string) =>
      send(
        res,
        400,
        'text/html; charset=utf-8',
        renderTopics(loadDashboard(root), {
          path: topicPath,
          oneline,
          error,
          open: true,
        }),
      );
    if (!topicPath) return fail('folder name is required (e.g. world-model or feeds/ai-safety)');
    if (!oneline) return fail('one-line intent is required — any language is fine');
    try {
      const created = createWorkspaceTopic({ root, path: topicPath, oneline });
      return redirect(res, `/t/${created.slug}?setup=1`);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
  // GET /library
  if (req.method === 'GET' && path === '/library') {
    const selected = url.searchParams.get('paper');
    if (selected) return redirect(res, `/library/p/${encodeURIComponent(selected)}`);
    return send(res, 200, 'text/html; charset=utf-8', renderLibrary(loadLibrary(root)));
  }
  // POST /library/add
  if (req.method === 'POST' && path === '/library/add') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const input = form.get('input')?.trim() ?? '';
    if (!input) return send(res, 400, 'text/plain', 'missing paper source');
    const topic = form.get('topic')?.trim() ?? '';
    if (topic && !resolveTopicDir(root, topic)) return send(res, 400, 'text/plain', 'unknown topic');
    let paperId: string;
    try {
      paperId = paperIdForSource(normalizePaperInput(input));
      runLibraryAdd({
        cwd: root,
        input,
        tags: form.has('tags') ? parseTags(form.get('tags') ?? '') : undefined,
        write: () => {},
      });
      if (topic) {
        runLibraryLink({ cwd: root, paperId, topic, write: () => {} });
      }
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
    }
    if (form.get('next') === 'paper') {
      return redirect(res, `/library/p/${encodeURIComponent(paperId)}`);
    }
    return redirect(res, '/library');
  }
  // POST /library/read
  if (req.method === 'POST' && path === '/library/read') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const paperId = form.get('paperId')?.trim() ?? '';
    const force = form.get('force') === '1';
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    const lib = new PaperLibrary(root);
    const paper = lib.getPaper(paperId);
    if (!paper) return send(res, 404, 'text/plain', 'unknown paper');
    if (!force && hasCompletedRead(lib, root, paperId)) {
      return redirect(res, `/library/p/${encodeURIComponent(paperId)}`);
    }
    const taskKey = libraryReadTaskKey(paperId);
    if (registry.isBusy(taskKey)) return send(res, 409, 'application/json', JSON.stringify({ error: 'busy' }));
    const readId = libraryReadId(paperId);
    lib.upsertRead({ id: readId, paperId, status: 'reading', lastError: undefined });
    registry.startJob(taskKey, async (onLine, onEvent) => {
      onEvent({ type: 'plan', stages: LIBRARY_READ_STAGES });
      try {
        const result = await libraryReadRunner({
          workspaceRoot: root,
          paper,
          readId,
          onLine,
          onEvent,
        });
        if (result.title && !paper.title) {
          lib.upsertPaper({ ...paper, title: result.title });
        }
        lib.upsertRead({
          id: readId,
          paperId,
          status: 'read',
          artifactPath: result.artifactPath,
          lastError: undefined,
        });
        return 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLine(message);
        lib.upsertRead({ id: readId, paperId, status: 'failed', lastError: message });
        return 1;
      }
    });
    return redirect(res, `/library/p/${encodeURIComponent(paperId)}`);
  }
  // POST /library/delete — only unlinked papers
  if (req.method === 'POST' && path === '/library/delete') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const paperId = form.get('paperId')?.trim() ?? '';
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    try {
      runLibraryDelete({ cwd: root, paperId, write: () => {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /unknown paper/i.test(message) ? 404 : 400;
      return send(res, status, 'text/plain', message);
    }
    return redirect(res, '/library');
  }
  // POST /library/note — paper-local human notes (create / pin / unpin / delete)
  if (req.method === 'POST' && path === '/library/note') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const action = form.get('action')?.trim() || 'create';
    const paperId = form.get('paperId')?.trim() ?? '';
    const noteId = form.get('noteId')?.trim() ?? '';
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    const lib = new PaperLibrary(root);
    if (!lib.getPaper(paperId)) return send(res, 404, 'text/plain', 'unknown paper');
    const back = `/library/p/${encodeURIComponent(paperId)}#notes`;
    try {
      if (action === 'create') {
        const text = form.get('body')?.trim() ?? '';
        if (!text) return send(res, 400, 'text/plain', 'note body is required');
        const kindRaw = form.get('kind')?.trim() || 'note';
        const kind = parsePaperNoteKind(kindRaw);
        const pinned = form.get('pinned') === '1' || form.get('pinned') === 'on';
        lib.upsertNote({
          id: `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          paperId,
          body: text,
          kind,
          pinned,
        });
      } else if (action === 'pin' || action === 'unpin') {
        if (!noteId) return send(res, 400, 'text/plain', 'missing note id');
        const existing = lib.getNote(noteId);
        if (!existing || existing.paperId !== paperId) return send(res, 404, 'text/plain', 'unknown note');
        lib.upsertNote({ ...existing, pinned: action === 'pin' });
      } else if (action === 'delete') {
        if (!noteId) return send(res, 400, 'text/plain', 'missing note id');
        const existing = lib.getNote(noteId);
        if (!existing || existing.paperId !== paperId) return send(res, 404, 'text/plain', 'unknown note');
        lib.deleteNote(noteId);
      } else {
        return send(res, 400, 'text/plain', `unknown note action: ${action}`);
      }
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
    }
    return redirect(res, back);
  }
  // POST /library/link
  if (req.method === 'POST' && path === '/library/link') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const paperId = form.get('paperId')?.trim() ?? '';
    const topic = form.get('topic')?.trim() ?? '';
    const rationale = form.get('rationale')?.trim() || undefined;
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    if (!topic) return send(res, 400, 'text/plain', 'missing topic');
    if (!resolveTopicDir(root, topic)) return send(res, 404, 'text/plain', 'unknown topic');
    const lib = new PaperLibrary(root);
    if (!lib.getPaper(paperId)) return send(res, 404, 'text/plain', 'unknown paper');
    try {
      runLibraryLink({ cwd: root, paperId, topic, rationale, write: () => {} });
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
    }
    return redirect(res, `/library/p/${encodeURIComponent(paperId)}`);
  }
  // POST /library/unlink
  if (req.method === 'POST' && path === '/library/unlink') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const paperId = form.get('paperId')?.trim() ?? '';
    const topic = form.get('topic')?.trim() ?? '';
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    if (!topic) return send(res, 400, 'text/plain', 'missing topic');
    try {
      runLibraryUnlink({ cwd: root, paperId, topic, write: () => {} });
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
    }
    return redirect(res, `/library/p/${encodeURIComponent(paperId)}`);
  }
  const lsm = path.match(/^\/library\/read\/([^/]+)\/stream$/);
  if (req.method === 'GET' && lsm) {
    const taskId = decodeURIComponent(lsm[1]);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const unsub = registry.subscribe(
      taskId,
      (line) => res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`),
      (ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
      (task) => {
        res.write(
          `event: end\ndata: ${JSON.stringify({
            status: task.status,
            exitCode: task.exitCode,
            endReason: task.endReason,
          })}\n\n`,
        );
        res.end();
      },
    );
    req.on('close', unsub);
    return;
  }
  const lm = path.match(/^\/library\/p\/([^/]+)$/);
  if (req.method === 'GET' && lm) {
    const paperId = decodeURIComponent(lm[1]);
    const paper = loadLibraryPaper(root, paperId);
    if (!paper) return send(res, 404, 'text/plain', 'unknown paper');
    const active = registry.activeTask(libraryReadTaskKey(paperId));
    const activeRead = active ? { taskId: active.id, startedAt: active.startedAt } : null;
    const editTopic = url.searchParams.get('edit')?.trim() || undefined;
    return send(res, 200, 'text/html; charset=utf-8', renderLibraryPaper(paper, activeRead, editTopic));
  }
  // GET /static/app.css
  if (req.method === 'GET' && path === '/static/app.css') {
    const f = join(STATIC_DIR, 'app.css');
    if (!existsSync(f)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/css; charset=utf-8', readFileSync(f));
  }

  // POST /t/:slug/setup/generate|apply — AI Complete setup (before generic /t routes)
  const setupM = path.match(/^\/t\/([^/]+)\/setup\/(generate|apply)$/);
  if (req.method === 'POST' && setupM) {
    const slug = setupM[1];
    const action = setupM[2];
    const topicDir = resolveTopicDir(root, slug);
    if (!topicDir) return send(res, 404, 'text/plain', 'unknown topic');
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    try {
      if (action === 'generate') {
        const setupForm = parseSetupForm(form);
        if (!setupForm.oneline) return send(res, 400, 'text/plain', 'missing one-line');
        const draft = await generateTopicSetup({
          topicDir,
          form: setupForm,
          runtime: setupRuntime,
        });
        return send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({
            projectYaml: draft.projectYaml,
            thesisMd: draft.thesisMd,
            // Pre-rendered for the review pane (client has no marked).
            thesisHtml: renderMarkdown(draft.thesisMd),
          }),
        );
      }
      // apply
      const projectYaml = form.get('projectYaml') ?? '';
      const thesisMd = form.get('thesisMd') ?? '';
      const oneline = form.get('oneline')?.trim() ?? '';
      await applyTopicSetup({ topicDir, projectYaml, thesisMd, oneline });
      return redirect(res, `/t/${slug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /already set up|non-template/i.test(msg) ? 409 : 400;
      return send(res, status, 'text/plain', msg);
    }
  }

  const m = path.match(/^\/t\/([^/]+)(\/doc|\/paper|\/run(?:\/([^/]+)\/stream)?)?$/);
  if (m) {
    const slug = m[1];
    const sub = m[2];
    const taskId = m[3];

    // GET /t/:slug — uses loadTopic which already null-guards against the manifest
    if (req.method === 'GET' && !sub) {
      const view = loadTopic(root, slug);
      if (!view) return send(res, 404, 'text/plain', 'unknown topic');
      const active = registry.activeTask(decodeURIComponent(slug));
      const activeRun = active ? { taskId: active.id, startedAt: active.startedAt } : null;
      const openSetup = url.searchParams.get('setup') === '1' && (view.needsSetup || !view.soulReady);
      return send(res, 200, 'text/html; charset=utf-8', renderTopic(view, activeRun, { openSetup }));
    }

    // All sub-routes: validate slug against the manifest before any FS/process use
    const topicDir = resolveTopicDir(root, slug);
    if (!topicDir) return send(res, 404, 'text/plain', 'unknown topic');
    const decoded = decodeURIComponent(slug);

    // GET /t/:slug/doc?path=...
    if (req.method === 'GET' && sub === '/doc') {
      const rel = url.searchParams.get('path') ?? '';
      const abs = safeDocPath(topicDir, rel);
      if (!abs) return send(res, 404, 'text/plain', 'not found');
      return send(
        res,
        200,
        'text/html; charset=utf-8',
        renderDoc(readFileSync(abs, 'utf8'), {
          resolveLibraryReadArtifact: (artifactRel) => readWorkspaceLibraryArtifact(root, artifactRel),
        }),
      );
    }
    // GET /t/:slug/paper?id=...
    if (req.method === 'GET' && sub === '/paper') {
      const id = url.searchParams.get('id') ?? '';
      const abs = safePaperPath(topicDir, id);
      if (!abs) return send(res, 404, 'text/plain', 'not found');
      return send(res, 200, 'application/pdf', readFileSync(abs));
    }
    // POST /t/:slug/run
    if (req.method === 'POST' && sub === '/run') {
      if (registry.isBusy(decoded)) return send(res, 409, 'application/json', JSON.stringify({ error: 'busy' }));
      const soul = assessSoulReady(topicDir);
      if (!soul.ready) {
        return send(
          res,
          409,
          'application/json',
          JSON.stringify({ error: 'setup_required', reasons: soul.reasons }),
        );
      }
      const rawBody = await readBody(req).catch(() => '');
      let discover = false;
      const ctype = req.headers['content-type'] ?? '';
      if (ctype.includes('application/json') && rawBody) {
        try {
          const body = JSON.parse(rawBody) as { discover?: unknown };
          discover = body.discover === true || body.discover === 1 || body.discover === '1';
        } catch {
          discover = false;
        }
      } else if (rawBody) {
        const form = new URLSearchParams(rawBody);
        const v = form.get('discover');
        discover = v === '1' || v === 'true' || v === 'on';
      }
      const task = registry.start(decoded, topicDir, root, { discover });
      return send(res, 200, 'application/json', JSON.stringify({ taskId: task.id }));
    }
    // GET /t/:slug/run/:taskId/stream  (SSE)
    if (req.method === 'GET' && taskId) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const unsub = registry.subscribe(
        taskId,
        (line) => res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`),
        (ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
        (task) => {
          res.write(
            `event: end\ndata: ${JSON.stringify({
              status: task.status,
              exitCode: task.exitCode,
              endReason: task.endReason,
              outcome: task.outcome,
            })}\n\n`,
          );
          res.end();
        },
      );
      req.on('close', unsub);
      return;
    }
  }

  send(res, 404, 'text/plain', 'not found');
}

/** Read a workspace-relative Library read artifact for identity hydration (#138). */
function readWorkspaceLibraryArtifact(workspaceRoot: string, relPath: string): string | null {
  const cleaned = relPath.trim().replace(/^\.\//, '');
  if (!cleaned || cleaned.includes('\0')) return null;
  const abs = resolve(workspaceRoot, cleaned);
  const base = resolve(workspaceRoot);
  if (abs !== base && !abs.startsWith(base + sep)) return null;
  if (!abs.endsWith('.md') || !existsSync(abs)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function libraryReadTaskKey(paperId: string): string {
  return `library-read:${paperId}`;
}

function libraryReadId(paperId: string): string {
  return `read_${paperId}`;
}

function hasCompletedRead(lib: PaperLibrary, root: string, paperId: string): boolean {
  return lib.listReads(paperId).some((r) => r.status === 'read' && r.artifactPath && existsSync(join(root, r.artifactPath)));
}

const PAPER_NOTE_KINDS = new Set(['note', 'clarification', 'caveat', 'idea', 'question']);

function parsePaperNoteKind(raw: string): 'note' | 'clarification' | 'caveat' | 'idea' | 'question' {
  if (PAPER_NOTE_KINDS.has(raw)) return raw as 'note' | 'clarification' | 'caveat' | 'idea' | 'question';
  throw new Error(`unknown note kind: ${raw}`);
}
