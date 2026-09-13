import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadLibrary, loadLibraryPaper, loadTopic, loadTopicLinkPanel, loadWorkspaceHome, resolveTopicDir } from './discovery.js';
import { loadHomeTrending, type HomeTrendingLoader } from './home-trending.js';
import { renderHomeTrendingPanel, renderLibrary, renderLibraryPaper, renderNoteEditor, renderNoteReader, renderVideoReader, renderTopic, renderDoc, renderMarkdown, renderTopics, renderWorkspaceHome } from './views.js';
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
import { isSafeLibraryId, PaperLibrary, newAnalysisId, newDocumentId, newReadId } from '../library/store.js';
import { isNoteDocType, isVideoDocType, parseDocType } from '../library/doc-type.js';
import { classifyAnalysis } from '../library/video.js';
import { attachChineseCues, defaultTranslateToZh, type CueTranslator } from '../library/video-translate.js';
import { analyzeRuntime, defaultVideoAnalyzeRunner, type VideoAnalyzeRunner } from '../library/video-analyze.js';
import { VideoAnalysisLiveSet } from './video-analysis-live.js';
import { readMultipartVideo } from './multipart.js';
import { normalizePaperInput } from '../library/identity.js';
import { acquireSharedLease } from '../library/maintenance.js';
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
  videoAnalyzeRunner?: VideoAnalyzeRunner;
  videoTranslate?: CueTranslator;
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

  const releaseLease = acquireSharedLease(opts.root, 'researcher serve');
  // TaskRegistry is in-memory only: any `reading` left on disk from a previous process is orphaned.
  const reclaimed = new PaperLibrary(opts.root).reclaimOrphanReads();
  if (reclaimed.length > 0) {
    process.stderr.write(
      `researcher serve: reclaimed ${reclaimed.length} orphan library read(s) still marked reading\n`,
    );
  }

  const liveAnalyses = new VideoAnalysisLiveSet();
  const server = createServer((req, res) => {
    handle(
      req, res, opts.root, registry, libraryReadRunner, opts.setupRuntime, opts.trendingLoader,
      opts.videoAnalyzeRunner, liveAnalyses, opts.videoTranslate,
    ).catch((err) => {
      send(res, 500, 'text/plain', String(err instanceof Error ? err.message : err));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { port, close: () => new Promise((r) => server.close(() => { releaseLease(); r(); })) };
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
  videoAnalyzeRunner?: VideoAnalyzeRunner,
  liveAnalyses?: VideoAnalysisLiveSet,
  videoTranslate?: CueTranslator,
): Promise<void> {
  const live = liveAnalyses ?? new VideoAnalysisLiveSet();
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
    if (selected) return send(res, 400, 'text/plain', 'use /library/documents/:documentId');
    const status = url.searchParams.get('status') ?? (req.headers.accept?.includes('application/json') ? 'all' : 'all');
    const type = url.searchParams.get('type') ?? 'all';
    const q = url.searchParams.get('q') ?? '';
    const accept = req.headers.accept ?? '';
    if (accept.includes('application/json')) {
      return sendJsonDocuments(res, root, { type, status, query: q }, live);
    }
    try {
      new PaperLibrary(root).interruptStaleVideoAnalyses((id) => live.has(id));
      return send(res, 200, 'text/html; charset=utf-8', renderLibrary(loadLibrary(root, { type: 'all', status: 'all' })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { status?: number }).status ?? (/unknown|invalid/.test(message) ? 400 : 500);
      return send(res, code, 'text/plain', message);
    }
  }
  if (req.method === 'GET' && path === '/library/documents') {
    const status = url.searchParams.get('status') ?? 'all';
    const type = url.searchParams.get('type') ?? 'all';
    const q = url.searchParams.get('q') ?? '';
    return sendJsonDocuments(res, root, { type, status, query: q }, live);
  }
  if (req.method === 'GET' && path === '/library/documents/new') {
    if ((url.searchParams.get('type') ?? 'note') !== 'note') {
      return send(res, 422, 'text/plain', 'only type=note is supported');
    }
    const id = newDocumentId();
    return send(res, 200, 'text/html; charset=utf-8', renderNoteEditor({ id, title: '', body: '', isNew: true }));
  }
  if (req.method === 'POST' && path === '/library/documents') {
    return handleCreateNote(req, res, root);
  }
  if (req.method === 'POST' && path === '/library/documents/import') {
    return handleImportDocument(req, res, root);
  }
  if (req.method === 'POST' && path === '/library/documents/videos') {
    return handleCreateVideo(req, res, root);
  }
  const docSub = path.match(/^\/library\/documents\/([^/]+)(?:\/(.*))?$/);
  if (docSub && docSub[1] !== 'new' && docSub[1] !== 'import') {
    const documentId = decodeURIComponent(docSub[1]);
    const rest = docSub[2] ?? '';
    if (!isSafeLibraryId(documentId)) return sendJsonErr(res, 400, 'invalid_id', 'invalid document id');
    const handled = await handleDocumentResource(req, res, {
      root,
      documentId,
      rest,
      registry,
      libraryReadRunner,
      url,
      videoAnalyzeRunner,
      liveAnalyses: live,
      videoTranslate,
    });
    if (handled) return;
  }
  // GET /static/app.css
  if (req.method === 'GET' && path === '/static/app.css') {
    const f = join(STATIC_DIR, 'app.css');
    if (!existsSync(f)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/css; charset=utf-8', readFileSync(f));
  }
  if (req.method === 'GET' && path === '/static/video-workbench.js') {
    const f = join(STATIC_DIR, 'video-workbench.js');
    if (!existsSync(f)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/javascript; charset=utf-8', readFileSync(f));
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

function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function libraryReadTaskKey(paperId: string): string {
  return `library-read:${paperId}`;
}

function sendJsonDocuments(
  res: ServerResponse,
  root: string,
  opts: { type: string; status: string; query: string },
  live: VideoAnalysisLiveSet,
): void {
  const lib = new PaperLibrary(root);
  try {
    lib.interruptStaleVideoAnalyses((id) => live.has(id));
    const docs = lib.filterDocuments(opts);
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify(docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      title: d.title,
      tags: d.tags,
      source: d.canonicalSource ?? null,
      updatedAt: d.updatedAt,
    }))));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? (/unknown|invalid/.test(message) ? 400 : 500);
    send(res, status, 'text/plain', message);
  }
}

function sendJsonErr(res: ServerResponse, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify({ code, message, ...extra }));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function assertWriteAccess(req: IncomingMessage, res: ServerResponse, opts: { json?: boolean } = {}): boolean {
  if (!sameOrigin(req)) {
    sendJsonErr(res, 403, 'forbidden_origin', 'cross-origin writes are not allowed');
    return false;
  }
  if (opts.json !== false) {
    const ct = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!ct.includes('application/json')) {
      sendJsonErr(res, 415, 'unsupported_media_type', 'Content-Type must be application/json');
      return false;
    }
  }
  return true;
}

function documentUrl(id: string, hash = ''): string {
  return `/library/documents/${encodeURIComponent(id)}${hash}`;
}

function noteActionBlocked(res: ServerResponse, docType: string | undefined): boolean {
  if (isNoteDocType(docType) || isVideoDocType(docType)) {
    sendJsonErr(res, 422, 'unsupported_action', 'this action is not supported for this document type');
    return true;
  }
  return false;
}

async function readJsonBody<T>(req: IncomingMessage, res: ServerResponse): Promise<T | undefined> {
  if (!assertWriteAccess(req, res)) return undefined;
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    sendJsonErr(res, status, status === 413 ? 'payload_too_large' : 'read_failed', err instanceof Error ? err.message : String(err));
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    sendJsonErr(res, 400, 'invalid_json', 'invalid JSON');
    return undefined;
  }
}

async function handleDocumentResource(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    root: string;
    documentId: string;
    rest: string;
    registry: TaskRegistry;
    libraryReadRunner: LibraryReadRunner;
    url: URL;
    videoAnalyzeRunner?: VideoAnalyzeRunner;
    liveAnalyses: VideoAnalysisLiveSet;
    videoTranslate?: CueTranslator;
  },
): Promise<boolean> {
  const { root, documentId, rest, registry, libraryReadRunner, url, videoAnalyzeRunner, liveAnalyses, videoTranslate } = ctx;
  const lib = new PaperLibrary(root);
  const doc = lib.getDocument(documentId);
  const isLive = (id: string) => liveAnalyses.has(id);

  if (req.method === 'GET' && rest === '') {
    if (!doc) {
      send(res, 404, 'text/plain', 'unknown document');
      return true;
    }
    if (isVideoDocType(doc.docType)) lib.interruptStaleVideoAnalysis(documentId, isLive);
    const accept = req.headers.accept ?? '';
    if (accept.includes('application/json')) {
      if (isVideoDocType(doc.docType)) {
        const product = lib.currentCues(documentId);
        sendJson(res, 200, {
          ...doc,
          mediaExists: lib.videoMediaExists(doc),
          analysis: lib.latestVideoAnalysis(documentId) ?? null,
          cues: product?.cues ?? null,
          noSpeech: product?.noSpeech ?? null,
        });
        return true;
      }
      sendJson(res, 200, doc);
      return true;
    }
    // Any docType can carry topic links (#197); the panel is document-level.
    const editTopicParam = url.searchParams.get('edit')?.trim() || undefined;
    if (doc.docType === 'note') {
      send(res, 200, 'text/html; charset=utf-8', renderNoteReader(
        doc,
        loadTopicLinkPanel(root, documentId, editTopicParam) ?? undefined,
      ));
      return true;
    }
    if (isVideoDocType(doc.docType)) {
      send(res, 200, 'text/html; charset=utf-8', renderVideoReader({
        panel: loadTopicLinkPanel(root, documentId, editTopicParam) ?? undefined,
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        revision: doc.revision,
        root,
        mediaExists: lib.videoMediaExists(doc),
        runtimeMissing: analyzeRuntime().missing,
        latest: lib.latestVideoAnalysis(documentId),
        product: lib.currentCues(documentId),
      }));
      return true;
    }
    const paper = loadLibraryPaper(root, documentId);
    if (!paper) {
      send(res, 404, 'text/plain', 'unknown paper');
      return true;
    }
    const active = registry.activeTask(libraryReadTaskKey(documentId));
    const reading = lib.listReads(documentId).find((r) => r.status === 'reading');
    const activeRead = active
      ? { taskId: active.id, startedAt: active.startedAt, readId: reading?.id, documentId }
      : null;
    send(res, 200, 'text/html; charset=utf-8', renderLibraryPaper(paper, activeRead, editTopicParam));
    return true;
  }

  if (req.method === 'GET' && rest === 'edit') {
    if (!doc) {
      send(res, 404, 'text/plain', 'unknown document');
      return true;
    }
    if (doc.docType !== 'note') {
      send(res, 422, 'text/plain', 'only notes are editable');
      return true;
    }
    send(res, 200, 'text/html; charset=utf-8', renderNoteEditor({
      id: doc.id,
      title: doc.title,
      body: doc.body,
      isNew: false,
      revision: doc.revision,
    }));
    return true;
  }

  if (req.method === 'PATCH' && rest === '') {
    if (doc && isVideoDocType(doc.docType)) {
      await handlePatchVideoTitle(req, res, root, documentId);
      return true;
    }
    await handlePatchNote(req, res, root, documentId);
    return true;
  }

  if (req.method === 'DELETE' && rest === '') {
    if (!assertWriteAccess(req, res, { json: false })) return true;
    if (!doc) {
      sendJsonErr(res, 404, 'not_found', 'unknown document');
      return true;
    }
    if (noteActionBlocked(res, doc.docType)) return true;
    try {
      runLibraryDelete({ cwd: root, paperId: documentId, write: () => {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /unknown paper/i.test(message) ? 404 : /linked|integrated/i.test(message) ? 409 : 400;
      sendJsonErr(res, status, 'delete_failed', message);
      return true;
    }
    sendJson(res, 200, { url: '/library' });
    return true;
  }

  if (req.method === 'GET' && rest === 'media') {
    if (!doc || !isVideoDocType(doc.docType)) {
      send(res, 404, 'text/plain', 'not found');
      return true;
    }
    const path = lib.videoMediaPath(doc);
    if (!existsSync(path)) {
      send(res, 404, 'text/plain', 'media missing');
      return true;
    }
    sendMediaRange(req, res, path, doc.media?.contentType ?? 'video/mp4');
    return true;
  }
  if (rest === 'cues' && req.method === 'GET') {
    if (!doc) { sendJsonErr(res, 404, 'not_found', 'unknown document'); return true; }
    if (!isVideoDocType(doc.docType)) { sendJsonErr(res, 422, 'unsupported_action', 'not a video'); return true; }
    const product = lib.currentCues(documentId);
    if (!product) { sendJsonErr(res, 404, 'not_found', 'no analysis product'); return true; }
    sendJson(res, 200, { cues: product.cues, noSpeech: product.noSpeech });
    return true;
  }
  if (rest === 'analyses' && req.method === 'POST') {
    await handleStartVideoAnalysis(req, res, root, documentId, liveAnalyses, videoAnalyzeRunner, videoTranslate);
    return true;
  }
  if (rest.startsWith('analyses/') && req.method === 'GET') {
    if (!doc) { sendJsonErr(res, 404, 'not_found', 'unknown document'); return true; }
    const analysisId = decodeURIComponent(rest.slice('analyses/'.length));
    const rec = lib.interruptStaleVideoAnalysis(documentId, isLive, analysisId)
      ?? lib.getVideoAnalysis(documentId, analysisId);
    if (!rec) { sendJsonErr(res, 404, 'not_found', 'unknown analysis'); return true; }
    sendJson(res, 200, rec);
    return true;
  }
  if (rest === 'media/restore' && req.method === 'POST') {
    await handleRestoreVideo(req, res, root, documentId);
    return true;
  }
  if (rest === 'reads' || rest.startsWith('reads/')) {
    await handleReads(req, res, { root, lib, doc, documentId, rest, registry, libraryReadRunner });
    return true;
  }
  if (rest === 'annotations' || rest.startsWith('annotations/')) {
    await handleAnnotations(req, res, { lib, doc, documentId, rest });
    return true;
  }
  if (rest === 'links' || rest.startsWith('links/')) {
    await handleLinks(req, res, { root, lib, doc, documentId, rest });
    return true;
  }
  if (rest === 'integrations' && req.method === 'GET') {
    if (!doc) {
      sendJsonErr(res, 404, 'not_found', 'unknown document');
      return true;
    }
    sendJson(res, 200, lib.listIntegrations(documentId).map((i) => ({
      documentId: i.paperId,
      topicId: i.topicId,
      notePath: i.notePath,
      zone: i.zone,
      integratedAt: i.integratedAt,
      summary: i.summary,
    })));
    return true;
  }
  return false;
}

async function handleImportDocument(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const payload = await readJsonBody<{
    input?: string;
    tags?: string | string[];
    docType?: string;
    topic?: string;
  }>(req, res);
  if (!payload) return;
  const input = typeof payload.input === 'string' ? payload.input.trim() : '';
  if (!input) {
    sendJsonErr(res, 400, 'invalid_fields', 'input is required');
    return;
  }
  const topic = typeof payload.topic === 'string' ? payload.topic.trim() : '';
  if (topic && !resolveTopicDir(root, topic)) {
    sendJsonErr(res, 400, 'unknown_topic', 'unknown topic');
    return;
  }
  let docType;
  try {
    docType = payload.docType ? parseDocType(payload.docType) : undefined;
  } catch (err) {
    sendJsonErr(res, 400, 'invalid_type', err instanceof Error ? err.message : String(err));
    return;
  }
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(String)
    : typeof payload.tags === 'string' && payload.tags.trim()
      ? parseTags(payload.tags)
      : undefined;
  const lib = new PaperLibrary(root);
  let existed = false;
  try {
    const source = normalizePaperInput(input);
    existed = Boolean(lib.findByCanonicalSource(source.id));
    const paperId = runLibraryAdd({
      cwd: root,
      input,
      tags,
      docType,
      write: () => {},
    }).id;
    if (topic) runLibraryLink({ cwd: root, paperId, topic, write: () => {} });
    sendJson(res, existed ? 200 : 201, { id: paperId, url: documentUrl(paperId) });
  } catch (err) {
    sendJsonErr(res, 400, 'import_failed', err instanceof Error ? err.message : String(err));
  }
}

async function handleReads(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    root: string;
    lib: PaperLibrary;
    doc: ReturnType<PaperLibrary['getDocument']>;
    documentId: string;
    rest: string;
    registry: TaskRegistry;
    libraryReadRunner: LibraryReadRunner;
  },
): Promise<void> {
  const { root, lib, doc, documentId, rest, registry, libraryReadRunner } = ctx;
  if (!doc) {
    sendJsonErr(res, 404, 'not_found', 'unknown document');
    return;
  }
  if (noteActionBlocked(res, doc.docType)) return;
  const paper = lib.getPaper(documentId);
  if (!paper) {
    sendJsonErr(res, 404, 'not_found', 'unknown document');
    return;
  }

  if (rest === 'reads' && req.method === 'GET') {
    sendJson(res, 200, lib.listReads(documentId).map(readJson));
    return;
  }
  if (rest === 'reads' && req.method === 'POST') {
    const payload = await readJsonBody<{ force?: boolean; mutationId?: string }>(req, res);
    if (!payload) return;
    const force = payload.force === true;
    const mutationId = typeof payload.mutationId === 'string' ? payload.mutationId : undefined;
    if (mutationId) {
      const prior = lib.listReads(documentId).find((r) => r.mutationId === mutationId);
      if (prior) {
        sendJson(res, prior.status === 'reading' ? 202 : 200, { readId: prior.id, url: documentUrl(documentId) });
        return;
      }
    }
    if (!force && hasCompletedRead(lib, root, documentId)) {
      const last = lib.listReads(documentId).filter((r) => r.status === 'read').at(-1);
      sendJson(res, 200, { readId: last?.id, url: documentUrl(documentId) });
      return;
    }
    const taskKey = libraryReadTaskKey(documentId);
    if (registry.isBusy(taskKey)) {
      sendJsonErr(res, 409, 'busy', 'a read is already running');
      return;
    }
    const readId = newReadId();
    lib.upsertRead({ id: readId, paperId: documentId, status: 'reading', lastError: undefined, mutationId });
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
          paperId: documentId,
          status: 'read',
          artifactPath: result.artifactPath,
          lastError: undefined,
          mutationId,
        });
        return 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLine(message);
        lib.upsertRead({ id: readId, paperId: documentId, status: 'failed', lastError: message, mutationId });
        return 1;
      }
    }, readId);
    sendJson(res, 202, { readId, url: documentUrl(documentId) });
    return;
  }

  const readMatch = rest.match(/^reads\/([^/]+)(?:\/(artifact|stream))?$/);
  if (!readMatch) {
    sendJsonErr(res, 404, 'not_found', 'unknown read resource');
    return;
  }
  const readId = decodeURIComponent(readMatch[1]);
  const sub = readMatch[2];
  const read = lib.listReads(documentId).find((r) => r.id === readId);
  if (!read || read.paperId !== documentId) {
    sendJsonErr(res, 404, 'not_found', 'unknown read');
    return;
  }
  if (req.method === 'GET' && !sub) {
    sendJson(res, 200, readJson(read));
    return;
  }
  if (req.method === 'GET' && sub === 'artifact') {
    if (!read.artifactPath || !existsSync(join(root, read.artifactPath))) {
      send(res, 404, 'text/plain', 'artifact not found');
      return;
    }
    send(res, 200, 'text/markdown; charset=utf-8', readFileSync(join(root, read.artifactPath), 'utf8'));
    return;
  }
  if (req.method === 'GET' && sub === 'stream') {
    const task = registry.get(readId);
    if (!task || task.slug !== libraryReadTaskKey(documentId)) {
      send(res, 404, 'text/plain', 'no active read');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const unsub = ctx.registry.subscribe(
      task.id,
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
  sendJsonErr(res, 404, 'not_found', 'unknown read resource');
}

function readJson(read: { id: string; paperId: string; status: string; createdAt: string; updatedAt: string; artifactPath?: string; lastError?: string; mutationId?: string }) {
  return {
    id: read.id,
    documentId: read.paperId,
    status: read.status,
    createdAt: read.createdAt,
    updatedAt: read.updatedAt,
    artifactPath: read.artifactPath,
    lastError: read.lastError,
    mutationId: read.mutationId,
  };
}

async function handleAnnotations(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { lib: PaperLibrary; doc: ReturnType<PaperLibrary['getDocument']>; documentId: string; rest: string },
): Promise<void> {
  const { lib, doc, documentId, rest } = ctx;
  if (!doc) {
    sendJsonErr(res, 404, 'not_found', 'unknown document');
    return;
  }
  if (noteActionBlocked(res, doc.docType)) return;

  if (rest === 'annotations' && req.method === 'GET') {
    sendJson(res, 200, lib.listNotes(documentId).map((n) => ({
      id: n.id,
      documentId: n.paperId,
      body: n.body,
      kind: n.kind,
      pinned: n.pinned,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })));
    return;
  }
  if (rest === 'annotations' && req.method === 'POST') {
    const payload = await readJsonBody<{ body?: string; kind?: string; pinned?: boolean | string }>(req, res);
    if (!payload) return;
    const text = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!text) {
      sendJsonErr(res, 400, 'invalid_fields', 'body is required');
      return;
    }
    try {
      const kind = parsePaperNoteKind(typeof payload.kind === 'string' && payload.kind ? payload.kind : 'note');
      const note = lib.upsertNote({
        id: `note_${randomUUID()}`,
        paperId: documentId,
        body: text,
        kind,
        pinned: payload.pinned === true || payload.pinned === '1' || payload.pinned === 'on',
      });
      sendJson(res, 201, { id: note.id, url: `${documentUrl(documentId)}#annotations` });
    } catch (err) {
      sendJsonErr(res, 400, 'save_failed', err instanceof Error ? err.message : String(err));
    }
    return;
  }
  const ann = rest.match(/^annotations\/([^/]+)$/);
  if (!ann) {
    sendJsonErr(res, 404, 'not_found', 'unknown annotation');
    return;
  }
  const annotationId = decodeURIComponent(ann[1]);
  const existing = lib.getNote(annotationId);
  if (!existing || existing.paperId !== documentId) {
    sendJsonErr(res, 404, 'not_found', 'unknown annotation');
    return;
  }
  if (req.method === 'PATCH') {
    const payload = await readJsonBody<{ pinned?: boolean | string }>(req, res);
    if (!payload) return;
    const pinned = payload.pinned === true || payload.pinned === '1' || payload.pinned === 'on'
      ? true
      : payload.pinned === false || payload.pinned === '0'
        ? false
        : existing.pinned;
    const note = lib.upsertNote({ ...existing, pinned });
    sendJson(res, 200, { id: note.id, pinned: note.pinned, url: `${documentUrl(documentId)}#annotations` });
    return;
  }
  if (req.method === 'DELETE') {
    if (!assertWriteAccess(req, res, { json: false })) return;
    lib.deleteNote(annotationId);
    res.writeHead(204);
    res.end();
    return;
  }
  sendJsonErr(res, 404, 'not_found', 'unknown annotation action');
}

async function handleLinks(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { root: string; lib: PaperLibrary; doc: ReturnType<PaperLibrary['getDocument']>; documentId: string; rest: string },
): Promise<void> {
  const { root, lib, doc, documentId, rest } = ctx;
  if (!doc) {
    sendJsonErr(res, 404, 'not_found', 'unknown document');
    return;
  }
  // No docType gate here: topic link is a document-level capability (#197).
  if (rest === 'links' && req.method === 'GET') {
    sendJson(res, 200, lib.listLinks(documentId).map((l) => ({
      documentId: l.paperId,
      surfaceType: l.surfaceType,
      surfaceId: l.surfaceId,
      rationale: l.rationale,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })));
    return;
  }
  if (rest === 'links' && req.method === 'POST') {
    const payload = await readJsonBody<{
      surfaceType?: string;
      surfaceId?: string;
      topic?: string;
      rationale?: string;
    }>(req, res);
    if (!payload) return;
    const surfaceType = payload.surfaceType === 'topic' || !payload.surfaceType ? 'topic' : payload.surfaceType;
    const topic = (payload.surfaceId ?? payload.topic ?? '').trim();
    if (surfaceType !== 'topic' || !topic) {
      sendJsonErr(res, 400, 'invalid_fields', 'surfaceType/topic is required');
      return;
    }
    if (!resolveTopicDir(root, topic)) {
      sendJsonErr(res, 404, 'unknown_topic', 'unknown topic');
      return;
    }
    const existed = lib.listLinks(documentId).some((l) => l.surfaceType === 'topic' && l.surfaceId === topic);
    try {
      runLibraryLink({
        cwd: root,
        paperId: documentId,
        topic,
        rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() || undefined : undefined,
        write: () => {},
      });
      sendJson(res, existed ? 200 : 201, { url: documentUrl(documentId) });
    } catch (err) {
      sendJsonErr(res, 400, 'link_failed', err instanceof Error ? err.message : String(err));
    }
    return;
  }
  const del = rest.match(/^links\/([^/]+)\/(.+)$/);
  if (del && req.method === 'DELETE') {
    if (!assertWriteAccess(req, res, { json: false })) return;
    const surfaceType = decodeURIComponent(del[1]);
    const surfaceId = decodeURIComponent(del[2]);
    if (surfaceType !== 'topic') {
      sendJsonErr(res, 400, 'invalid_fields', 'only topic links can be removed');
      return;
    }
    try {
      runLibraryUnlink({ cwd: root, paperId: documentId, topic: surfaceId, write: () => {} });
      res.writeHead(204);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJsonErr(res, /no link/i.test(message) ? 404 : 400, 'unlink_failed', message);
    }
    return;
  }
  sendJsonErr(res, 404, 'not_found', 'unknown link resource');
}

async function handleCreateNote(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const payload = await readJsonBody<{ docType?: string; id?: string; title?: string; body?: string; mutationId?: string }>(req, res);
  if (!payload) return;
  if (payload.docType !== 'note') {
    send(res, 400, 'application/json', JSON.stringify({ code: 'invalid_type', message: 'docType must be note' }));
    return;
  }
  if (typeof payload.id !== 'string' || typeof payload.title !== 'string' || typeof payload.body !== 'string' || typeof payload.mutationId !== 'string') {
    send(res, 400, 'application/json', JSON.stringify({ code: 'invalid_fields', message: 'id, title, body, mutationId required' }));
    return;
  }
  try {
    const lib = new PaperLibrary(root);
    const existed = Boolean(lib.getDocument(payload.id));
    const doc = lib.createNote({
      id: payload.id,
      title: payload.title,
      body: payload.body,
      mutationId: payload.mutationId,
    });
    send(res, existed ? 200 : 201, 'application/json; charset=utf-8', JSON.stringify({
      id: doc.id,
      revision: doc.revision,
      updatedAt: doc.updatedAt,
      url: `/library/documents/${encodeURIComponent(doc.id)}`,
    }));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    send(res, status, 'application/json', JSON.stringify({
      code: 'save_failed',
      message: err instanceof Error ? err.message : String(err),
      field: (err as { field?: string }).field,
    }));
  }
}

async function handlePatchVideoTitle(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  id: string,
): Promise<void> {
  const payload = await readJsonBody<{ title?: string; expectedRevision?: number; mutationId?: string }>(req, res);
  if (!payload) return;
  if (typeof payload.title !== 'string' || typeof payload.mutationId !== 'string' || typeof payload.expectedRevision !== 'number') {
    send(res, 400, 'application/json', JSON.stringify({
      code: 'invalid_fields',
      message: 'title, expectedRevision, mutationId required',
    }));
    return;
  }
  try {
    const doc = new PaperLibrary(root).updateVideoTitle({
      id,
      title: payload.title,
      expectedRevision: payload.expectedRevision,
      mutationId: payload.mutationId,
    });
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
      id: doc.id,
      title: doc.title,
      revision: doc.revision,
      updatedAt: doc.updatedAt,
      url: `/library/documents/${encodeURIComponent(doc.id)}`,
    }));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    send(res, status, 'application/json', JSON.stringify({
      code: 'save_failed',
      message: err instanceof Error ? err.message : String(err),
      field: (err as { field?: string }).field,
      currentRevision: (err as { currentRevision?: number }).currentRevision,
    }));
  }
}

async function handlePatchNote(req: IncomingMessage, res: ServerResponse, root: string, id: string): Promise<void> {
  const payload = await readJsonBody<{ title?: string; body?: string; expectedRevision?: number; mutationId?: string }>(req, res);
  if (!payload) return;
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string' || typeof payload.mutationId !== 'string' || typeof payload.expectedRevision !== 'number') {
    send(res, 400, 'application/json', JSON.stringify({ code: 'invalid_fields', message: 'title, body, expectedRevision, mutationId required' }));
    return;
  }
  try {
    const doc = new PaperLibrary(root).updateNote({
      id,
      title: payload.title,
      body: payload.body,
      expectedRevision: payload.expectedRevision,
      mutationId: payload.mutationId,
    });
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
      id: doc.id,
      revision: doc.revision,
      updatedAt: doc.updatedAt,
      url: `/library/documents/${encodeURIComponent(doc.id)}`,
    }));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    send(res, status, 'application/json', JSON.stringify({
      code: 'save_failed',
      message: err instanceof Error ? err.message : String(err),
      field: (err as { field?: string }).field,
      currentRevision: (err as { currentRevision?: number }).currentRevision,
    }));
  }
}

function hasCompletedRead(lib: PaperLibrary, root: string, paperId: string): boolean {
  return lib.listReads(paperId).some((r) => r.status === 'read' && r.artifactPath && existsSync(join(root, r.artifactPath)));
}

const PAPER_NOTE_KINDS = new Set(['note', 'clarification', 'caveat', 'idea', 'question']);

function parsePaperNoteKind(raw: string): 'note' | 'clarification' | 'caveat' | 'idea' | 'question' {
  if (PAPER_NOTE_KINDS.has(raw)) return raw as 'note' | 'clarification' | 'caveat' | 'idea' | 'question';
  throw new Error(`unknown note kind: ${raw}`);
}

async function handleCreateVideo(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (!sameOrigin(req)) {
    sendJsonErr(res, 403, 'forbidden_origin', 'cross-origin writes are not allowed');
    return;
  }
  const tmpDir = join(root, '.researcher-workspace', 'tmp');
  let upload: Awaited<ReturnType<typeof readMultipartVideo>>;
  try {
    upload = await readMultipartVideo(req, tmpDir);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    sendJsonErr(res, status, 'upload_failed', err instanceof Error ? err.message : String(err));
    return;
  }
  if (!upload.mutationId) {
    sendJsonErr(res, 400, 'invalid_fields', 'mutationId is required');
    return;
  }
  const lib = new PaperLibrary(root);
  const id = newDocumentId();
  try {
    const doc = lib.createVideo({
      id,
      sourcePath: upload.filePath,
      filename: upload.filename,
      contentType: upload.contentType,
      bytes: upload.bytes,
      mutationId: upload.mutationId,
    });
    sendJson(res, 201, { id: doc.id, url: documentUrl(doc.id) });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    sendJsonErr(res, status, 'ingest_failed', err instanceof Error ? err.message : String(err));
  } finally {
    try { unlinkSync(upload.filePath); } catch { /* tmp */ }
  }
}

async function handleRestoreVideo(req: IncomingMessage, res: ServerResponse, root: string, documentId: string): Promise<void> {
  if (!sameOrigin(req)) {
    sendJsonErr(res, 403, 'forbidden_origin', 'cross-origin writes are not allowed');
    return;
  }
  const tmpDir = join(root, '.researcher-workspace', 'tmp');
  let upload: Awaited<ReturnType<typeof readMultipartVideo>>;
  try {
    upload = await readMultipartVideo(req, tmpDir);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    sendJsonErr(res, status, 'upload_failed', err instanceof Error ? err.message : String(err));
    return;
  }
  try {
    new PaperLibrary(root).restoreVideoMedia({ id: documentId, sourcePath: upload.filePath, bytes: upload.bytes });
    res.writeHead(204);
    res.end();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    sendJsonErr(res, status, 'restore_failed', err instanceof Error ? err.message : String(err));
  } finally {
    try { unlinkSync(upload.filePath); } catch { /* tmp */ }
  }
}

async function handleStartVideoAnalysis(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  documentId: string,
  live: VideoAnalysisLiveSet,
  runner?: VideoAnalyzeRunner,
  videoTranslate?: CueTranslator,
): Promise<void> {
  const payload = await readJsonBody<{ mutationId?: string }>(req, res);
  if (!payload) return;
  const lib = new PaperLibrary(root);
  const doc = lib.getDocument(documentId);
  if (!doc) { sendJsonErr(res, 404, 'not_found', 'unknown document'); return; }
  if (!isVideoDocType(doc.docType)) { sendJsonErr(res, 422, 'unsupported_action', 'not a video'); return; }
  if (!lib.videoMediaExists(doc)) { sendJsonErr(res, 422, 'media_missing', 'media file is missing'); return; }
  const runtime = analyzeRuntime();
  if (!runner && runtime.missing.length) {
    sendJsonErr(res, 503, 'analyzer_unavailable', `${runtime.missing.join(' and ')} not found on PATH`);
    return;
  }
  const liveId = live.forDocument(documentId);
  if (liveId) {
    const rec = lib.getVideoAnalysis(documentId, liveId);
    if (payload.mutationId && rec?.mutationId === payload.mutationId) {
      sendJson(res, 202, { id: liveId, status: rec.status });
      return;
    }
    sendJsonErr(res, 409, 'analysis_in_progress', 'an analysis is already running');
    return;
  }
  const interrupted = lib.interruptStaleVideoAnalysis(documentId, (id) => live.has(id));
  if (
    payload.mutationId
    && interrupted
    && interrupted.mutationId === payload.mutationId
    && (interrupted.status === 'done' || interrupted.status === 'failed')
  ) {
    sendJson(res, 202, { id: interrupted.id, status: interrupted.status });
    return;
  }
  const latest = lib.latestVideoAnalysis(documentId);
  if (
    payload.mutationId
    && latest
    && latest.mutationId === payload.mutationId
    && (latest.status === 'done' || latest.status === 'failed')
  ) {
    sendJson(res, 202, { id: latest.id, status: latest.status });
    return;
  }
  const analysisId = newAnalysisId();
  const now = new Date().toISOString();
  lib.writeVideoAnalysis({
    id: analysisId,
    documentId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    mutationId: payload.mutationId,
  });
  live.add(documentId, analysisId);
  sendJson(res, 202, { id: analysisId, status: 'queued' });
  const translate = videoTranslate ?? (runner ? false : defaultTranslateToZh);
  void runVideoAnalysisJob({
    root, documentId, analysisId, live,
    runner: runner ?? defaultVideoAnalyzeRunner,
    translate,
  });
}

async function runVideoAnalysisJob(opts: {
  root: string;
  documentId: string;
  analysisId: string;
  live: VideoAnalysisLiveSet;
  runner: VideoAnalyzeRunner;
  translate: CueTranslator | false;
}): Promise<void> {
  const lib = new PaperLibrary(opts.root);
  const doc = lib.getDocument(opts.documentId);
  const existing = lib.getVideoAnalysis(opts.documentId, opts.analysisId);
  if (!doc || !existing) {
    opts.live.delete(opts.analysisId);
    return;
  }
  try {
    const started = { ...existing, status: 'running' as const, updatedAt: new Date().toISOString() };
    lib.writeVideoAnalysis(started);
    const workDir = join(opts.root, '.researcher-workspace', 'tmp', opts.analysisId);
    const result = await opts.runner({ mediaPath: lib.videoMediaPath(doc), workDir });
    let cues = result.cues;
    if (opts.translate) {
      cues = await attachChineseCues(cues, opts.translate);
    }
    const noSpeech = classifyAnalysis(cues).noSpeech;
    lib.writeVideoAnalysis({
      ...started,
      status: 'done',
      updatedAt: new Date().toISOString(),
      noSpeech,
      cues,
    });
  } catch (err) {
    const command = (err as { command?: string }).command;
    const message = err instanceof Error ? err.message : String(err);
    try {
      lib.writeVideoAnalysis({
        ...existing,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        lastError: command ? `${command}: ${message}` : message,
      });
    } catch {
      /* live set still cleared in finally */
    }
  } finally {
    opts.live.delete(opts.analysisId);
  }
}

function sendMediaRange(req: IncomingMessage, res: ServerResponse, path: string, contentType: string): void {
  const stat = statSync(path);
  const size = stat.size;
  const range = req.headers.range;
  if (!range || !range.startsWith('bytes=')) {
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': size,
      'accept-ranges': 'bytes',
    });
    createReadStream(path).pipe(res);
    return;
  }
  const spec = range.slice(6).split(',')[0];
  const [l, r] = spec.split('-');
  const start = l ? Number(l) : 0;
  let end = r ? Number(r) : size - 1;
  if (start < 0 || start >= size || end < start) {
    res.writeHead(416, { 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  end = Math.min(end, size - 1);
  res.writeHead(206, {
    'content-type': contentType,
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${size}`,
  });
  createReadStream(path, { start, end }).pipe(res);
}
