// Run: npx tsx scripts/hub-status-test.ts
import { createHub } from '../server/hub';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const hub = createHub();
check('defaults to unavailable', hub.statusSnapshot().twitch === 'unavailable');
hub.setStatus('twitch', 'ok');
check('reflects setStatus', hub.statusSnapshot().twitch === 'ok');
const snap = hub.statusSnapshot();
snap.twitch = 'reconnecting';
check('returns a copy (no external mutation)', hub.statusSnapshot().twitch === 'ok');

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
