'use strict';
/**
 * PR18 wiring + invariant regression test (ADR-008 §8, §5.1).
 *
 * Companion to tests/pr17-api-teacher-auth-wiring.test.js — same
 * source-inspection style, used here to lock down the things
 * tests/api-classes.test.js (a unit test of the handler function
 * alone) can't see: that the route is actually registered under the
 * requireTeacherAuth-gated /api mount, that it reads
 * req.teacher.phoneHash rather than any other identity source, and
 * that it delegates to the existing teacherWorkspaceService function
 * rather than introducing new domain logic.
 *
 * Covers:
 *   1. routes/api.js registers GET /classes.
 *   2. The handler is built from getTeacherClasses, imported from
 *      services/teacherWorkspaceService — the same function
 *      services/flows already use, not a new/duplicated one.
 *   3. The handler reads req.teacher.phoneHash (the identity
 *      requireTeacherAuth populates), not req.params, req.query, or
 *      req.body — a teacher can only ever see their own classes.
 *   4. services/teacherWorkspaceService.js's getTeacherClasses export
 *      is unchanged in signature (still takes a single phoneHash
 *      argument) — PR18 must not have modified the service.
 *   5. The /api mount itself is still requireTeacherAuth-gated
 *      (regression guard, in case a future change touches the mount).
 *
 * Run individually: node tests/pr18-api-classes-wiring.test.js
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
const apiSrc = fs.readFileSync(path.join(root, 'routes', 'api.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const workspaceServiceSrc = fs.readFileSync(
  path.join(root, 'services', 'teacherWorkspaceService.js'),
  'utf8'
);

console.log('\n── Section 1: GET /classes is registered ────────────────');
{
  assert(
    /router\.get\(\s*['"]\/classes['"]/.test(apiSrc),
    "routes/api.js registers router.get('/classes', ...)"
  );
}

console.log('\n── Section 2: delegates to the existing service, unchanged ─');
{
  assert(
    /require\(['"]\.\.\/services\/teacherWorkspaceService['"]\)/.test(apiSrc),
    "routes/api.js requires services/teacherWorkspaceService"
  );
  assert(
    /const\s*\{\s*getTeacherClasses\s*\}\s*=\s*require\(['"]\.\.\/services\/teacherWorkspaceService['"]\)/.test(apiSrc),
    'routes/api.js destructures getTeacherClasses from teacherWorkspaceService (not a locally-defined duplicate)'
  );
  assert(
    /function\s+getTeacherClasses\s*\(\s*phoneHash\s*\)/.test(workspaceServiceSrc),
    'services/teacherWorkspaceService.js still exports getTeacherClasses(phoneHash) with an unchanged single-argument signature'
  );
  assert(
    /getTeacherClasses,/.test(workspaceServiceSrc),
    'getTeacherClasses is still in the module.exports list'
  );
}

console.log('\n── Section 3: identity comes from req.teacher.phoneHash ────');
{
  // Isolate the handler body between its definition and the next
  // top-level function/const, so this assertion is specific to PR18's
  // handler and not a false-positive match against the intervention
  // route's own req.teacher.phoneHash usage above it.
  const handlerStart = apiSrc.indexOf('function createGetClassesHandler');
  assert(handlerStart !== -1, 'createGetClassesHandler function found in routes/api.js');

  // Bounded to this handler's own function, not all the way to
  // '// Real wiring' — other handlers may legitimately sit in between
  // (e.g. createGetClassDetailHandler reads req.params.classId for its
  // own route) and must not be misattributed to this one.
  const nextFnMatch = apiSrc.slice(handlerStart + 1).search(/\nfunction\s+create/);
  const handlerEnd = nextFnMatch === -1
    ? apiSrc.indexOf('// Real wiring', handlerStart)
    : handlerStart + 1 + nextFnMatch;
  const handlerBody = apiSrc.slice(handlerStart, handlerEnd);
  assert(
    /req\.teacher\.phoneHash/.test(handlerBody),
    'the /classes handler reads req.teacher.phoneHash'
  );
  assert(
    !/req\.params/.test(handlerBody) && !/req\.query/.test(handlerBody) && !/req\.body/.test(handlerBody),
    'the /classes handler does not read identity from req.params, req.query, or req.body'
  );
}

console.log('\n── Section 4: /api mount still requireTeacherAuth-gated ────');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");
  assert(
    !!mountMatch && mountMatch[1].includes('requireTeacherAuth'),
    '/api mount still includes requireTeacherAuth (regression guard from PR17)'
  );
}

console.log('\n── Section 5: no changes leaked into services/flows/core ───');
{
  // PR18 should touch only routes/api.js (+ tests). A crude but useful
  // guard: getTeacherClasses's implementation body should still be a
  // single SELECT, not something that grew phoneHash-unaware logic or
  // an auth-aware branch.
  assert(
    !/jsonwebtoken/.test(workspaceServiceSrc) && !/headers\[['"]authorization['"]\]/i.test(workspaceServiceSrc),
    'services/teacherWorkspaceService.js has not become auth-aware'
  );
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
