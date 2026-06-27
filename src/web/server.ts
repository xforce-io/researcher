import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDashboard, loadTopic, resolveTopicDir } from './discovery.js';
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

    // GET /t/:slug — uses loadTopic which already null-guards against the manifest
    if (req.method === 'GET' && !sub) {
      const view = loadTopic(root, slug);
      if (!view) return send(res, 404, 'text/plain', 'unknown topic');
      return send(res, 200, 'text/html; charset=utf-8', renderTopic(view));
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
        () => { res.write(`event: end\ndata: {}\n\n`); res.end(); },
      );
      req.on('close', unsub);
      return;
    }
  }

  send(res, 404, 'text/plain', 'not found');
}
