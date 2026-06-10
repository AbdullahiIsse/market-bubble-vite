// Probe the X live-broadcast chat chain end-to-end using the owner cookies in
// .env.local. Prints what each step returns so X adapter failures can be
// localized (bad id / dead cookies / ended broadcast / chat endpoint change).
//   node scripts/x-probe.mjs [broadcastIdOrUrl]
import { config } from 'dotenv';
import { WebSocket } from 'ws';

config({ path: ['.env.local', '.env'], quiet: true });

const DEFAULT_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7' +
  'ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const raw = process.argv[2] || process.env.X_BROADCAST_ID_BANKS || '';
const m = raw.match(/broadcasts\/([A-Za-z0-9_-]+)/);
const id = m ? m[1] : raw.trim();
const { X_AUTH_TOKEN: auth, X_CT0: ct0 } = process.env;
if (!id || !auth || !ct0) {
  console.error('need X_AUTH_TOKEN, X_CT0 and a broadcast id/url');
  process.exit(1);
}
console.log(`broadcast id: ${id} (from "${raw.slice(0, 60)}")`);

const headers = {
  Authorization: 'Bearer ' + (process.env.X_BEARER || DEFAULT_BEARER),
  Cookie: `auth_token=${auth}; ct0=${ct0}`,
  'x-csrf-token': ct0,
  'x-twitter-auth-type': 'OAuth2Session',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// 1) show.json — state, viewers, media_key
const show = await getJson(
  `https://api.x.com/1.1/broadcasts/show.json?ids=${encodeURIComponent(id)}`,
  { headers },
);
const b = show.broadcasts?.[id];
if (!b) throw new Error('no broadcasts[' + id + '] in show.json response');
console.log(`1. show.json        state=${b.state} watching=${b.total_watching} media_key=${b.media_key}`);

// 2) live_video_stream/status — chatToken lives here, not in show.json
let status;
for (const base of ['https://api.x.com/1.1', 'https://x.com/i/api/1.1']) {
  try {
    status = await getJson(`${base}/live_video_stream/status/${b.media_key}`, { headers });
    console.log(`2. stream status     ok via ${base} chatToken=${status.chatToken ? 'present' : 'MISSING'}`);
    break;
  } catch (err) {
    console.log(`2. stream status     ${base} failed: ${String(err.message).split('\n')[0]}`);
  }
}
if (!status?.chatToken) process.exit(1);

// 3) accessChatPublic — chat endpoint + access token
const access = await getJson('https://proxsee.pscp.tv/api/v2/accessChatPublic', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_token: status.chatToken }),
});
console.log(
  `3. accessChatPublic  endpoint=${access.endpoint} room=${access.room_id} token=${access.access_token ? 'present' : 'MISSING'}`,
);

// 4) chat websocket — auth, join room, count frames for 15s
const wsUrl = access.endpoint.replace(/^https?:/, 'wss:') + '/chatapi/v1/chatnow';
const ws = new WebSocket(wsUrl);
let frames = 0;
ws.on('open', () => {
  console.log(`4. ws open           ${wsUrl}`);
  ws.send(JSON.stringify({ payload: JSON.stringify({ access_token: access.access_token }), kind: 3 }));
  ws.send(
    JSON.stringify({
      payload: JSON.stringify({ body: JSON.stringify({ room: access.room_id || id }), kind: 1 }),
      kind: 2,
    }),
  );
});
ws.on('message', (data) => {
  frames++;
  if (frames > 8) return;
  try {
    const env = JSON.parse(data.toString('utf8'));
    let detail = '';
    if (env.kind === 1 && env.payload) {
      const payload = JSON.parse(env.payload);
      const body = payload.body ? JSON.parse(payload.body) : {};
      detail = ` type=${body.type} user=${body.username ?? payload.sender?.username} text=${JSON.stringify(
        (body.body ?? '').slice(0, 60),
      )}`;
    }
    console.log(`   frame kind=${env.kind}${detail}`);
  } catch {
    console.log('   frame (unparsed)');
  }
});
ws.on('error', (err) => console.log('   ws error:', err.message));
setTimeout(() => {
  console.log(`done — ${frames} frames in 15s`);
  ws.close();
  process.exit(0);
}, 15000);
