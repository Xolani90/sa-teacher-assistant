'use strict';
// mark-user-as-pro.test.js — regression tests for markUserAsPro() expiry semantics.
//
// Confirmed defect: markUserAsPro() previously wrote
//   pro_expires = datetime('now', '+' || ? || ' days')
// unconditionally, discarding any time the teacher already had remaining.
// A teacher with 20 days left who was granted "31 days" ended up with 31
// days total, not 51 -- silently losing the 20 days they already had.
//
// Fix: pro_expires is now computed as
//   datetime(MAX(COALESCE(pro_expires, datetime('now')), datetime('now')), '+N days')
// matching the extend-from-max semantics already used by the payment
// renewal path in services/yocoService.js.
//
// This test loads the REAL utils/usageTracker.js against a real in-memory
// better-sqlite3 database, using the same Module._resolveFilename patching
// convention as tests/phase-d-payment-renewal.test.js.
//
// Run: node tests/mark-user-as-pro.test.js

process.env.PII_SECRET = 'test-secret-key-32-bytes-long';

const Database = require('better-sqlite3');
const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.error(`  [FAIL] ${label}`); failed++; }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / MS_PER_DAY);
}

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_hash TEXT NOT NULL UNIQUE,
      name TEXT,
      is_pro INTEGER NOT NULL DEFAULT 0,
      pro_expires TEXT,
      phone_enc TEXT,
      renewal_reminder_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const db = buildDb();

// -- Patch utils/database to return our in-memory db --------------------
const dbPath = path.resolve(__dirname, '../utils/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db } };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '../utils/database' || request === './database') return dbPath;
  return origResolve.call(this, request, ...rest);
};

const { markUserAsPro, hashPhone } = require('../utils/usageTracker');

// -- Fixture helper: seed a teacher row directly, bypassing markUserAsPro --
let seedCounter = 0;
function seedTeacher({ pro_expires = null } = {}) {
  seedCounter += 1;
  const phone = `+2782000${String(seedCounter).padStart(4, '0')}`;
  const hash = hashPhone(phone);
  db.prepare(`
    INSERT INTO teachers (phone_hash, is_pro, pro_expires)
    VALUES (?, 0, ?)
  `).run(hash, pro_expires);
  return phone;
}

console.log('-- mark-user-as-pro.test.js -----------------------------');

// 1. NULL -> now branch. The one wall-clock comparison in this file.
{
  const phone = seedTeacher({ pro_expires: null });
  const grant = markUserAsPro(phone, 31);

  check(grant.previousExpiry === null, 'grant on no-existing-Pro: previousExpiry is null');
  const d = daysBetween(new Date(), grant.expiresAt);
  check(d >= 30 && d <= 32, `grant on no-existing-Pro: expiry ~31 days from now (got ${d})`);
}

// 2. Expired teacher: MAX(now, expired) should discard the stale past date.
{
  const staleExpiry = new Date(Date.now() - 10 * MS_PER_DAY).toISOString();
  const phone = seedTeacher({ pro_expires: staleExpiry });
  const grant = markUserAsPro(phone, 31);

  const d = daysBetween(new Date(), grant.expiresAt);
  check(d >= 30 && d <= 32, `grant on expired teacher: extends from now, not stale date (got ${d} days from now)`);
}

// 3. Active subscription -- the core regression test for the original bug.
{
  const activeExpiry = new Date(Date.now() + 20 * MS_PER_DAY).toISOString();
  const phone = seedTeacher({ pro_expires: activeExpiry });
  const grant = markUserAsPro(phone, 31);

  check(grant.previousExpiry === activeExpiry, 'grant on active Pro: previousExpiry matches seeded value');
  const addedDays = daysBetween(activeExpiry, grant.newExpiry);
  check(addedDays === 31, `grant on active Pro: adds exactly 31 days to existing expiry (got ${addedDays})`);
}

// 4. Stacked grants -- each grant adds exactly daysValid on top of the previous result.
{
  const phone = seedTeacher({ pro_expires: null });
  const first = markUserAsPro(phone, 31);
  const second = markUserAsPro(phone, 31);

  check(second.previousExpiry === first.newExpiry, 'stacked grants: second previousExpiry matches first newExpiry');
  const stackedDays = daysBetween(first.newExpiry, second.newExpiry);
  check(stackedDays === 31, `stacked grants: second grant adds exactly 31 days (got ${stackedDays})`);
}

// 5. Back-to-back grants (accidental double-submit) still stack additively.
{
  const phone = seedTeacher({ pro_expires: null });
  const first = markUserAsPro(phone, 31);
  const second = markUserAsPro(phone, 31);

  const stackedDays = daysBetween(first.newExpiry, second.newExpiry);
  check(stackedDays === 31, `back-to-back grants: both apply additively (got ${stackedDays})`);
}

// 6. Return shape regression -- locks in the object return type.
{
  const phone = seedTeacher({ pro_expires: null });
  const grant = markUserAsPro(phone, 31);

  check(typeof grant === 'object' && grant !== null, 'return shape: markUserAsPro returns an object');
  check('previousExpiry' in grant, 'return shape: has previousExpiry');
  check(typeof grant.newExpiry === 'string', 'return shape: newExpiry is a string');
  check(grant.expiresAt instanceof Date, 'return shape: expiresAt is a Date instance');
  check(grant.daysAdded === 31, 'return shape: daysAdded matches requested value');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
