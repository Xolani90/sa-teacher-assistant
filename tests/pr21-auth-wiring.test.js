'use strict';
/**
 * PR23 wiring + invariant regression test (ADR-008 §4.4, §5.1).
 *
 * Replaces the old PR21 wiring test now that PR23 has removed the
 * development-only POST /login JWT-issuance endpoint. Locks down the
 * production authentication surface: routes/auth.js exposes only the
 * WhatsApp OTP endpoints, /api/auth is mounted without
 * requireTeacherAuth, /api remains gated, and signing conventions
 * still match utils/teacherAuth.js's contract.
 *
 * Covers:
 *   1. routes/auth.js no longer registers POST /login, and the
 *      createLoginHandler/devIdentityVerifier constructs are gone.
 *   2. POST /request-code and POST /verify-code are still registered.
 *   3. server.js mounts routes/auth.js at /api/auth, separately from
 *      the /api mount, and does NOT include requireTeacherAuth on it.
 *   4. server.js's /api/auth mount uses its own limiter
 *      (authRouter.authLimiter), not apiLimiter.
 *   5. The /api mount (PR17/PR18/PR20) remains requireTeacherAuth-gated
 *      — regression guard, in case this PR's changes touched it.
 *   6. The signed token uses TEACHER_JWT_SECRET, expiresIn '1h', and
 *      only a `sub` claim — matching tests/teacherAuth.test.js's
 *      existing signing conventions exactly.
 *   7. utils/teacherAuth.js is untouched by this PR.
 *
 * Run individually: node tests/pr21-auth-wiring.test.js
 * Run via npm:       npm test
 */

const fs = require('fs');
const path = require('path');

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

console.log('\n── Section 1: POST /login and its dev-only scaffolding are gone ─');
{
  assert(
    !/router\.post\(\s*['"]\/login['"]/.test(authSrc),
    "routes/auth.js no longer registers router.post('/login', ...)"
  );
  assert(
    !/createLoginHandler/.test(authSrc),
    'routes/auth.js no longer defines/references createLoginHandler'
  );
  assert(
    !/devIdentityVerifier/.test(authSrc),
    'routes/auth.js no longer defines/references devIdentityVerifier'
  );
}

console.log('\n── Section 2: OTP endpoints are still registered ─────────');
{
  assert(
    /router\.post\(\s*['"]\/request-code['"]/.test(authSrc),
    "routes/auth.js registers router.post('/request-code', ...)"
  );
  assert(
    /router\.post\(\s*['"]\/verify-code['"]/.test(authSrc),
    "routes/auth.js registers router.post('/verify-code', ...)"
  );
}

console.log('\n── Section 3: /api/auth is mounted as its own router, unauthenticated ─');
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

console.log('\n── Section 4: /api/auth uses its own limiter, not apiLimiter ─');
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

console.log('\n── Section 5: /api mount is still requireTeacherAuth-gated ─');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");
  assert(
    !!mountMatch && mountMatch[1].includes('requireTeacherAuth'),
    '/api mount still includes requireTeacherAuth (regression guard from PR17/PR20)'
  );
}

console.log('\n── Section 6: signing conventions match teacherAuth.js\'s contract ─');
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

console.log('\n── Section 7: utils/teacherAuth.js is untouched by this PR ──');
{
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

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
