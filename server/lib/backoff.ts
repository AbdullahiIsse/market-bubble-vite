// Exponential backoff with full jitter, shared by every reconnecting adapter.
// delay = random(0, min(cap, base * 2^attempt)); resets to base after a stable run.

export interface Backoff {
  next(): number; // ms to wait before the next attempt
  reset(): void; // call after a connection has been stable
  attempt(): number;
}

export function createBackoff(baseMs = 1000, capMs = 30000): Backoff {
  let attempt = 0;
  return {
    next() {
      const ceil = Math.min(capMs, baseMs * 2 ** attempt);
      attempt++;
      // full jitter — spreads reconnect storms
      return Math.round(ceil * pseudoRandom());
    },
    reset() {
      attempt = 0;
    },
    attempt() {
      return attempt;
    },
  };
}

// Math.random is fine on the server; isolated here so it is easy to seed in tests.
function pseudoRandom(): number {
  return Math.random();
}
