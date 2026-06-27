#!/usr/bin/env node
// ── Test runner (Phase C1-T2) ────────────────────────────────────────────────
// Runs every *.test.js / test-*.js file in this directory as its own
// child process, in isolation, so:
//   - a crash or process.exit(1) in one file cannot prevent the others
//     from running (the original `&&`-chain problem)
//   - each file's own pass/fail counting and exit code logic is preserved
//     unchanged -- this script does not parse or re-implement assertions,
//     it only reads each child's exit code
//   - the final exit code is non-zero if ANY suite failed, so CI behaves
//     correctly
//
// Deliberately NOT a framework migration: no Jest/Mocha, no rewriting of
// the 13 existing files. This is the smallest fix that makes "every suite
// runs, and failures are reported" true.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_DIR = __dirname;

// Run every file in this directory that looks like a test file, except
// this runner itself. Order is alphabetical for determinism.
const files = fs.readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.js') && f !== path.basename(__filename))
  .sort();

if (files.length === 0) {
  console.error('No test files found in tests/.');
  process.exit(1);
}

const results = [];

for (const file of files) {
  const fullPath = path.join(TESTS_DIR, file);
  console.log(`\n=== ${file} ===`);

  const start = Date.now();
  const res = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit',
    cwd: path.join(TESTS_DIR, '..'), // run with same cwd as `node tests/x.js` from project root
  });
  const durationMs = Date.now() - start;

  const passed = res.status === 0;
  results.push({ file, passed, exitCode: res.status, durationMs, signal: res.signal });

  if (!passed) {
    console.log(`--- ${file} FAILED (exit code ${res.status}${res.signal ? `, signal ${res.signal}` : ''}) ---`);
  }
}

// ── Aggregate summary ────────────────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════');
console.log('TEST SUITE SUMMARY');
console.log('══════════════════════════════════════════════════════');

let passCount = 0;
let failCount = 0;

for (const r of results) {
  const status = r.passed ? '✅ PASS' : '❌ FAIL';
  const time = `${r.durationMs}ms`;
  console.log(`${status}  ${r.file.padEnd(38)} ${time}`);
  if (r.passed) passCount++; else failCount++;
}

console.log('──────────────────────────────────────────────────────');
console.log(`Suites passed: ${passCount}/${results.length}`);
console.log(`Suites failed: ${failCount}/${results.length}`);
console.log('══════════════════════════════════════════════════════');

if (failCount > 0) {
  console.log(`\n${failCount} suite(s) failed:`);
  for (const r of results) {
    if (!r.passed) console.log(`  - ${r.file}`);
  }
  process.exit(1);
}

console.log('\nAll suites passed.');
process.exit(0);
