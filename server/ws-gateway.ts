// Bridges the hub to websocket clients: snapshot-on-connect, single-stringify
// fan-out, heartbeat, and a backpressure kill-switch.
import type { WebSocket } from 'ws';
import type { Hub } from './hub';
import type { ServerEvent } from '../shared/protocol';
import { scoped } from './lib/log';

const log = scoped('ws');
const PING_MS = 30000;
const MAX_BUFFERED = 1024 * 1024; // 1MB: a stuck client gets terminated

interface Client {
  ws: WebSocket;
  alive: boolean;
}

export interface Gateway {
  handleConnection(ws: WebSocket): void;
  close(): void;
}

export function createGateway(hub: Hub): Gateway {
  const clients = new Set<Client>();

  // one hub subscription for all clients — stringify each event once
  const unsubscribe = hub.subscribe((event: ServerEvent) => {
    const data = JSON.stringify(event);
    for (const c of clients) send(c, data);
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* terminated below on next sweep */
      }
    }
  }, PING_MS);

  function send(c: Client, data: string) {
    if (c.ws.readyState !== c.ws.OPEN) return;
    if (c.ws.bufferedAmount > MAX_BUFFERED) {
      log.warn('backpressure, terminating slow client');
      c.ws.terminate();
      clients.delete(c);
      return;
    }
    c.ws.send(data);
  }

  return {
    handleConnection(ws) {
      const client: Client = { ws, alive: true };
      clients.add(client);
      // immediate state for the new client
      send(client, JSON.stringify(hub.snapshot()));

      ws.on('pong', () => {
        client.alive = true;
      });
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => {
        clients.delete(client);
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
      });
      // clients are read-only; ignore any inbound frames
    },

    close() {
      clearInterval(heartbeat);
      unsubscribe();
      for (const c of clients) {
        try {
          c.ws.close();
        } catch {
          /* noop */
        }
      }
      clients.clear();
    },
  };
}
