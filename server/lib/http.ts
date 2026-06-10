// Small fetch helper: JSON parsing, timeout, and a browser-like UA preset for
// endpoints (Kick's web API) that reject default Node user agents.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  browserLike?: boolean; // add UA + Accept headers that pass Cloudflare
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public bodyText: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.browserLike) {
    headers['User-Agent'] ??= BROWSER_UA;
    headers['Accept'] ??= 'application/json';
    headers['Accept-Language'] ??= 'en-US,en;q=0.9';
  }
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timer);
  }
}
