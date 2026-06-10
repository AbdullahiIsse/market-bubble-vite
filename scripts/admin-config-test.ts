// Run: npx tsx scripts/admin-config-test.ts
import { loadConfig } from '../server/config';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

// no password -> not configured
delete process.env.ADMIN_PASSWORD;
delete process.env.SESSION_SECRET;
let c = loadConfig();
check('unconfigured by default', c.admin.configured === false && c.admin.password === '');

// password set, no session secret -> configured + a generated secret
process.env.ADMIN_PASSWORD = 's3cret';
delete process.env.SESSION_SECRET;
c = loadConfig();
check('configured when password set', c.admin.configured === true && c.admin.password === 's3cret');
check('generates a session secret fallback', c.admin.sessionSecret.length >= 32);

// explicit session secret is used verbatim
process.env.SESSION_SECRET = 'my-explicit-secret';
c = loadConfig();
check('uses explicit session secret', c.admin.sessionSecret === 'my-explicit-secret');

delete process.env.ADMIN_PASSWORD;
delete process.env.SESSION_SECRET;
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
