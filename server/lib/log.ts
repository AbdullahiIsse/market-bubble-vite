// Tiny scoped logger. Usage: const log = scoped('kick'); log('connected', id)
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, args: unknown[]) {
  const tag = `[${scope}]`;
  if (level === 'error') console.error(tag, ...args);
  else if (level === 'warn') console.warn(tag, ...args);
  else console.log(tag, ...args);
}

export interface Logger {
  (...args: unknown[]): void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function scoped(scope: string): Logger {
  const fn = ((...args: unknown[]) => emit('info', scope, args)) as Logger;
  fn.warn = (...args: unknown[]) => emit('warn', scope, args);
  fn.error = (...args: unknown[]) => emit('error', scope, args);
  return fn;
}
