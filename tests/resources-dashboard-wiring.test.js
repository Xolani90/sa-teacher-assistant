'use strict';
/**
 * Feature 2 dashboard integration — wiring + invariant regression test,
 * same source-inspection style as tests/pr18-api-classes-wiring.test.js.
 *
 * Companion to tests/api-resources.test.js (handler-level unit test with
 * mocks) and tests/resources-dashboard-e2e.test.js (real-DB ownership
 * proof). This file locks down the things those two can't see on their
 * own: that the routes are actually registered under the
 * requireTeacherAuth-gated /api mount, that they delegate to
 * teacherWorkspaceService's EXISTING getSavedResources/getSavedResource
 * — the exact functions core/commandHandler.js's SAVE handler already
 * uses — rather than a second, dashboard-only resource system, and that
 * no dashboard-only save/generate path was introduced.
 *
 * Run individually: node tests/resources-dashboard-wiring.test.js
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
const workspaceServiceSrc = fs.readFileSync(path.join(root, 'services', 'teacherWorkspaceService.js'), 'utf8');
const commandHandlerSrc = fs.readFileSync(path.join(root, 'core', 'commandHandler.js'), 'utf8');

console.log('\n── Section 1: routes registered ──────────────────────────');
{
  assert(/router\.get\(\s*['"]\/resources['"]/.test(apiSrc), "routes/api.js registers router.get('/resources', ...)");
  assert(/router\.get\(\s*['"]\/resources\/:id['"]/.test(apiSrc), "routes/api.js registers router.get('/resources/:id', ...)");
}

console.log('\n── Section 2: no parallel resource system ────────────────');
{
  assert(
    /getSavedResources\s*,\s*getSavedResource\s*}\s*=\s*require\(['"]\.\.\/services\/teacherWorkspaceService['"]\)/.test(apiSrc) ||
    (/require\(['"]\.\.\/services\/teacherWorkspaceService['"]\)/.test(apiSrc) && /getSavedResources/.test(apiSrc) && /getSavedResource\b/.test(apiSrc)),
    'routes/api.js imports getSavedResources/getSavedResource from services/teacherWorkspaceService.js (the same module SAVE already uses), not a new service file'
  );
  assert(
    !/CREATE\s+TABLE.*resource/is.test(apiSrc),
    'routes/api.js contains no table creation / schema definition of its own'
  );
  assert(
    !/INSERT INTO|generateContent|buildPrompt/.test(apiSrc.split('\n').filter(l => /resource/i.test(l)).join('\n')),
    'the resources routes never write, insert, or (re)generate content — read-only'
  );
}

console.log('\n── Section 3: same authoritative write path as WhatsApp ──');
{
  assert(
    /saveResource\(/.test(commandHandlerSrc),
    'core/commandHandler.js (WhatsApp SAVE) still writes through saveResource() — unchanged by this feature'
  );
  assert(
    /homework:\s*last\.intent\.homework/.test(commandHandlerSrc),
    'the WhatsApp SAVE path still persists intent.homework into metadata (Feature 2) — the dashboard reads exactly this field'
  );
}

console.log('\n── Section 4: ownership — reads req.teacher.phoneHash only ──');
{
  const resourcesSection = apiSrc.slice(apiSrc.indexOf('createGetResourcesHandler'), apiSrc.indexOf('createGetResourceDetailHandler') + 4000);
  assert(
    /req\.teacher\.phoneHash/.test(resourcesSection),
    'the resources handlers read req.teacher.phoneHash (populated by requireTeacherAuth), not req.body/req.query for identity'
  );
  assert(
    !/req\.(body|query)\.(phoneHash|teacherId|phone)/.test(resourcesSection),
    'the resources handlers never trust a client-supplied teacher/phone identifier'
  );
}

console.log('\n── Section 5: /api mount is still requireTeacherAuth-gated ──');
{
  assert(
    /app\.use\(\s*['"]\/api['"]\s*,\s*apiLimiter\s*,\s*requireTeacherAuth\s*,\s*apiRouter\s*\)/.test(serverSrc),
    'server.js still mounts /api behind requireTeacherAuth (regression guard)'
  );
}

console.log('\n── Section 6: service layer unchanged in signature ───────');
{
  assert(
    /function getSavedResources\(phoneHash, filters = \{\}\)/.test(workspaceServiceSrc),
    'getSavedResources(phoneHash, filters) signature unchanged'
  );
  assert(
    /function getSavedResource\(resourceId, phoneHash\)/.test(workspaceServiceSrc),
    'getSavedResource(resourceId, phoneHash) signature unchanged'
  );
  assert(
    /WHERE id = \? AND phone_hash = \?/.test(workspaceServiceSrc),
    'getSavedResource still scopes both id AND phone_hash in one query (the actual ownership enforcement point)'
  );
}

console.log('\n── Section 7: __testExports exposes the new handlers ─────');
{
  const { __testExports } = require('../routes/api');
  assert(typeof __testExports.createGetResourcesHandler === 'function', '__testExports.createGetResourcesHandler exported');
  assert(typeof __testExports.createGetResourceDetailHandler === 'function', '__testExports.createGetResourceDetailHandler exported');
}

console.log(`\n📊 Total:  ${passed + failed}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
