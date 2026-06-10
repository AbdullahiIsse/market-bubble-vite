// A malformed numeric env var must fail boot with a clear, field-named message
// instead of a raw ZodError dump. Run: npx tsx scripts/config-error-test.ts
import { loadConfig } from '../server/config';

const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const savedPort = process.env.PORT;
try {
  process.env.PORT = 'not-a-number';
  let message = '';
  try {
    loadConfig();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  check('malformed PORT throws a friendly error', message.startsWith('Invalid environment configuration'));
  check('error names the offending field', message.includes('PORT'), `msg=${message}`);
} finally {
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
