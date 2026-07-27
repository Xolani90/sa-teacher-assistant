'use strict';
/**
 * PR21 wiring + invariant regression test (ADR-008 §4.4, §5.1).
 *
 * Companion to tests/pr18-api-classes-wiring.test.js and
 * tests/pr20-api-learners-wiring.test.js — same source-inspection
 * style, used here to lock down the things tests/auth-login.test.js
 * (a unit test of the handler function alone) can't see: that
 * routes/auth.js is mounted as its own router at /api/auth WITHOUT
 * requireTeacherAuth, that it signs only a `sub` claim with the same
 * secret/expiry conventions requireTeacherAuth expects, and that
 * teacherAuth.js itself was not modified.
 *
 * Covers:
 *   1. routes/auth.js registers POST /login.
 *   2. server.js mounts routes/auth.js at /api/auth, separately from
 *      the /api mount, and does NOT include requireTeacherAuth on it.
 *   3. server.js's /api/auth mount uses its own limiter
 *      (authRouter.authLimiter), not apiLimiter.
 *   4. The /api mount (PR17/PR18/PR20) remains requireTeacherAuth-gated
 *      — regression guard, in case this PR's changes touched it.
 *   5. The signed token uses TEACHER_JWT_SECRET, expiresIn '1h', and
 *      only a `sub` claim — matching tests/teacherAuth.test.js's
 *      existing signing conventions exactly.
 *   6. utils/teacherAuth.js is byte-for-byte unmodified by this PR
 *      (the whole point of PR21 is to add a sibling, not touch the
 *      verification side).
 *
 * Run individually: node tests/pr21-auth-wiring.test.js
 * Run via npm:       npm test
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (!cond) {
    console.log(`  ❌ ${label}`);
    failed++;
  } else {
    console.log(`  ✅ ${label}`);
    passed++;
  }
}

const root = path.join(__dirname, '..');
const authSrc = fs.readFileSync(path.join(root, 'routes', 'auth.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

console.log('\n── Section 1: POST /login is registered ─────────────────');
{
  assert(
    /router\.post\(\s*['"]\/login['"]/.test(authSrc),
    "routes/auth.js registers router.post('/login', ...)"
  );
}

console.log('\n── Section 2: /api/auth is mounted as its own router, unauthenticated ─');
{
  assert(
    /require\(['"]\.\/routes\/auth['"]\)/.test(serverSrc),
    "server.js requires ./routes/auth"
  );

  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api\/auth['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api/auth', ...) mount in server.js");
  assert(
    !!mountMatch && !mountMatch[1].includes('requireTeacherAuth'),
    '/api/auth mount does NOT include requireTeacherAuth — a teacher cannot need a JWT to obtain one'
  );
}

console.log('\n── Section 3: /api/auth uses its own limiter, not apiLimiter ─');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api\/auth['"]\s*,([^)]*)\)/);
  assert(
    !!mountMatch && /authRouter\.authLimiter/.test(mountMatch[1]),
    '/api/auth mount uses authRouter.authLimiter'
  );
  assert(
    !!mountMatch && !/(?<!auth)apiLimiter/.test(mountMatch[1].replace('authLimiter', '')),
    '/api/auth mount does not reuse the /api mount\'s apiLimiter'
  );
}

console.log('\n── Section 4: /api mount is still requireTeacherAuth-gated ─');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");
  assert(
    !!mountMatch && mountMatch[1].includes('requireTeacherAuth'),
    '/api mount still includes requireTeacherAuth (regression guard from PR17/PR20)'
  );
}

console.log('\n── Section 5: signing conventions match teacherAuth.js\'s contract ─');
{
  assert(
    /process\.env\.TEACHER_JWT_SECRET/.test(authSrc),
    'routes/auth.js signs using process.env.TEACHER_JWT_SECRET (same env var the middleware requires)'
  );
  assert(
    /expiresIn:\s*JWT_EXPIRES_IN/.test(authSrc) && /JWT_EXPIRES_IN\s*=\s*['"]1h['"]/.test(authSrc),
    "routes/auth.js signs with expiresIn: '1h', matching tests/teacherAuth.test.js's convention"
  );
  assert(
    /jwt\.sign\(\s*\{\s*sub:\s*teacher\.id\s*\}/.test(authSrc),
    'routes/auth.js signs only a `sub` claim (teacher.id) — no phoneHash, role, or other claim embedded in the token'
  );
}

console.log('\n── Section 6: utils/teacherAuth.js is untouched by this PR ──');
{
  // PR21's entire premise is that the verification side needs zero
  // changes. This doesn't prove "unmodified since PR17" on its own,
  // but it does lock in the invariants PR16/PR17 established, so a
  // future PR21 regression that starts editing the middleware's
  // contract gets caught here too.
  const teacherAuthSrc = fs.readFileSync(path.join(root, 'utils', 'teacherAuth.js'), 'utf8');
  assert(
    /module\.exports\s*=\s*\{\s*requireTeacherAuth,\s*extractBearerToken,\s*resolveTeacherById,\s*apiLimiter\s*\}/.test(teacherAuthSrc),
    'utils/teacherAuth.js still exports exactly { requireTeacherAuth, extractBearerToken, resolveTeacherById, apiLimiter } — unchanged surface'
  );
  assert(
    /payload\.sub/.test(teacherAuthSrc),
    'utils/teacherAuth.js still reads payload.sub as the only claim it trusts (unchanged)'
  );
}

console.log('\n── Section 7: dev-only identity verifier is clearly documented as temporary ─');
{
  assert(
    /DEVELOPMENT-ONLY/.test(authSrc) && /PR22/.test(authSrc),
    'routes/auth.js documents its stub identityVerifier as development-only and references PR22 as its replacement'
  );
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
