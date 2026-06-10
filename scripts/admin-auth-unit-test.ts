// Run: npx tsx scripts/admin-auth-unit-test.ts
import {
  signSession,
  verifySession,
  parseCookie,
  constantTimeEqual,
  gateState,
  createLoginLimiter,
} from '../server/lib/admin-auth';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const SECRET = 'unit-secret';

// sign/verify round-trip
const tok = signSession(SECRET, 60_000);
check('valid token verifies', verifySession(SECRET, tok) === true);
check('wrong secret fails', verifySession('other', tok) === false);
check('undefined fails', verifySession(SECRET, undefined) === false);
check('garbage fails', verifySession(SECRET, 'not.a.token') === false);
check('tampered payload fails', verifySession(SECRET, 'AAAA.' + tok.split('.')[1]) === false);
check('tampered sig fails', verifySession(SECRET, tok.split('.')[0] + '.AAAA') === false);
check('expired token fails', verifySession(SECRET, signSession(SECRET, -1000)) === false);

// cookie parsing
check('parseCookie finds value', parseCookie('a=1; mb_admin=xyz; b=2', 'mb_admin') === 'xyz');
check('parseCookie missing -> undefined', parseCookie('a=1', 'mb_admin') === undefined);
check('parseCookie no header -> undefined', parseCookie(undefined, 'mb_admin') === undefined);

// constant-time compare
check('equal strings match', constantTimeEqual('hunter2', 'hunter2') === true);
check('different strings differ', constantTimeEqual('hunter2', 'hunter3') === false);
check('different lengths differ', constantTimeEqual('a', 'abc') === false);

// gate state
check('configured -> required (dev)', gateState({ configured: true, dev: true }) === 'required');
check('configured -> required (prod)', gateState({ configured: true, dev: false }) === 'required');
check('unconfigured dev -> open', gateState({ configured: false, dev: true }) === 'open');
check('unconfigured prod -> disabled', gateState({ configured: false, dev: false }) === 'disabled');

// limiter
const lim = createLoginLimiter(3, 60_000);
check('fresh key not locked', lim.check('ip').locked === false);
lim.fail('ip');
lim.fail('ip');
check('under threshold not locked', lim.check('ip').locked === false);
lim.fail('ip');
check('at threshold locked', lim.check('ip').locked === true);
check('lock reports retryAfter', lim.check('ip').retryAfterMs > 0);
lim.reset('ip');
check('reset clears lock', lim.check('ip').locked === false);

// after a lock window expires, the user gets a fresh window (not an instant re-lock)
const limE = createLoginLimiter(2, 60);
limE.fail('y');
limE.fail('y'); // fails=2 -> locked
check('locked at threshold', limE.check('y').locked === true);
await new Promise((r) => setTimeout(r, 150)); // let the 60ms lock expire
check('unlocked after window expires', limE.check('y').locked === false);
limE.fail('y'); // fresh window: fails=1, must NOT be locked
check('window resets after expiry (single fail not re-locked)', limE.check('y').locked === false);

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
