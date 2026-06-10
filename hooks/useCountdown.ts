import { useEffect, useState } from 'react';
import { SHOW_TZ, SHOW_WEEKDAY, SHOW_HOUR } from '@/shared/meta';

// How far the given timezone is ahead of UTC (ms) at the given instant.
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

// Wall-clock fields of `date` as seen in `tz`.
function tzParts(tz: string, date: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: weekdays.indexOf(p.weekday),
  };
}

// Convert a wall-clock time in `tz` to an epoch (ms), DST-correct via 2-pass refine.
function tzWallToEpoch(
  tz: string,
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
): number {
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  let epoch = naive - tzOffsetMs(tz, new Date(naive));
  epoch = naive - tzOffsetMs(tz, new Date(epoch));
  return epoch;
}

// Epoch of the next show start (Thursday 1PM in SHOW_TZ).
export function nextShowEpoch(nowEpoch: number): number {
  const now = new Date(nowEpoch);
  const pt = tzParts(SHOW_TZ, now);
  const addDays = (SHOW_WEEKDAY - pt.weekday + 7) % 7;
  // step the PT calendar date forward addDays using a pure-UTC calendar
  const cal = new Date(Date.UTC(pt.year, pt.month - 1, pt.day));
  cal.setUTCDate(cal.getUTCDate() + addDays);
  let epoch = tzWallToEpoch(
    SHOW_TZ,
    cal.getUTCFullYear(),
    cal.getUTCMonth() + 1,
    cal.getUTCDate(),
    SHOW_HOUR,
    0,
    0,
  );
  if (epoch <= nowEpoch) {
    cal.setUTCDate(cal.getUTCDate() + 7);
    epoch = tzWallToEpoch(
      SHOW_TZ,
      cal.getUTCFullYear(),
      cal.getUTCMonth() + 1,
      cal.getUTCDate(),
      SHOW_HOUR,
      0,
      0,
    );
  }
  return epoch;
}

export interface CountdownParts {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
}

function split(msLeft: number): CountdownParts {
  let s = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { days: d, hours: pad(h), minutes: pad(m), seconds: pad(s) };
}

// Ticking time left until the next Thursday 1PM PT, split into display units.
// Null until the first client-side tick (the server renders no countdown).
export function useCountdown(): CountdownParts | null {
  const [left, setLeft] = useState<CountdownParts | null>(null);
  useEffect(() => {
    function tick() {
      const now = Date.now();
      setLeft(split(nextShowEpoch(now) - now));
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return left;
}
