import './env'; // must be first: loads .env before anything reads process.env

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { ViteDevServer } from 'vite';

import type { HostAvatars, Platform } from '../shared/protocol';
import { createHub, type Hub } from './hub';
import { createGateway } from './ws-gateway';
import { startSources } from './sources';
import { createRuntimeConfig, StreamPatchSchema } from './runtime-config';
import type { RuntimeConfig } from './runtime-config';
import type { SourceManager } from './source-manager';
import { fetchHostAvatars } from './lib/avatars';
import { scoped } from './lib/log';
import { z } from 'zod';

const log = scoped('server');

interface ApiDeps {
  runtime: RuntimeConfig;
  hub: Hub;
  getManager: () => SourceManager | null;
  getAvatars: () => HostAvatars;
}

const ReconnectSchema = z.object({
  platform: z.enum(['twitch', 'kick', 'x', 'all']),
});

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Minimal CSRF guard: browsers send Origin on cross-site POSTs; reject mismatches.
// Non-browser clients (our tests, curl) send no Origin and are allowed.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<boolean> {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://internal').pathname;
  } catch {
    /* fall through to '/' */
  }
  if (!pathname.startsWith('/api/')) return false;
  const method = req.method || 'GET';
  const config = deps.runtime.getConfig();

  // boot bootstrap consumed by src/main.tsx
  if (pathname === '/api/config' && (method === 'GET' || method === 'HEAD')) {
    const body = JSON.stringify({
      twitchChannels: config.twitchChannels,
      xEnabled: config.x.enabled,
      hostAvatars: deps.getAvatars(),
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  }

  // settings surface: non-secret editable state + live status
  if (pathname === '/api/streams' && (method === 'GET' || method === 'HEAD')) {
    const body = JSON.stringify({ ...deps.runtime.publicState(), status: deps.hub.statusSnapshot() });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  }

  if (pathname === '/api/streams' && method === 'POST') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return true;
    }
    const parsed = StreamPatchSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid input', fields: parsed.error.flatten().fieldErrors });
      return true;
    }
    const { changedPlatforms } = deps.runtime.update(parsed.data);
    const mgr = deps.getManager();
    if (mgr) {
      await Promise.all(changedPlatforms.map((p) => mgr.restart(p)));
    }
    sendJson(res, 200, {
      ...deps.runtime.publicState(),
      status: deps.hub.statusSnapshot(),
      reconnected: mgr ? changedPlatforms : [],
    });
    return true;
  }

  if (pathname === '/api/streams/reconnect' && method === 'POST') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return true;
    }
    const parsed = ReconnectSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid platform' });
      return true;
    }
    const mgr = deps.getManager();
    if (mgr) {
      const targets: Platform[] = parsed.data.platform === 'all' ? ['twitch', 'kick', 'x'] : [parsed.data.platform];
      await Promise.all(targets.map((p) => mgr.restart(p)));
    }
    sendJson(res, 200, { ok: true, status: deps.hub.statusSnapshot() });
    return true;
  }

  const known =
    pathname === '/api/config' || pathname === '/api/streams' || pathname === '/api/streams/reconnect';
  sendJson(res, known ? 405 : 404, { error: known ? 'Method Not Allowed' : 'Not Found' });
  return true;
}

async function main() {
  const runtime = createRuntimeConfig();
  const config = runtime.getConfig();
  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = config.port;

  const hub = createHub();
  let started: { stop: () => void | Promise<void>; manager: SourceManager | null } | null = null;

  let hostAvatars: HostAvatars = {};
  const avatarsReady = fetchHostAvatars(config)
    .then((a) => {
      hostAvatars = a;
    })
    .catch(() => {
      /* fail-soft: letters */
    });

  const deps: ApiDeps = {
    runtime,
    hub,
    getManager: () => started?.manager ?? null,
    getAvatars: () => hostAvatars,
  };

  let webHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.statusCode = 503;
    res.end('starting');
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await handleApi(req, res, deps)) return;
        webHandler(req, res);
      } catch (err) {
        log.error('request failed', err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      }
    })();
  });

  let vite: ViteDevServer | null = null;
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    const middlewares = vite.middlewares;
    webHandler = (req, res) =>
      middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
  } else {
    const { default: sirv } = await import('sirv');
    const serve = sirv(path.resolve('dist'), { etag: true, single: true });
    webHandler = (req, res) =>
      serve(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
  }

  const wss = new WebSocketServer({ noServer: true });
  const gateway = createGateway(hub);

  server.on('upgrade', (req, socket: Duplex, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || hostname}`).pathname;
    } catch {
      /* fall through to '/' */
    }
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket as Socket, head, (ws) => gateway.handleConnection(ws));
      return;
    }
    if (dev && req.headers['sec-websocket-protocol'] === 'vite-hmr') return;
    socket.destroy();
  });

  started = startSources(hub, runtime);

  await Promise.race([
    avatarsReady,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5000).unref();
    }),
  ]);

  server.listen(port, () => {
    log(`ready on http://${hostname}:${port}  (dev=${dev}, sim=${config.sim.mode})`);
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);
    try {
      await started?.stop();
    } catch {
      /* noop */
    }
    gateway.close();
    wss.close();
    try {
      await vite?.close();
    } catch {
      /* noop */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
