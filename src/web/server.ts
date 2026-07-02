import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadLibrary, loadTopic, resolveTopicDir } from './discovery.js';
import { renderDashboard, renderLibrary, renderTopic, renderDoc } from './views.js';
import { safeDocPath, safePaperPath } from './safe-path.js';
import { TaskRegistry } from './tasks.js';
import { resolveWorkspaceManifestPath } from '../workspace/manifest.js';
import { parseTags, runLibraryAdd } from '../commands/library.js';

export interface ServeOptions { root: string; port: number; registry?: TaskRegistry; }

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');

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
  // GET /library
  if (req.method === 'GET' && path === '/library') {
    return send(res, 200, 'text/html; charset=utf-8', renderLibrary(loadLibrary(root, url.searchParams.get('paper'))));
  }
  // POST /library/add
  if (req.method === 'POST' && path === '/library/add') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);
    const input = form.get('input')?.trim() ?? '';
    if (!input) return send(res, 400, 'text/plain', 'missing paper source');
    try {
      runLibraryAdd({
        cwd: root,
        input,
        tags: form.has('tags') ? parseTags(form.get('tags') ?? '') : undefined,
        write: () => {},
      });
    } catch (err) {
      return send(res, 400, 'text/plain', err instanceof Error ? err.message : String(err));
    }
    return redirect(res, '/library');
  }
  const lm = path.match(/^\/library\/p\/([^/]+)$/);
  if (req.method === 'GET' && lm) {
    return redirect(res, `/library?paper=${encodeURIComponent(decodeURIComponent(lm[1]))}`);
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
      const task = registry.start(decoded, topicDir);
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
