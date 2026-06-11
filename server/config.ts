// Parses process.env into a typed AppConfig. Missing platform keys are not an
// error — the corresponding source simply boots as `unavailable`.
import { z } from 'zod';
import type { Host } from '../shared/protocol';
import { randomSecret } from './lib/admin-auth';

export type { Host };

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v === '1' || v.toLowerCase() === 'true'));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const str = (def = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v));

const EnvSchema = z.object({
  PORT: int(3000),

  TWITCH_CHANNEL_BANKS: str('fazebanks'),
  TWITCH_CHANNEL_ANSEM: str('ansem'),
  KICK_SLUG_BANKS: str('fazebanks'),
  KICK_SLUG_ANSEM: str('ansem'),

  TWITCH_CLIENT_ID: str(''),
  TWITCH_CLIENT_SECRET: str(''),
  KICK_CLIENT_ID: str(''),
  KICK_CLIENT_SECRET: str(''),

  KICK_PUSHER_KEY: str('32cbd69e4b950bf97679'),
  KICK_PUSHER_CLUSTER: str('us2'),
  KICK_CHATROOM_ID_BANKS: str(''),
  KICK_CHATROOM_ID_ANSEM: str(''),

  X_ENABLED: bool(false),
  X_AUTH_TOKEN: str(''),
  X_CT0: str(''),
  X_BEARER: str(''),
  X_BROADCAST_ID_BANKS: str(''),
  X_BROADCAST_ID_ANSEM: str(''),

  ADMIN_PASSWORD: str(''),
  SESSION_SECRET: str(''),

  SIM_MODE: bool(false),
  SIM_RATE: int(90),
  SIM_BROADCAST: z
    .enum(['live', 'offline'])
    .optional()
    .transform((v) => v ?? 'live'),
  SIM_FLAP: bool(false),
  VIEWER_POLL_MS: int(10000),
});

export interface AppConfig {
  port: number;

  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;

  twitch: { clientId: string; clientSecret: string; configured: boolean };
  kick: { clientId: string; clientSecret: string; configured: boolean };

  kickPusher: { key: string; cluster: string };
  kickChatroomIds: Record<Host, string>;

  x: {
    enabled: boolean;
    authToken: string;
    ct0: string;
    bearer: string;
    broadcastIds: Record<Host, string>;
  };

  sim: {
    mode: boolean;
    rate: number;
    broadcast: 'live' | 'offline';
    flap: boolean;
  };

  admin: {
    password: string;
    sessionSecret: string;
    configured: boolean;
  };

  viewerPollMs: number;
}

export function loadConfig(): AppConfig {
  let e: z.infer<typeof EnvSchema>;
  try {
    e = EnvSchema.parse(process.env);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`).join('; ');
      throw new Error('Invalid environment configuration — ' + issues);
    }
    throw err;
  }
  return {
    port: e.PORT,
    twitchChannels: { banks: e.TWITCH_CHANNEL_BANKS, ansem: e.TWITCH_CHANNEL_ANSEM },
    kickSlugs: { banks: e.KICK_SLUG_BANKS, ansem: e.KICK_SLUG_ANSEM },
    twitch: {
      clientId: e.TWITCH_CLIENT_ID,
      clientSecret: e.TWITCH_CLIENT_SECRET,
      configured: !!(e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET),
    },
    kick: {
      clientId: e.KICK_CLIENT_ID,
      clientSecret: e.KICK_CLIENT_SECRET,
      configured: !!(e.KICK_CLIENT_ID && e.KICK_CLIENT_SECRET),
    },
    kickPusher: { key: e.KICK_PUSHER_KEY, cluster: e.KICK_PUSHER_CLUSTER },
    kickChatroomIds: {
      banks: e.KICK_CHATROOM_ID_BANKS,
      ansem: e.KICK_CHATROOM_ID_ANSEM,
    },
    x: {
      enabled: e.X_ENABLED,
      authToken: e.X_AUTH_TOKEN,
      ct0: e.X_CT0,
      bearer: e.X_BEARER,
      broadcastIds: { banks: e.X_BROADCAST_ID_BANKS, ansem: e.X_BROADCAST_ID_ANSEM },
    },
    sim: {
      mode: e.SIM_MODE,
      rate: e.SIM_RATE,
      broadcast: e.SIM_BROADCAST,
      flap: e.SIM_FLAP,
    },
    admin: {
      password: e.ADMIN_PASSWORD,
      sessionSecret: e.SESSION_SECRET || (e.ADMIN_PASSWORD ? randomSecret() : ''),
      configured: !!e.ADMIN_PASSWORD,
    },
    viewerPollMs: e.VIEWER_POLL_MS,
  };
}
