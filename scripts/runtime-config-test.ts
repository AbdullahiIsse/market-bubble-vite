// Unit test for the runtime stream-settings overlay. Run: npx tsx scripts/runtime-config-test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeConfig } from '../server/runtime-config';

const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-rc-'));
const file = path.join(dir, 'streams.local.json');

try {
  // defaults come from env/config (TWITCH_CHANNEL_BANKS default is 'fazebanks')
  const rc = createRuntimeConfig({ filePath: file });
  check('default twitch banks present', typeof rc.getConfig().twitchChannels.banks === 'string');

  // update a twitch channel -> twitch is the only changed platform
  const r1 = rc.update({ twitchChannels: { banks: 'jynxzi' } });
  check('twitch change -> changedPlatforms=[twitch]', JSON.stringify(r1.changedPlatforms) === '["twitch"]');
  check('getConfig reflects new channel', rc.getConfig().twitchChannels.banks === 'jynxzi');

  // cookies are write-only: publicState hides them, exposes xCookiesSet
  rc.update({ xAuthToken: 'tok', xCt0: 'csrf', xEnabled: true });
  const pub = rc.publicState() as Record<string, unknown>;
  check('publicState hides auth token', !('xAuthToken' in pub) && !('xCt0' in pub));
  check('xCookiesSet true once both set', pub.xCookiesSet === true);

  const rcHalf = createRuntimeConfig({ filePath: path.join(dir, 'half.json') });
  rcHalf.update({ xAuthToken: 'tok' }); // ct0 missing
  check('xCookiesSet false with only authToken', rcHalf.publicState().xCookiesSet === false);

  check('getConfig exposes cookies server-side', rc.getConfig().x.authToken === 'tok');

  // empty cookie value = "keep existing", not "clear"
  rc.update({ xAuthToken: '' });
  check('empty cookie keeps existing', rc.getConfig().x.authToken === 'tok');

  // kick change -> kick platform
  const r2 = rc.update({ kickChatroomIds: { ansem: '999' } });
  check('kick chatroom change -> [kick]', JSON.stringify(r2.changedPlatforms) === '["kick"]');

  // a slug change clears a pinned chatroom id when the id isn't in the same patch
  // (otherwise chat would stay on the old chatroom while viewers follow the new slug)
  const rcKick = createRuntimeConfig({ filePath: path.join(dir, 'kick.json') });
  rcKick.update({ kickChatroomIds: { banks: '61792777' } });
  rcKick.update({ kickSlugs: { banks: 'newslug' } }); // slug only -> stale id clears
  check('slug-only change clears the stale chatroom id', rcKick.getConfig().kickChatroomIds.banks === '');
  // but a slug + id in the same patch keeps the explicitly-provided id
  rcKick.update({ kickSlugs: { banks: 'another' }, kickChatroomIds: { banks: '12345' } });
  check('slug + id in one patch keeps the id', rcKick.getConfig().kickChatroomIds.banks === '12345');

  // persistence: a fresh store from the same file restores edits (file wins over env)
  const rc2 = createRuntimeConfig({ filePath: file });
  check('persisted twitch channel restored', rc2.getConfig().twitchChannels.banks === 'jynxzi');
  check('persisted cookie restored', rc2.getConfig().x.authToken === 'tok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
