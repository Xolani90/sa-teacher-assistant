// scripts/bootstrap-check.js
process.env.DB_PATH = require('path').join(__dirname, '..', 'fresh-bootstrap-test.db');

const fs = require('fs');
// Make sure we start from a truly empty file
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

const { getDb, runMigrations } = require('../utils/database');

runMigrations();
const db = getDb();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map(r => r.name);

console.log('Tables created:', tables);

const required = ['observation_assessments', 'observation_records'];
const missing = required.filter(t => !tables.includes(t));

if (missing.length) {
  console.error('❌ MISSING TABLES:', missing);
  process.exit(1);
} else {
  console.log('✅ All required tables present, including:', required.join(', '));
}

// Clean up the throwaway file
db.close();
fs.unlinkSync(process.env.DB_PATH);
console.log('✅ Bootstrap check complete. Throwaway DB removed.');