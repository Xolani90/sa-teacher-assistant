'use strict';
/**
 * GET /classes/:classId/detail wiring + invariant regression test
 * (ADR-008 §8, §5.1), following tests/pr18-api-classes-wiring.test.js's
 * and tests/pr20-api-learners-wiring.test.js's source-inspection style.
 *
 * Companion to tests/api-class-detail.test.js (a unit test of the
 * handler function alone). This file locks down what that one can't
 * see: that the route is actually registered under the
 * requireTeacherAuth-gated /api mount, that it reads
 * req.teacher.phoneHash rather than any other identity source, that it
 * delegates to services/classDetailService.js rather than introducing
 * new domain logic in the route file, and that classDetailService.js
 * itself performs no SQL of its own.
 *
 * Run individually: node tests/pr-api-class-detail-wiring.test.js
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
const classDetailServiceSrc = fs.readFileSync(
  path.join(root, 'services', 'classDetailService.js'),
  'utf8'
);

console.log('\n── Section 1: GET /classes/:classId/detail is registered ────');
{
  assert(
    /router\.get\(\s*['"]\/classes\/:classId\/detail['"]/.test(apiSrc),
    "routes/api.js registers router.get('/classes/:classId/detail', ...)"
  );
}

console.log('\n── Section 2: delegates to classDetailService, no new SQL ───');
{
  assert(
    /require\(['"]\.\.\/services\/classDetailService['"]\)/.test(apiSrc),
    'routes/api.js requires services/classDetailService'
  );
  assert(
    /const\s*\{\s*getClassDetail\s*\}\s*=\s*require\(['"]\.\.\/services\/classDetailService['"]\)/.test(apiSrc),
    'routes/api.js destructures getClassDetail from classDetailService'
  );
  assert(
    /function\s+getClassDetail\s*\(\s*phoneHash\s*,\s*classId\s*\)/.test(classDetailServiceSrc),
    'services/classDetailService.js exports getClassDetail(phoneHash, classId)'
  );
  assert(
    !/db\.prepare\s*\(/.test(classDetailServiceSrc) && !/getDb\s*\(/.test(classDetailServiceSrc),
    'services/classDetailService.js issues no SQL of its own (composition only, per docs/ARCHITECTURE.md layering)'
  );
  assert(
    /require\(['"]\.\/teacherWorkspaceService['"]\)/.test(classDetailServiceSrc) &&
    /require\(['"]\.\/learnerRosterService['"]\)/.test(classDetailServiceSrc) &&
    /require\(['"]\.\/learnerRepository['"]\)/.test(classDetailServiceSrc) &&
    /require\(['"]\.\/curriculumCoverageService['"]\)/.test(classDetailServiceSrc) &&
    /require\(['"]\.\/classInterventionService['"]\)/.test(classDetailServiceSrc),
    'classDetailService.js composes all five existing services (teacherWorkspace, learnerRoster, learnerRepository, curriculumCoverage, classIntervention)'
  );
}

console.log('\n── Section 3: identity comes from req.teacher.phoneHash ──────');
{
  const handlerStart = apiSrc.indexOf('function createGetClassDetailHandler');
  assert(handlerStart !== -1, 'createGetClassDetailHandler function found in routes/api.js');

  const nextFnMatch = apiSrc.slice(handlerStart + 1).search(/\nfunction\s+create/);
  const handlerBody = nextFnMatch === -1
    ? apiSrc.slice(handlerStart, apiSrc.indexOf('// Real wiring', handlerStart))
    : apiSrc.slice(handlerStart, handlerStart + 1 + nextFnMatch);

  assert(
    /req\.teacher\.phoneHash/.test(handlerBody),
    'the /classes/:classId/detail handler reads req.teacher.phoneHash'
  );
  assert(
    /req\.params\.classId/.test(handlerBody),
    'the handler reads classId from req.params (the only identity NOT scoped to req.teacher)'
  );
  assert(
    !/req\.query/.test(handlerBody) && !/req\.body/.test(handlerBody),
    'the handler does not read identity from req.query or req.body'
  );
}

console.log('\n── Section 4: classId validation and error shape ─────────────');
{
  const handlerStart = apiSrc.indexOf('function createGetClassDetailHandler');
  const handlerBody = apiSrc.slice(handlerStart, apiSrc.indexOf('// Real wiring', handlerStart));
  assert(
    /Number\.isInteger\(classId\)/.test(handlerBody) && /classId <= 0/.test(handlerBody),
    'the handler rejects non-positive-integer classId with a 400'
  );
  assert(
    /res\.status\(404\)/.test(handlerBody),
    'the handler returns 404 when getClassDetail returns null (unknown class or wrong owner)'
  );
  assert(
    /res\.status\(500\)/.test(handlerBody),
    'the handler returns 500 if getClassDetail throws'
  );
}

console.log('\n── Section 5: /api mount still requireTeacherAuth-gated ──────');
{
  const mountMatch = serverSrc.match(/app\.use\(\s*['"]\/api['"]\s*,([^)]*)\)/);
  assert(!!mountMatch, "found an app.use('/api', ...) mount in server.js");
  assert(
    !!mountMatch && mountMatch[1].includes('requireTeacherAuth'),
    '/api mount still includes requireTeacherAuth (regression guard from PR17)'
  );
}

console.log('\n── Section 6: exported for testing ────────────────────────────');
{
  assert(
    /createGetClassDetailHandler,/.test(apiSrc),
    'createGetClassDetailHandler is included in module.exports.__testExports'
  );
}

console.log('\n' + '='.repeat(75));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
