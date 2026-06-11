// Idle chat clear: while every platform is KNOWN offline, chat that has gone
// silent for chatIdleClearMs is wiped (clearChat no-ops when already empty).
// Uses real (shortened) timers — generous margins because timers fire late,
// never early.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from './hub';
import type { ChatMessage, HostCounts, ServerEvent } from '../shared/protocol';

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

// Channel maps: snapshot and the config broadcast must carry BOTH the twitch
// channels and the kick slugs, so the player can retarget either embed live.
const TW = { banks: 'fazebanks', ansem: 'ansem' };
const KS = { banks: 'banks-kick', ansem: 'ansem-kick' };

test('snapshot and config broadcast carry both channel maps', () => {
  const hub = createHub();
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const cfg = events.find((e) => e.type === 'config');
  assert.deepEqual(cfg, { type: 'config', twitchChannels: TW, kickSlugs: KS });
  const snap = hub.snapshot();
  assert.deepEqual(snap.twitchChannels, TW);
  assert.deepEqual(snap.kickSlugs, KS);
});

test('a kick-only slug change still broadcasts a config event', () => {
  const hub = createHub();
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: TW, kickSlugs: { ...KS, ansem: 'moved' } });
  assert.equal(events.filter((e) => e.type === 'config').length, 1);
});

test('setChannels with unchanged values does not broadcast', () => {
  const hub = createHub();
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: { ...TW }, kickSlugs: { ...KS } });
  assert.equal(events.length, 0);
});
