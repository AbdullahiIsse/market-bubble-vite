// Idle chat clear: while every platform is KNOWN offline, chat that has gone
// silent for chatIdleClearMs is wiped (clearChat no-ops when already empty).
// Uses real (shortened) timers — generous margins because timers fire late,
// never early.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from './hub';
import type { ChatMessage, HostCounts } from '../shared/protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
function msg(): ChatMessage {
  seq += 1;
  return { id: `twitch:${seq}`, platform: 'twitch', host: 'banks', user: 'u', text: 'hi', ts: seq };
}

const COUNTS: HostCounts = { banks: 100, ansem: 50 };

test('wipes chat after the idle window passes with no new chat while known offline', async () => {
  const hub = createHub({ chatIdleClearMs: 60 });
  hub.setPlatformViewers('twitch', COUNTS, false); // poll landed => offline is KNOWN
  hub.ingestMessage(msg());
  await sleep(160);
  assert.equal(hub.snapshot().messages.length, 0);
});

test('a new message resets the idle window', async () => {
  const hub = createHub({ chatIdleClearMs: 150 });
  hub.setPlatformViewers('twitch', COUNTS, false);
  hub.ingestMessage(msg());
  await sleep(80);
  hub.ingestMessage(msg()); // silence broken — window restarts
  await sleep(80); // >150ms since first message, <150ms since second
  assert.equal(hub.snapshot().messages.length, 2);
  await sleep(250); // now well past the window since the second message
  assert.equal(hub.snapshot().messages.length, 0);
});

test('does not wipe while any platform is live', async () => {
  const hub = createHub({ chatIdleClearMs: 60 });
  hub.setPlatformViewers('twitch', COUNTS, true);
  hub.ingestMessage(msg());
  await sleep(160);
  assert.equal(hub.snapshot().messages.length, 1);
});

test('does not wipe while liveness is unknown (no poll has landed)', async () => {
  const hub = createHub({ chatIdleClearMs: 60 });
  hub.ingestMessage(msg());
  await sleep(160);
  assert.equal(hub.snapshot().messages.length, 1);
});

test('going live cancels a pending idle wipe', async () => {
  const hub = createHub({ chatIdleClearMs: 150 });
  hub.setPlatformViewers('twitch', COUNTS, false);
  hub.ingestMessage(msg());
  await sleep(50);
  hub.setPlatformViewers('kick', COUNTS, true); // back live before the window elapsed
  await sleep(300);
  assert.equal(hub.snapshot().messages.length, 1);
});
