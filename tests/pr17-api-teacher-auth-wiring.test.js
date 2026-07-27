'use strict';
/**
 * PR17 wiring + invariant regression test (ADR-008 §5.1, §8).
 *
 * Companion to tests/routing-order-*.test.js — same source-inspection
 * style, used here because the thing worth locking down is "the mount
 * point in server.js actually uses requireTeacherAuth" and "no service
 * has become auth-aware", neither of which a unit test of the handler
 * function alone (tests/api-intervention-plan.test.js) can see.
 *
 * Covers:
 *   1. server.js mounts /api with requireTeacherAuth + apiLimiter, not
 *      requireAdminSecret/adminLimiter.
 *   2. /admin/stats and /admin/grant-pro are untouched — still on
 *      requireAdminSecret.
 *   3. TEACHER_JWT_SECRET is in validateEnv.js's required-vars list.
 *   4. ADR-008 §5.1's non-negotiable invariant: no file under services/,
 *      flows/, core/, or repositories-style modules requires
 *      'jsonwebtoken' or reads req.headers['authorization'] /
 *      req.headers.authorization. Only utils/teacherAuth.js may.
 *
 * Run individually: node tests/pr17-api-teacher-auth-wiring.test.js
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
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const validateEnvSrc = fs.readFileSync(path.join(root, 'utils', 'validateEnv.js'), 'utf8');

console.log('\n── Section 1: /api mount uses requireTeacherAuth ────────');
{
  assert(
    /require\(['"]\.\/utils\/teacherAuth['"]\)/.test(serverSrc),
    "server.js requires './utils/teacherAuth'"
  );

  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");

  const mountArgs = mountMatch ? mountMatch[1] : '';
  assert(mountArgs.includes('requireTeacherAuth'), '/api mount includes requireTeacherAuth');
  assert(mountArgs.includes('apiLimiter'), '/api mount includes apiLimiter');
  assert(!mountArgs.includes('requireAdminSecret'), '/api mount no longer includes requireAdminSecret');
  assert(!mountArgs.includes('adminLimiter'), '/api mount no longer includes adminLimiter');
}

console.log('\n── Section 2: /admin/* untouched ─────────────────────────');
{
  const adminStatsMatch = serverSrc.match(/app\.get\(\s*['"]\/admin\/stats['"]\s*,([^)]*)\)/);
  const adminGrantMatch = serverSrc.match(/app\.post\(\s*['"]\/admin\/grant-pro['"]\s*,([^)]*)\)/);

  assert(!!adminStatsMatch, 'found the /admin/stats route');
  assert(!!adminGrantMatch, 'found the /admin/grant-pro route');

  assert(
    !!adminStatsMatch && adminStatsMatch[1].includes('requireAdminSecret'),
    '/admin/stats still uses requireAdminSecret'
  );
  assert(
    !!adminGrantMatch && adminGrantMatch[1].includes('requireAdminSecret'),
    '/admin/grant-pro still uses requireAdminSecret'
  );
}

console.log('\n── Section 3: TEACHER_JWT_SECRET required at startup ────');
{
  assert(
    /key:\s*['"]TEACHER_JWT_SECRET['"]/.test(validateEnvSrc),
    'validateEnv.js requires TEACHER_JWT_SECRET'
  );
}

console.log('\n── Section 4: ADR-008 §5.1 — services stay auth-unaware ─');
{
  const scanDirs = ['services', 'flows', 'core'];
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        const usesJwt = /require\(['"]jsonwebtoken['"]\)/.test(src);
        const readsAuthHeader = /headers\[['"]authorization['"]\]|headers\.authorization/i.test(src);
        if (usesJwt || readsAuthHeader) {
          offenders.push({ file: path.relative(root, full), usesJwt, readsAuthHeader });
        }
      }
    }
  }

  for (const d of scanDirs) {
    const full = path.join(root, d);
    if (fs.existsSync(full)) walk(full);
  }

  assert(
    offenders.length === 0,
    offenders.length === 0
      ? 'no service/flow/core module imports jsonwebtoken or reads the Authorization header'
      : `found auth-aware code outside utils/teacherAuth.js: ${JSON.stringify(offenders)}`
  );
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
