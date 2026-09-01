'use strict';
/**
 * GET/POST/PATCH /api/incidents tests — Teacher Incident Book (Feature 3).
 *
 * Thin-route tests only, mirroring tests/api-reflections-write.test.js's
 * style. incidentService.js's create/get/list/updateIncident are already
 * tested in tests/incidentService.test.js and are NOT re-tested here —
 * this file only proves the routes: pass req.teacher.phoneHash through
 * (never a body-supplied id), map service validation errors to 400, map
 * null returns to 404, and never leak whether a wrong-owner id exists.
 *
 * Run individually: node tests/api-incidents.test.js
 * Run via npm:       npm test
 */

const assert = require('assert');
const {
  createGetIncidentsHandler,
  createGetIncidentDetailHandler,
  createPostIncidentHandler,
  createPatchIncidentHandler,
} = require('../routes/api').__testExports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`       ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(phoneHash = 'hash_owner', { body = {}, params = {}, query = {} } = {}) {
  return { teacher: { id: 1, phoneHash }, body, params, query };
}

const sampleIncident = {
  id: 5,
  phoneHash: 'hash_owner',
  incidentDate: '2026-09-01',
  incidentTime: '09:30',
  incidentType: 'INJURY',
  description: 'Scraped knee on the playground.',
  actionTaken: 'Cleaned and dressed, parent informed.',
  createdAt: '2026-09-01 08:00:00',
  updatedAt: '2026-09-01 08:00:00',
};

// ── GET /incidents ────────────────────────────────────────────────────────
console.log('\n── GET /incidents ────────────────────────────────────────');
{
  let seenPhoneHash = null;
  const handler = createGetIncidentsHandler({
    listIncidents: (phoneHash, filters) => { seenPhoneHash = phoneHash; return [sampleIncident]; },
  });
  const res = mockRes();
  handler(mockReq('hash_owner'), res);

  test('responds 200', () => assert.strictEqual(res.statusCode, 200));
  test('returns { incidents: [...] }', () => assert.strictEqual(res.body.incidents.length, 1));
  test('req.teacher.phoneHash is passed through, not from body/query', () => assert.strictEqual(seenPhoneHash, 'hash_owner'));
}
{
  const handler = createGetIncidentsHandler({ listIncidents: () => { throw new Error('db exploded'); } });
  const res = mockRes();
  handler(mockReq('hash_owner'), res);
  test('service throw maps to 500', () => assert.strictEqual(res.statusCode, 500));
}

// ── GET /incidents/:id ───────────────────────────────────────────────────
console.log('\n── GET /incidents/:id ────────────────────────────────────');
{
  const handler = createGetIncidentDetailHandler({ getIncident: () => sampleIncident });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);
  test('responds 200 with the incident', () => assert.strictEqual(res.body.incident.id, 5));
}
{
  const handler = createGetIncidentDetailHandler({ getIncident: () => null });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' } }), res);
  test('null (not found OR wrong owner) maps to 404', () => assert.strictEqual(res.statusCode, 404));
}
{
  const handler = createGetIncidentDetailHandler({ getIncident: () => sampleIncident });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: 'not-a-number' } }), res);
  test('non-numeric id responds 400', () => assert.strictEqual(res.statusCode, 400));
}
{
  // The security-critical case: another teacher's id must produce the
  // EXACT same response shape as a nonexistent id — no existence oracle.
  const handler = createGetIncidentDetailHandler({
    getIncident: (phoneHash, id) => (phoneHash === 'hash_owner' && id === 5 ? sampleIncident : null),
  });
  const resWrongOwner = mockRes();
  handler(mockReq('hash_attacker', { params: { id: '5' } }), resWrongOwner);
  const resNotFound = mockRes();
  handler(mockReq('hash_owner', { params: { id: '999999' } }), resNotFound);
  test('cross-owner GET responds 404, identical to a not-found id', () => {
    assert.strictEqual(resWrongOwner.statusCode, 404);
    assert.deepStrictEqual(resWrongOwner.body, resNotFound.body);
  });
}

// ── POST /incidents ──────────────────────────────────────────────────────
console.log('\n── POST /incidents ───────────────────────────────────────');
{
  const handler = createPostIncidentHandler({
    createIncident: (phoneHash, params) => ({ ...sampleIncident, phoneHash, description: params.description }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { body: { ...sampleIncident, description: 'A fresh incident.' } }), res);
  test('responds 201', () => assert.strictEqual(res.statusCode, 201));
  test('returns the created incident', () => assert.strictEqual(res.body.incident.description, 'A fresh incident.'));
}
{
  let seenPhoneHash = null;
  const handler = createPostIncidentHandler({
    createIncident: (phoneHash) => { seenPhoneHash = phoneHash; return sampleIncident; },
  });
  handler(mockReq('hash_specific_teacher', { body: { ...sampleIncident, teacherId: 'someone-else', phoneHash: 'someone-elses-hash' } }), mockRes());
  test('a body-supplied teacherId/phoneHash is ignored — ownership always comes from req.teacher.phoneHash', () => {
    assert.strictEqual(seenPhoneHash, 'hash_specific_teacher');
  });
}
{
  const handler = createPostIncidentHandler({
    createIncident: () => { throw new Error('createIncident: description is required'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { body: {} }), res);
  test('service validation error (createIncident: prefix) maps to 400', () => assert.strictEqual(res.statusCode, 400));
}
{
  const handler = createPostIncidentHandler({ createIncident: () => { throw new Error('unexpected db failure'); } });
  const res = mockRes();
  handler(mockReq('hash_owner', { body: sampleIncident }), res);
  test('non-validation service throw maps to 500', () => assert.strictEqual(res.statusCode, 500));
}

// ── PATCH /incidents/:id ─────────────────────────────────────────────────
console.log('\n── PATCH /incidents/:id ──────────────────────────────────');
{
  const handler = createPatchIncidentHandler({
    updateIncident: (phoneHash, id, params) => ({ ...sampleIncident, ...params }),
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' }, body: { description: 'Updated.' } }), res);
  test('responds 200 with the updated incident', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.incident.description, 'Updated.');
  });
}
{
  const handler = createPatchIncidentHandler({ updateIncident: () => null });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' }, body: {} }), res);
  test('null (not found OR wrong owner) maps to 404', () => assert.strictEqual(res.statusCode, 404));
}
{
  const handler = createPatchIncidentHandler({
    updateIncident: (phoneHash, id, params) => (phoneHash === 'hash_owner' ? { ...sampleIncident, ...params } : null),
  });
  const resAttacker = mockRes();
  handler(mockReq('hash_attacker', { params: { id: '5' }, body: { description: 'Hijacked!' } }), resAttacker);
  test('another teacher cannot PATCH this incident (404, not a mutation)', () => assert.strictEqual(resAttacker.statusCode, 404));
}
{
  const handler = createPatchIncidentHandler({
    updateIncident: () => { throw new Error('updateIncident: incidentDate must be a valid YYYY-MM-DD date'); },
  });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: '5' }, body: { incidentDate: 'bogus' } }), res);
  test('service validation error (updateIncident: prefix) maps to 400', () => assert.strictEqual(res.statusCode, 400));
}
{
  const handler = createPatchIncidentHandler({ updateIncident: () => sampleIncident });
  const res = mockRes();
  handler(mockReq('hash_owner', { params: { id: 'abc' }, body: {} }), res);
  test('non-numeric id responds 400', () => assert.strictEqual(res.statusCode, 400));
}

console.log(`\n${'─'.repeat(55)}`);
console.log(`Incident API Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
