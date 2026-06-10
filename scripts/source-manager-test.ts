// Run: npx tsx scripts/source-manager-test.ts
import { createSourceManager, type SourceStarter } from '../server/source-manager';
import { createRuntimeConfig } from '../server/runtime-config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-sm-'));
const rc = createRuntimeConfig({ filePath: path.join(dir, 's.json') });

const log: string[] = [];
const seenChannels: string[] = [];
function fake(name: string): SourceStarter {
  return (_hub, config) => {
    log.push('start:' + name);
    if (name === 'twitch') seenChannels.push(config.twitchChannels.banks);
    return () => log.push('stop:' + name);
  };
}

const hub = {} as never; // fakes ignore the hub
const mgr = createSourceManager(hub, rc, {
  twitch: fake('twitch'),
  kick: fake('kick'),
  x: fake('x'),
});

try {
  mgr.startAll();
  check('startAll starts all three', log.filter((l) => l.startsWith('start:')).length === 3);

  log.length = 0;
  rc.update({ twitchChannels: { banks: 'newchan' } });
  await mgr.restart('twitch');
  check('restart stops then starts the platform', JSON.stringify(log) === '["stop:twitch","start:twitch"]');
  check('restart uses fresh config', seenChannels[seenChannels.length - 1] === 'newchan');

  log.length = 0;
  await mgr.stopAll();
  check('stopAll stops all running sources', log.filter((l) => l.startsWith('stop:')).length === 3);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
