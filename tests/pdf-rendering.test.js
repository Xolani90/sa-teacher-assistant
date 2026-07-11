'use strict';

/**
 * Regression tests for services/pdfService.js.
 *
 * Context: prior to this suite, the PDF rendering engine had ZERO automated
 * test coverage, despite being the component that produces every
 * teacher-facing printed document (worksheets, tests, memos, ATPs,
 * moderation packs, reports). These tests were added after a production
 * audit found several root-cause rendering bugs (see the inline comments
 * in pdfService.js at each fix site):
 *
 *   1. Markdown ATX headers (#, ##, ###) printed literally instead of
 *      being converted to PDF headings.
 *   2. Markdown **bold** printed literally (asterisks and all) — only
 *      single-asterisk *bold* was ever handled.
 *   3. Standard 3-hyphen markdown dividers (---) were misidentified as
 *      bullet points because the divider regex required 4+ characters.
 *   4. Table cells were hard-truncated with "…" instead of wrapping,
 *      and never had their markdown bold markers stripped.
 *   5. The Unicode sanitisation map converted ✓/✔ to a bare "'" (reads as
 *      a stray apostrophe) and was missing the true minus sign (−),
 *      which was silently deleted rather than converted to "-".
 *
 * Run individually:   node tests/pdf-rendering.test.js
 * Run via npm:         npm test
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Point PDF output at an isolated temp dir so this suite never touches
// the real data/ directory and can run alongside other suites.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-')), 'teacher_assistant.db');

const { generatePdf, generateReportSummaryPdf, getPdfPath, sanitiseForPdf, formatMarkStr } = require('../services/pdfService');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

function assertEquals(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function assertGeneratesWithoutThrowing(params, testName) {
  try {
    const result = await generatePdf(params);
    const exists = fs.existsSync(result.filePath);
    const size = exists ? fs.statSync(result.filePath).size : 0;
    assert(exists && size > 200, testName);
    return result;
  } catch (e) {
    assert(false, `${testName} (threw: ${e.message})`);
    return null;
  }
}

async function main() {
  // ─────────────────────────────────────────────
  // TEST 1: sanitiseForPdf — Unicode math/tick handling
  // ─────────────────────────────────────────────
  console.log('\n📋 TEST 1: sanitiseForPdf() character-level fixes');
  {
    // Root cause: U+2212 (true minus sign) was missing from the sanitisation
    // map entirely, so it fell through to the blanket Unicode strip and was
    // silently deleted — "5/6 − 1/3" became "5/6 1/3" with the operator gone.
    assertEquals(sanitiseForPdf('5/6 − 1/3'), '5/6 - 1/3', 'minus sign (U+2212) converts to hyphen, not deleted');

    // Root cause: ✓/✔ were mapped to a bare apostrophe, which reads as a
    // typo/stray quote in marking-memo text like "Proper fraction ' (1)".
    assertEquals(sanitiseForPdf('Proper fraction ✓ (1)'), 'Proper fraction  (1)', 'checkmark removed cleanly, not rendered as stray quote');
    assertEquals(sanitiseForPdf('12/18 = 6/9 ✓✓ = 2/3 (2)'), '12/18 = 6/9  = 2/3 (2)', 'double checkmark removed cleanly');
    assert(!sanitiseForPdf('answer ✓ correct').includes("'"), 'sanitised checkmark output never contains a stray apostrophe');

    // Cross indicator remains a meaningful, unambiguous substitution.
    assertEquals(sanitiseForPdf('wrong ✗ answer'), 'wrong X answer', 'cross converts to X');

    // Existing fraction glyph handling must still work (no regression).
    assertEquals(sanitiseForPdf('½ cup'), '1/2 cup', 'fraction glyph still converts correctly');
  }

  // ─────────────────────────────────────────────
  // TEST 2: full PDF generation — markdown defensive handling
  // ─────────────────────────────────────────────
  console.log('\n📋 TEST 2: generatePdf() handles markdown-formatted AI output without throwing');
  {
    const content = [
      '# ANNUAL TEACHING PLAN 2026',
      '## Grade 7 Mathematics',
      '---',
      '## TERM 1 (Weeks 1-10)',
      '| Week | Topic / Content | Assessment |',
      '|---|---|---|',
      '| 1-2 | **Whole Numbers:** Properties, order of operations, factors and multiples of whole numbers | |',
      '| 3 | **Integers:** Revision; ordering; comparing | **Baseline Assessment** (informal) |',
      '',
      '### A sub-heading',
      'Body text with a checkmark ✓ and a minus 5/6 − 1/3.',
    ].join('\n');

    await assertGeneratesWithoutThrowing(
      { content, type: 'atp', topic: null, grade: 7, subject: 'mathematics', school: 'Test School' },
      'generatePdf() succeeds on markdown-formatted content (#, ##, **, ---) and produces a non-empty file'
    );
  }

  // ─────────────────────────────────────────────
  // TEST 3: robustness — missing/empty fields never crash generation
  // ─────────────────────────────────────────────
  console.log('\n📋 TEST 3: generatePdf() robustness against missing fields');
  {
    await assertGeneratesWithoutThrowing(
      { content: '*WORKSHEET: Test*\n\nSome content.', type: 'worksheet', topic: null, grade: null, subject: null, school: null, marks: null },
      'edge case: all metadata fields null'
    );
    await assertGeneratesWithoutThrowing(
      { content: '', type: 'test', topic: '', grade: '', subject: '', school: '', marks: 0 },
      'edge case: all metadata fields empty string'
    );
    await assertGeneratesWithoutThrowing(
      { content: '| |\n|---|\n| |', type: 'atp', topic: null, grade: 12, subject: 'general', school: 'S' },
      'edge case: near-empty pipe table'
    );
    await assertGeneratesWithoutThrowing(
      { content: 'A'.repeat(3000), type: 'worksheet', topic: 'Long', grade: 8, subject: 'english', school: 'S' },
      'edge case: very long unbroken content string'
    );
  }

  // ─────────────────────────────────────────────
  // TEST 4: large multi-page table — header repeats, no crash
  // ─────────────────────────────────────────────
  console.log('\n📋 TEST 4: generatePdf() handles a large table spanning multiple pages');
  {
    const rows = ['| Week | Topic / Content | Assessment |', '|---|---|---|'];
    for (let i = 1; i <= 40; i++) {
      rows.push(`| Week ${i} | Long topic description for week ${i} covering several CAPS content areas | ${i % 5 === 0 ? 'Test ' + i : ''} |`);
    }
    const content = '# ANNUAL TEACHING PLAN 2026\n## Grade 9 Natural Sciences\n' + rows.join('\n');
    await assertGeneratesWithoutThrowing(
      { content, type: 'atp', topic: null, grade: 9, subject: 'natural sciences', school: 'A School With A Very Long Name' },
      'large (40-row) table generates without crashing'
    );
  }

  // ─────────────────────────────────────────────
  // TEST 5: generateReportSummaryPdf() — undefined-mark, overflow, and
  // multi-row robustness (the summary table previously had its own
  // hand-rolled, buggy table implementation, separate from the shared
  // table renderer used everywhere else)
  // ─────────────────────────────────────────────
  console.log('\n📋 TEST 5: generateReportSummaryPdf() regressions');
  {
    // formatMarkStr — direct unit coverage of the undefined%/null% bug.
    // Previously `c.outOf ? ... : \`${c.mark}%\`` rendered the literal
    // string "undefined%" whenever a comment had no mark recorded.
    assertEquals(formatMarkStr({ mark: undefined }), '—', 'formatMarkStr: undefined mark never renders "undefined%"');
    assertEquals(formatMarkStr({ mark: null }), '—', 'formatMarkStr: null mark never renders "null%"');
    assertEquals(formatMarkStr({ mark: 78, outOf: 100 }), '78/100', 'formatMarkStr: mark/outOf renders as fraction');
    assertEquals(formatMarkStr({ mark: 45 }), '45%', 'formatMarkStr: mark without outOf renders as percentage');
    assertEquals(formatMarkStr({ mark: 0, outOf: 100 }), '0/100', 'formatMarkStr: a genuine mark of 0 is not treated as missing');

    // Full generation — comments include: an undefined mark, a very long
    // learner name, and a long comment that forces multi-line wrapping in
    // the summary table row (previously overlapped the row below it due
    // to a fixed 22pt row height with no wrap-aware sizing).
    const comments = [
      { learnerName: 'A Learner With A Genuinely Very Long Combined Name Field', mark: undefined,
        comment: 'A long comment about performance that should wrap across multiple lines inside the summary table row without overlapping the row beneath it.' },
      { learnerName: 'Second Learner', mark: 78, outOf: 100, comment: 'Short comment.' },
      { learnerName: 'Third Learner', mark: 0, outOf: 50, comment: 'A genuine zero mark must not be mistaken for a missing one.' },
    ];
    const result = await generateReportSummaryPdf(comments, { grade: '7', subject: 'Mathematics', school: 'Test School' });
    const filePath = getPdfPath(result.fileId);
    const exists = filePath && fs.existsSync(filePath);
    assert(exists && fs.statSync(filePath).size > 200, 'generateReportSummaryPdf() generates a non-empty file without throwing');

    // Large roster spanning multiple pages — exercises the header-repeat
    // path (ensureSpace triggering a page break mid-table) and confirms no
    // crash on 30 rows of varying comment length.
    const manyComments = [];
    for (let i = 1; i <= 30; i++) {
      manyComments.push({
        learnerName: `Learner Number ${i}`,
        mark: i % 7 === 0 ? undefined : (i * 3) % 101,
        outOf: i % 3 === 0 ? 100 : undefined,
        comment: `Comment for learner ${i} `.repeat(i % 4 + 1),
      });
    }
    const bigResult = await generateReportSummaryPdf(manyComments, { grade: '9', subject: 'Natural Sciences', school: 'A School With A Long Name' });
    const bigPath = getPdfPath(bigResult.fileId);
    assert(bigPath && fs.existsSync(bigPath) && fs.statSync(bigPath).size > 200, 'generateReportSummaryPdf() handles a 30-row roster spanning multiple pages without crashing');
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('──────────────────────────────────────────────────\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
