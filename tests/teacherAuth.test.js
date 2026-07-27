'use strict';
/**
 * Teacher JWT authentication middleware tests (ADR-008, PR16).
 *
 * Loads the REAL utils/teacherAuth.js against a REAL in-memory SQLite
 * database (via the node:sqlite shim, same convention as
 * tests/learnerRepository.test.js and tests/workspace.test.js), and uses
 * the REAL jsonwebtoken library to mint test tokens directly — there is no
 * issuance endpoint yet (ADR-008 §4.4 defers that), so tests sign their
 * own tokens with the same secret the middleware verifies against, per
 * ADR-008 discussion.
 *
 * Scope: this file tests ONLY utils/teacherAuth.js in isolation. It does
 * not touch server.js, routes/api.js, or requireAdminSecret — wiring this
 * middleware into /api is PR17.
 *
 * Run individually:   node tests/teacherAuth.test.js
 * Run via npm:         npm test
 */

const TEST_SECRET = 'test-teacher-jwt-secret';
process.env.TEACHER_JWT_SECRET = TEST_SECRET;

// ── Shim better-sqlite3 → node:sqlite (same pattern as learnerRepository.test.js) ─
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

let _db = null;

const path = require('path');
const dbPath = path.resolve(__dirname, '../utils/database');
const authPath = path.resolve(__dirname, '../utils/teacherAuth');

const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'better-sqlite3') return request;
  if (request === '../utils/database' || request === './database') return dbPath;
  return _origResolve(request, parent, isMain, opts);
};
require.cache['better-sqlite3'] = {
  id: 'better-sqlite3',
  filename: 'better-sqlite3',
  loaded: true,
  exports: function Database() {
    if (!_db.pragma) _db.pragma = () => {};
    return _db;
  },
};
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => _db },
};

// ── Helpers ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ── Schema (mirrors utils/database.js's teachers table only — this
//    middleware needs nothing else) ────────────────────────────────────
function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT UNIQUE NOT NULL
    );
  `);
}

function resetDb() {
  _db = new DatabaseSync(':memory:');
  buildSchema(_db);
}

function insertTeacher(phoneHash) {
  const info = _db.prepare('INSERT INTO teachers (phone_hash) VALUES (?)').run(phoneHash);
  return Number(info.lastInsertRowid);
}

// Minimal req/res double — enough to exercise middleware behavior without
// pulling in a real Express app.
function makeReqRes(authHeader) {
  const req = { headers: authHeader ? { authorization: authHeader } : {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, calledNext: () => nextCalled };
}

async function run() {
  console.log('Teacher JWT Auth Middleware tests (ADR-008, PR16)');
  console.log('='.repeat(75));

  resetDb();
  // Loaded AFTER the resolve shim + secret env var are in place, and after
  // the schema exists, so getDb() inside the module returns our in-memory db.
  const { requireTeacherAuth, extractBearerToken, resolveTeacherById } = require(authPath);
  const jwt = require('jsonwebtoken');

  function signToken(payload, opts = {}) {
    return jwt.sign(payload, TEST_SECRET, { expiresIn: '1h', ...opts });
  }

  // ── Section 1: extractBearerToken ──
  console.log('\n── Section 1: extractBearerToken ──');
  {
    assert(extractBearerToken('Bearer abc.def.ghi') === 'abc.def.ghi', 'extracts token from well-formed header');
    assert(extractBearerToken(undefined) === null, 'undefined header -> null');
    assert(extractBearerToken('') === null, 'empty header -> null');
    assert(extractBearerToken('Basic abc123') === null, 'non-Bearer scheme -> null');
    assert(extractBearerToken('Bearer') === null, 'Bearer with no token -> null');
    assert(extractBearerToken('Bearer    ') === null, 'Bearer with only whitespace -> null');
    assert(extractBearerToken('bearer abc.def.ghi') === null, 'lowercase scheme is NOT accepted (case-sensitive per RFC 6750)');
  }

  // ── Section 2: resolveTeacherById ──
  console.log('\n── Section 2: resolveTeacherById ──');
  {
    const id = insertTeacher('hash_resolve_001');
    const found = resolveTeacherById(id);
    assert(found !== null, 'existing teacher id resolves');
    assert(found && found.id === id, 'resolved id matches');
    assert(found && found.phoneHash === 'hash_resolve_001', 'resolved phoneHash matches');

    const notFound = resolveTeacherById(999999);
    assert(notFound === null, 'unknown teacher id resolves to null, not a throw');
  }

  // ── Section 3: happy path — valid token, known teacher ──
  console.log('\n── Section 3: happy path ──');
  {
    const teacherId = insertTeacher('hash_happy_001');
    const token = signToken({ sub: teacherId });
    const { req, res, next, calledNext } = makeReqRes(`Bearer ${token}`);

    requireTeacherAuth(req, res, next);

    assert(calledNext(), 'next() called for a valid token');
    assert(res.statusCode === null, 'no error status set on success');
    assert(req.teacher !== undefined, 'req.teacher populated');
    assert(req.teacher && req.teacher.id === teacherId, 'req.teacher.id matches token subject');
    assert(req.teacher && req.teacher.phoneHash === 'hash_happy_001', 'req.teacher.phoneHash resolved correctly');
    assert(Object.keys(req.teacher).sort().join(',') === 'id,phoneHash', 'req.teacher contains ONLY id and phoneHash (ADR-008 §4: minimal identity)');
  }

  // ── Section 4: missing token ──
  console.log('\n── Section 4: missing token ──');
  {
    const { req, res, next, calledNext } = makeReqRes(undefined);
    requireTeacherAuth(req, res, next);
    assert(!calledNext(), 'next() NOT called with no Authorization header');
    assert(res.statusCode === 401, 'responds 401 for missing token');
    assert(req.teacher === undefined, 'req.teacher not set on failure');
  }

  // ── Section 5: malformed header ──
  console.log('\n── Section 5: malformed header ──');
  {
    const cases = ['NotBearer sometoken', 'Bearer', 'justatoken', ''];
    for (const header of cases) {
      const { req, res, next, calledNext } = makeReqRes(header);
      requireTeacherAuth(req, res, next);
      assert(!calledNext(), `next() NOT called for malformed header: "${header}"`);
      assert(res.statusCode === 401, `responds 401 for malformed header: "${header}"`);
    }
  }

  // ── Section 6: invalid signature ──
  console.log('\n── Section 6: invalid signature ──');
  {
    const teacherId = insertTeacher('hash_badsig_001');
    const tokenSignedWithWrongSecret = jwt.sign({ sub: teacherId }, 'wrong-secret', { expiresIn: '1h' });
    const { req, res, next, calledNext } = makeReqRes(`Bearer ${tokenSignedWithWrongSecret}`);

    requireTeacherAuth(req, res, next);

    assert(!calledNext(), 'next() NOT called for a token signed with the wrong secret');
    assert(res.statusCode === 401, 'responds 401 for invalid signature');
  }

  // ── Section 7: expired token ──
  console.log('\n── Section 7: expired token ──');
  {
    const teacherId = insertTeacher('hash_expired_001');
    const expiredToken = signToken({ sub: teacherId }, { expiresIn: '-10s' });
    const { req, res, next, calledNext } = makeReqRes(`Bearer ${expiredToken}`);

    requireTeacherAuth(req, res, next);

    assert(!calledNext(), 'next() NOT called for an expired token');
    assert(res.statusCode === 401, 'responds 401 for expired token');
  }

  // ── Section 8: unknown teacher (valid signature, subject doesn't exist) ──
  console.log('\n── Section 8: unknown teacher ──');
  {
    const token = signToken({ sub: 999999 });
    const { req, res, next, calledNext } = makeReqRes(`Bearer ${token}`);

    requireTeacherAuth(req, res, next);

    assert(!calledNext(), 'next() NOT called when token subject matches no teacher');
    assert(res.statusCode === 401, 'responds 401 for unknown teacher, not 404 (no oracle for token guessing)');
  }

  // ── Section 9: malformed/missing subject claim ──
  console.log('\n── Section 9: malformed subject claim ──');
  {
    const casesPayloads = [
      { label: 'no sub claim at all', payload: {} },
      { label: 'non-numeric sub', payload: { sub: 'not-a-number' } },
      { label: 'zero sub', payload: { sub: 0 } },
      { label: 'negative sub', payload: { sub: -5 } },
    ];
    for (const { label, payload } of casesPayloads) {
      const token = signToken(payload);
      const { req, res, next, calledNext } = makeReqRes(`Bearer ${token}`);
      requireTeacherAuth(req, res, next);
      assert(!calledNext(), `next() NOT called for ${label}`);
      assert(res.statusCode === 401, `responds 401 for ${label}`);
    }
  }

  // ── Section 10: TEACHER_JWT_SECRET not configured ──
  console.log('\n── Section 10: server misconfiguration ──');
  {
    const original = process.env.TEACHER_JWT_SECRET;
    delete process.env.TEACHER_JWT_SECRET;

    const teacherId = insertTeacher('hash_misconfig_001');
    // Sign with the secret the middleware SHOULD have used, to isolate
    // this test to the "secret missing" path rather than a signature failure.
    const token = jwt.sign({ sub: teacherId }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next, calledNext } = makeReqRes(`Bearer ${token}`);

    requireTeacherAuth(req, res, next);

    assert(!calledNext(), 'next() NOT called when TEACHER_JWT_SECRET is unset');
    assert(res.statusCode === 500, 'responds 500 (server misconfiguration), not 401, when secret is missing');

    process.env.TEACHER_JWT_SECRET = original;
  }

  // ── Section 11: two different teachers resolve to two different identities ──
  console.log('\n── Section 11: teacher isolation ──');
  {
    const teacherA = insertTeacher('hash_isolation_a');
    const teacherB = insertTeacher('hash_isolation_b');

    const tokenA = signToken({ sub: teacherA });
    const tokenB = signToken({ sub: teacherB });

    const resultA = makeReqRes(`Bearer ${tokenA}`);
    requireTeacherAuth(resultA.req, resultA.res, resultA.next);

    const resultB = makeReqRes(`Bearer ${tokenB}`);
    requireTeacherAuth(resultB.req, resultB.res, resultB.next);

    assert(resultA.req.teacher.phoneHash === 'hash_isolation_a', 'teacher A resolves to teacher A\'s phoneHash');
    assert(resultB.req.teacher.phoneHash === 'hash_isolation_b', 'teacher B resolves to teacher B\'s phoneHash');
    assert(resultA.req.teacher.phoneHash !== resultB.req.teacher.phoneHash, 'two distinct tokens never cross-resolve to the same identity');
  }

  // ── Section 12: no module-level coupling to Express or HTTP framework specifics ──
  console.log('\n── Section 12: module surface ──');
  {
    const mod = require(authPath);
    const exportedKeys = Object.keys(mod).sort();
    assert(exportedKeys.join(',') === 'extractBearerToken,requireTeacherAuth,resolveTeacherById', 'module exports exactly the expected surface, nothing extra');
  }

  console.log('\n' + '='.repeat(75));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
