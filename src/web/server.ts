import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadLibrary, loadLibraryPaper, loadTopic, loadWorkspaceHome, resolveTopicDir } from './discovery.js';
import { renderLibrary, renderLibraryPaper, renderTopic, renderDoc, renderTopics, renderWorkspaceHome } from './views.js';
import { safeDocPath, safePaperPath } from './safe-path.js';
import { TaskRegistry } from './tasks.js';
import { defaultLibraryReadRunner, type LibraryReadRunner } from './library-read.js';
import { resolveWorkspaceManifestPath } from '../workspace/manifest.js';
import { parseRelation, parseTags, runLibraryAdd, runLibraryDelete, runLibraryLink } from '../commands/library.js';
import { normalizePaperInput, paperIdForSource } from '../library/identity.js';
import { PaperLibrary } from '../library/store.js';
import type { Stage } from '../state/runs.js';

export interface ServeOptions {
  root: string;
  port: number;
  registry?: TaskRegistry;
  libraryReadRunner?: LibraryReadRunner;
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
    handle(req, res, opts.root, registry, libraryReadRunner).catch((err) => {
      send(res, 500, 'text/plain', String(err instanceof Error ? err.message : err));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  registry: TaskRegistry,
  libraryReadRunner: LibraryReadRunner,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  // GET /
  if (req.method === 'GET' && path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderWorkspaceHome(loadWorkspaceHome(root)));
  }
  // GET /topics
  if (req.method === 'GET' && path === '/topics') {
    return send(res, 200, 'text/html; charset=utf-8', renderTopics(loadDashboard(root)));
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
    try {
      runLibraryAdd({
        cwd: root,
        input,
        tags: form.has('tags') ? parseTags(form.get('tags') ?? '') : undefined,
        write: () => {},
      });
      if (topic) {
        const paperId = paperIdForSource(normalizePaperInput(input));
        runLibraryLink({ cwd: root, paperId, topic, relation: 'candidate', write: () => {} });
      }
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
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
  // POST /library/link
  if (req.method === 'POST' && path === '/library/link') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const paperId = form.get('paperId')?.trim() ?? '';
    const topic = form.get('topic')?.trim() ?? '';
    const relationRaw = form.get('relation')?.trim() || 'candidate';
    const rationale = form.get('rationale')?.trim() || undefined;
    if (!paperId) return send(res, 400, 'text/plain', 'missing paper id');
    if (!topic) return send(res, 400, 'text/plain', 'missing topic');
    if (!resolveTopicDir(root, topic)) return send(res, 404, 'text/plain', 'unknown topic');
    const lib = new PaperLibrary(root);
    if (!lib.getPaper(paperId)) return send(res, 404, 'text/plain', 'unknown paper');
    try {
      runLibraryLink({ cwd: root, paperId, topic, relation: parseRelation(relationRaw), rationale, write: () => {} });
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
        res.write(`event: end\ndata: ${JSON.stringify({ status: task.status, exitCode: task.exitCode })}\n\n`);
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
    return send(res, 200, 'text/html; charset=utf-8', renderLibraryPaper(paper, activeRead));
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

    // GET /t/:slug — uses loadTopic which already null-guards against the manifest
    if (req.method === 'GET' && !sub) {
      const view = loadTopic(root, slug);
      if (!view) return send(res, 404, 'text/plain', 'unknown topic');
      const active = registry.activeTask(decodeURIComponent(slug));
      const activeRun = active ? { taskId: active.id, startedAt: active.startedAt } : null;
      return send(res, 200, 'text/html; charset=utf-8', renderTopic(view, activeRun));
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
      return send(res, 200, 'text/html; charset=utf-8', renderDoc(readFileSync(abs, 'utf8')));
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
      const task = registry.start(decoded, topicDir, root);
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
          res.write(`event: end\ndata: ${JSON.stringify({ status: task.status, exitCode: task.exitCode })}\n\n`);
          res.end();
        },
      );
      req.on('close', unsub);
      return;
    }
  }

  send(res, 404, 'text/plain', 'not found');
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
