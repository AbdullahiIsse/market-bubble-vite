// Mutable overlay of the OWNER-editable stream settings on top of the env-derived
// AppConfig. Precedence: persisted runtime file > .env.local > built-in defaults.
// Cookies (auth_token/ct0) are stored here but are WRITE-ONLY to the API:
// publicState() never returns them, only a boolean `xCookiesSet`.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Host, Platform } from '../shared/protocol';
import { loadConfig, type AppConfig } from './config';

const DEFAULT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'streams.local.json',
);

export interface StreamSettings {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xAuthToken: string;
  xCt0: string;
}

export interface StreamPublicState {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xCookiesSet: boolean;
}

const hostMap = (inner: z.ZodString) => z.object({ banks: inner, ansem: inner }).partial();

// Patch from the API: every field optional; channels/slugs non-empty when present.
export const StreamPatchSchema = z
  .object({
    twitchChannels: hostMap(z.string().min(1, 'channel required')).optional(),
    kickSlugs: hostMap(z.string().min(1, 'slug required')).optional(),
    kickChatroomIds: hostMap(z.string()).optional(),
    xBroadcastIds: hostMap(z.string()).optional(),
    xEnabled: z.boolean().optional(),
    xAuthToken: z.string().optional(),
    xCt0: z.string().optional(),
  })
  .strict();
export type StreamPatch = z.infer<typeof StreamPatchSchema>;

export interface RuntimeConfig {
  getConfig(): AppConfig;
  publicState(): StreamPublicState;
  update(patch: StreamPatch): { changedPlatforms: Platform[] };
}

export function createRuntimeConfig(opts: { filePath?: string } = {}): RuntimeConfig {
  const filePath = opts.filePath ?? process.env.STREAMS_CONFIG_PATH ?? DEFAULT_FILE;
  const base = loadConfig();

  const settings: StreamSettings = {
    twitchChannels: { ...base.twitchChannels },
    kickSlugs: { ...base.kickSlugs },
    kickChatroomIds: { ...base.kickChatroomIds },
    xBroadcastIds: { ...base.x.broadcastIds },
    xEnabled: base.x.enabled,
    xAuthToken: base.x.authToken,
    xCt0: base.x.ct0,
  };

  // layer the persisted overrides (if any) on top of the env defaults
  if (existsSync(filePath)) {
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StreamSettings>;
      for (const host of ['banks', 'ansem'] as Host[]) {
        if (saved.twitchChannels?.[host] != null) settings.twitchChannels[host] = saved.twitchChannels[host]!;
        if (saved.kickSlugs?.[host] != null) settings.kickSlugs[host] = saved.kickSlugs[host]!;
        if (saved.kickChatroomIds?.[host] != null) settings.kickChatroomIds[host] = saved.kickChatroomIds[host]!;
        if (saved.xBroadcastIds?.[host] != null) settings.xBroadcastIds[host] = saved.xBroadcastIds[host]!;
      }
      if (typeof saved.xEnabled === 'boolean') settings.xEnabled = saved.xEnabled;
      if (saved.xAuthToken) settings.xAuthToken = saved.xAuthToken;
      if (saved.xCt0) settings.xCt0 = saved.xCt0;
    } catch {
      /* corrupt file: ignore, fall back to env defaults */
    }
  }

  function persist() {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    renameSync(tmp, filePath);
  }

  function getConfig(): AppConfig {
    return {
      ...base,
      twitchChannels: { ...settings.twitchChannels },
      kickSlugs: { ...settings.kickSlugs },
      kickChatroomIds: { ...settings.kickChatroomIds },
      x: {
        ...base.x,
        enabled: settings.xEnabled,
        authToken: settings.xAuthToken,
        ct0: settings.xCt0,
        broadcastIds: { ...settings.xBroadcastIds },
      },
    };
  }

  function publicState(): StreamPublicState {
    return {
      twitchChannels: { ...settings.twitchChannels },
      kickSlugs: { ...settings.kickSlugs },
      kickChatroomIds: { ...settings.kickChatroomIds },
      xBroadcastIds: { ...settings.xBroadcastIds },
      xEnabled: settings.xEnabled,
      xCookiesSet: !!(settings.xAuthToken && settings.xCt0),
    };
  }

  function update(patch: StreamPatch): { changedPlatforms: Platform[] } {
    const changed = new Set<Platform>();

    for (const host of ['banks', 'ansem'] as Host[]) {
      if (patch.twitchChannels?.[host] != null && patch.twitchChannels[host] !== settings.twitchChannels[host]) {
        settings.twitchChannels[host] = patch.twitchChannels[host]!;
        changed.add('twitch');
      }
      if (patch.kickSlugs?.[host] != null && patch.kickSlugs[host] !== settings.kickSlugs[host]) {
        settings.kickSlugs[host] = patch.kickSlugs[host]!;
        changed.add('kick');
      }
      if (patch.kickChatroomIds?.[host] != null && patch.kickChatroomIds[host] !== settings.kickChatroomIds[host]) {
        settings.kickChatroomIds[host] = patch.kickChatroomIds[host]!;
        changed.add('kick');
      }
      if (patch.xBroadcastIds?.[host] != null && patch.xBroadcastIds[host] !== settings.xBroadcastIds[host]) {
        settings.xBroadcastIds[host] = patch.xBroadcastIds[host]!;
        changed.add('x');
      }
    }
    if (typeof patch.xEnabled === 'boolean' && patch.xEnabled !== settings.xEnabled) {
      settings.xEnabled = patch.xEnabled;
      changed.add('x');
    }
    // cookies: only a NON-EMPTY value updates; empty/omitted keeps existing
    if (patch.xAuthToken && patch.xAuthToken !== settings.xAuthToken) {
      settings.xAuthToken = patch.xAuthToken;
      changed.add('x');
    }
    if (patch.xCt0 && patch.xCt0 !== settings.xCt0) {
      settings.xCt0 = patch.xCt0;
      changed.add('x');
    }

    if (changed.size > 0) persist();
    return { changedPlatforms: [...changed] };
  }

  return { getConfig, publicState, update };
}
