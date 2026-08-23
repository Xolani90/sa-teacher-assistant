'use strict';

require('dotenv').config();
const { hashPhone } = require('./utils/usageTracker');
const { getDb } = require('./utils/database');

const phoneArg = process.argv[2];
const full = process.argv.includes('--full');

if (!phoneArg) {
  console.error('Usage: node reset-onboarding.js <phone number> [--full]');
  process.exit(1);
}

const hash = hashPhone(phoneArg);
const db = getDb();

const onboardingResult = db.prepare(`DELETE FROM onboarding WHERE phone_hash = ?`).run(hash);
console.log(`Deleted ${onboardingResult.changes} onboarding row(s) for hash ${hash}`);

if (full) {
  const teacherResult = db.prepare(`DELETE FROM teachers WHERE phone_hash = ?`).run(hash);
  console.log(`Deleted ${teacherResult.changes} teacher profile row(s) for hash ${hash}`);
  console.log('Note: usage_events/subscriptions rows referencing this phone_hash are left in place.');
} else {
  console.log('Profile left intact (name/grade/subject/school/language). Pass --full to wipe that too.');
}

console.log('Done. Next message from this number on WhatsApp will be treated as brand-new for onboarding.');
