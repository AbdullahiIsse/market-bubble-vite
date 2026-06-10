import './env'; // must be first: loads .env before anything reads process.env

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { ViteDevServer } from 'vite';

import type { HostAvatars } from '../shared/protocol';
import { loadConfig, type AppConfig } from './config';
import { createHub } from './hub';
import { createGateway } from './ws-gateway';
import { startSources } from './sources';
import { fetchHostAvatars } from './lib/avatars';
import { scoped } from './lib/log';

const log = scoped('server');

// The read-only JSON surface the browser needs (was app/api/config/route.ts).
// Runs BEFORE the SPA handler so unknown /api/* paths 404 instead of falling
// back to index.html (audit.mjs asserts POST /api/chat/send -> 404).
function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  hostAvatars: HostAvatars,
): boolean {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://internal').pathname;
  } catch {
    /* fall through to '/' */
  }
  if (!pathname.startsWith('/api/')) return false;

  if (pathname === '/api/config' && (req.method === 'GET' || req.method === 'HEAD')) {
    const body = JSON.stringify({
      twitchChannels: config.twitchChannels,
      xEnabled: config.x.enabled,
      hostAvatars,
    });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
  const status = pathname === '/api/config' ? 405 : 404;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: status === 405 ? 'Method Not Allowed' : 'Not Found' }));
  return true;
}

async function main() {
  const config = loadConfig();
  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = config.port;

  // host avatars: start now (overlaps Vite/sirv init), bounded-await before
  // listen. A late resolution still lands — handleApi reads the live binding.
  let hostAvatars: HostAvatars = {};
  const avatarsReady = fetchHostAvatars(config)
    .then((a) => {
      hostAvatars = a;
    })
    .catch(() => {
      /* fail-soft: letters */
    });

  // Assigned below: Vite middleware (dev) or sirv over dist/ (prod). The http
  // server must exist first so Vite can attach its HMR websocket to it.
  let webHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.statusCode = 503;
    res.end('starting');
  };

  const server = createServer((req, res) => {
    if (handleApi(req, res, config, hostAvatars)) return;
    webHandler(req, res);
  });

  let vite: ViteDevServer | null = null;
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      // middlewareMode defaults appType to 'custom' — 'spa' must be explicit
      // or Vite won't serve/transform index.html.
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

  // our chat stream lives at /ws; in dev, Vite's HMR websocket shares this
  // server via its OWN 'upgrade' listener (registered because hmr.server was
  // passed) which only claims sec-websocket-protocol === 'vite-hmr'.
  const wss = new WebSocketServer({ noServer: true });
  const hub = createHub();
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
    // dev: do NOTHING for Vite's HMR upgrades — Vite's own listener handles them.
    if (dev && req.headers['sec-websocket-protocol'] === 'vite-hmr') return;
    socket.destroy(); // prod (or unknown dev upgrade): nothing else owns upgrades
  });

  const stopSources = await startSources(hub, config);

  // give avatars max 5s to land before accepting traffic; never block boot longer
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
      await stopSources?.();
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
    // hard cap so a hung socket can't block exit
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
