// Priority: Twitch if the host is live there, else Kick, else stick with the
// current platform while its cell is unknown (null), else fall back to Twitch.
// X must never be chosen. Cells: null = unknown, 0 = known offline, >0 = live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPlayerPlatform } from './player-source';
import type { HostCounts, ViewerMatrix } from './protocol';

function matrix(over: Partial<Record<'twitch' | 'kick' | 'x', HostCounts>>): ViewerMatrix {
  return {
    twitch: { banks: null, ansem: null },
    kick: { banks: null, ansem: null },
    x: { banks: null, ansem: null },
    ...over,
  };
}

test('prefers twitch when the host is live there', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
});

test('twitch wins even when kick is also live', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 900, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('falls through to kick when twitch is known offline', () => {
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: 800, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'kick');
});

test('selection is per host: banks on twitch, ansem on kick', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 0, ansem: 800 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
  assert.equal(pickPlayerPlatform(v, 'ansem', 'twitch'), 'kick');
});

test('x liveness is never considered', () => {
  const v = matrix({
    twitch: { banks: 0, ansem: 0 },
    kick: { banks: 0, ansem: 0 },
    x: { banks: 5000, ansem: 5000 },
  });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch'); // falls back, never 'x'
});

test('sticks with the current platform while its cell is unknown', () => {
  // kick poll failed (null) while twitch reports known offline — do not flap off kick
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: null, ansem: null } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'kick');
});

test('does not stick when the current platform is known offline', () => {
  const v = matrix({ twitch: { banks: null, ansem: null }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('falls back to twitch when both are known offline', () => {
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('everything unknown keeps the current choice', () => {
  const v = matrix({});
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'kick');
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
});
