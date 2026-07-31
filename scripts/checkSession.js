'use strict';

require('dotenv').config();
const { getDb } = require('./utils/database');
const { hashPhone } = require('./utils/usageTracker');

const db = getDb();

const rawPhone = process.argv[2];
if (!rawPhone) {
  console.error('Usage: node checkSession.js "<phone number, same format you used to seed>"');
  process.exit(1);
}

const phoneHash = hashPhone(rawPhone);
console.log(`[check] phoneHash: ${phoneHash}`);

// Dump the sessions table schema first so we know the actual columns.
const columns = db.prepare(`PRAGMA table_info(sessions)`).all();
console.log('\n[check] sessions table columns:', columns.map(c => c.name).join(', '));

// Show every session row for this phoneHash, across all flow types —
// column names guessed as phone_hash/session_type/state based on common
// SessionStore conventions; if this errors, paste the columns list above
// and we'll adjust the query.
try {
  const rows = db.prepare(`SELECT * FROM sessions WHERE phone_hash = ?`).all(phoneHash);
  console.log(`\n[check] All session rows for this phoneHash (${rows.length}):`);
  console.log(JSON.stringify(rows, null, 2));
} catch (err) {
  console.error('[check] Query failed:', err.message);
  console.error('[check] Check the columns list above and adjust the WHERE clause.');
}
