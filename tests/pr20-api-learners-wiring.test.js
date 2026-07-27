'use strict';
/**
 * PR20 wiring + invariant regression test (ADR-008 §8, §5.1).
 *
 * Companion to tests/pr18-api-classes-wiring.test.js — same
 * source-inspection style, used here to lock down the things
 * tests/api-learners.test.js (a unit test of the handler function
 * alone) can't see: that the route is actually registered under the
 * requireTeacherAuth-gated /api mount, that it reads
 * req.teacher.phoneHash rather than any other identity source, and
 * that it delegates to PR19's existing learnerRepository function
 * rather than introducing new domain logic.
 *
 * Covers:
 *   1. routes/api.js registers GET /learners.
 *   2. The handler is built from getTeacherLearners, imported from
 *      services/learnerRepository — the same function PR19 added,
 *      not a new/duplicated one.
 *   3. The handler reads req.teacher.phoneHash (the identity
 *      requireTeacherAuth populates), not req.params, req.query, or
 *      req.body — a teacher can only ever see their own learners.
 *   4. services/learnerRepository.js's getTeacherLearners export is
 *      unchanged in signature (still takes a single phoneHash
 *      argument) — PR20 must not have modified the repository.
 *   5. The /api mount itself is still requireTeacherAuth-gated
 *      (regression guard, in case a future change touches the mount).
 *   6. GET /learners is distinct from GET /learners/:learnerId/intervention-plan
 *      (PR20 must not collide with or shadow PR10's route).
 *
 * Run individually: node tests/pr20-api-learners-wiring.test.js
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
const learnerRepoSrc = fs.readFileSync(
  path.join(root, 'services', 'learnerRepository.js'),
  'utf8'
);

console.log('\n── Section 1: GET /learners is registered ───────────────');
{
  assert(
    /router\.get\(\s*['"]\/learners['"]/.test(apiSrc),
    "routes/api.js registers router.get('/learners', ...)"
  );
}

console.log('\n── Section 2: delegates to the existing repository, unchanged ─');
{
  assert(
    /require\(['"]\.\.\/services\/learnerRepository['"]\)/.test(apiSrc),
    "routes/api.js requires services/learnerRepository"
  );
  assert(
    /const\s*\{\s*getLearnerById,\s*getTeacherLearners\s*\}\s*=\s*require\(['"]\.\.\/services\/learnerRepository['"]\)/.test(apiSrc),
    'routes/api.js destructures getTeacherLearners from learnerRepository (not a locally-defined duplicate)'
  );
  assert(
    /function\s+getTeacherLearners\s*\(\s*phoneHash\s*\)/.test(learnerRepoSrc),
    'services/learnerRepository.js still exports getTeacherLearners(phoneHash) with an unchanged single-argument signature'
  );
  assert(
    /getTeacherLearners,/.test(learnerRepoSrc),
    'getTeacherLearners is still in the module.exports list'
  );
}

console.log('\n── Section 3: identity comes from req.teacher.phoneHash ───');
{
  // Isolate the handler body between its definition and the next
  // top-level "// Real wiring" comment, so this assertion is specific
  // to PR20's handler and not a false-positive match against the
  // intervention-plan or classes routes' own req.teacher.phoneHash
  // usage above it.
  const handlerStart = apiSrc.indexOf('function createGetLearnersHandler');
  assert(handlerStart !== -1, 'createGetLearnersHandler function found in routes/api.js');

  const handlerBody = apiSrc.slice(handlerStart, apiSrc.indexOf('// Real wiring', handlerStart));
  assert(
    /req\.teacher\.phoneHash/.test(handlerBody),
    'the /learners handler reads req.teacher.phoneHash'
  );
  assert(
    !/req\.params/.test(handlerBody) && !/req\.query/.test(handlerBody) && !/req\.body/.test(handlerBody),
    'the /learners handler does not read identity from req.params, req.query, or req.body'
  );
}

console.log('\n── Section 4: /api mount still requireTeacherAuth-gated ───');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");
  assert(
    !!mountMatch && mountMatch[1].includes('requireTeacherAuth'),
    '/api mount still includes requireTeacherAuth (regression guard from PR17)'
  );
}

console.log('\n── Section 5: no changes leaked into services/flows/core ──');
{
  // PR20 should touch only routes/api.js (+ tests). A crude but useful
  // guard: getTeacherLearners's implementation body should still be
  // free of any auth-aware branching.
  assert(
    !/jsonwebtoken/.test(learnerRepoSrc) && !/headers\[['"]authorization['"]\]/i.test(learnerRepoSrc),
    'services/learnerRepository.js has not become auth-aware'
  );
}

console.log('\n── Section 6: /learners does not collide with the intervention-plan route ─');
{
  assert(
    /router\.get\(\s*['"]\/learners\/:learnerId\/intervention-plan['"]/.test(apiSrc),
    "routes/api.js still registers GET /learners/:learnerId/intervention-plan separately from GET /learners"
  );
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
