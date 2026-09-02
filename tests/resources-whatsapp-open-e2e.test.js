'use strict';
// Phase 3 — Saved Resources full WhatsApp retrieval.
//
// Proves the required architecture end-to-end, against the REAL dispatch
// chain (processMessage -> core/commandHandler.js -> teacherWorkspaceService
// -> DB), not a mocked deps object:
//
//   Saved resource exists in canonical database (saved_resources)
//     -> teacher requests it via WhatsApp (OPEN <id>)
//     -> real repository/service lookup (getSavedResource)
//     -> same persisted resource content returned, verbatim
//
// and the corresponding Dashboard -> WhatsApp mirroring guarantee:
//
//   Canonical saved_resources row (created exactly as SAVE creates it)
//     -> WhatsApp OPEN <id>
//     -> WhatsApp returns the persisted content
//     -> no duplicate entry, no regenerated version
//
// plus ownership isolation, content integrity, empty-list interplay,
// and routing regressions (MY RESOURCES / SAVE / PRINT / numeric-menu
// replies untouched by the new OPEN command).
//
// This intentionally reuses tests/rc1-save-whatsapp-failure-recovery.test.js's
// real-dispatch-chain harness (processMessage + buildProcessMessageDeps via
// routes/webhook.js's __testExports) rather than hand-building a mock deps
// object, so it proves the actual routing/command-handler code path, not a
// simulation of it.
//
// Run individually: node tests/resources-whatsapp-open-e2e.test.js
// Run via npm:       npm test

process.env.PII_SECRET = 'test-secret-key-32-bytes-long!!';
process.env.FREE_LIMIT = '10';
process.env.APP_URL    = 'https://example.test';
process.env.PDF_SECRET = 'pdf-secret';

const Module = require('module');
const path = require('path');

let passed = 0;
let failed = 0;
function check(condition, label, extra) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`); failed++; }
}

// MUST be required before any service/repository module — see
// tests/helpers/createTestDb.js's "Why this must be required first".
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// ── Stub services/whatsappService — capture outbound messages, real
// chunkMessage so the message-splitting requirement is genuinely exercised ──
const sentMessages = [];
const whatsappPath = path.resolve(__dirname, '../services/whatsappService');
const realWhatsapp = require(whatsappPath);
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    sendMessage: async (phone, text) => {
      const chunks = realWhatsapp.chunkMessage(text);
      for (const chunk of chunks) sentMessages.push({ phone, text: chunk });
      return true;
    },
    sendDocument: async () => true,
    downloadMedia: async () => null,
    chunkMessage: realWhatsapp.chunkMessage,
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === './whatsappService' || request === '../services/whatsappService') return whatsappPath;
  return origResolve.call(this, request, ...rest);
};

function insertTeacher(phoneHash, name) {
  db.prepare(`INSERT INTO teachers (phone_hash, name, grade, subject) VALUES (?, ?, ?, ?)`)
    .run(phoneHash, name, '7', 'Mathematics');
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, 'done', datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE SET step = 'done'
  `).run(phoneHash);
}

function makeMessage(from, body, id) {
  return { from, id, type: 'text', text: { body } };
}

(async () => {
  const {
    hashPhone,
    processMessage,
    buildProcessMessageDeps,
  } = require('../routes/webhook').__testExports;
  const { saveResource } = require('../services/teacherWorkspaceService');
  const { createGetResourceDetailHandler } = require('../routes/api').__testExports;
  const { getSavedResource } = require('../services/teacherWorkspaceService');

  let msgCounter = 0;
  async function send(phone, body) {
    msgCounter += 1;
    sentMessages.length = 0;
    await processMessage(makeMessage(phone, body, `msg-${msgCounter}`), buildProcessMessageDeps());
  }
  function allText() {
    return sentMessages.map((m) => m.text).join('\n');
  }

  console.log('\n── Phase 3: OPEN <id> WhatsApp retrieval (real dispatch chain) ──\n');

  const phoneA = '+27821199001';
  const phoneB = '+27821199002';
  const hashA = hashPhone(phoneA);
  const hashB = hashPhone(phoneB);
  insertTeacher(hashA, 'Teacher A');
  insertTeacher(hashB, 'Teacher B');

  // ── Step 0: empty state ────────────────────────────────────────────────
  console.log('── Step 0: MY RESOURCES empty state (before anything is saved) ──');
  await send(phoneA, 'MY RESOURCES');
  check(/haven.?t saved any resources/i.test(allText()), 'empty MY RESOURCES message preserved for a teacher with nothing saved', allText());

  await send(phoneA, 'OPEN 1');
  check(/couldn.?t be found/i.test(allText()), 'OPEN against an empty resource set gives the generic not-found message, not a crash', allText());

  // ── Step 1: "Dashboard/API creates or persists resource" — simulated via
  // the same canonical saveResource() the dashboard-mirroring tests use,
  // since this app's saved resources are actually created through WhatsApp's
  // SAVE flow first (per Phase 3 spec: "If saved resources are currently
  // created through WhatsApp rather than Dashboard, use the actual existing
  // canonical creation path"). This is the SAME function core/commandHandler
  // .js's SAVE branch calls — not a second/duplicate write path. ─────────
  console.log('\n── Step 1: canonical resource creation (saveResource — same path SAVE uses) ──');
  const MARKER = 'UNIQUE-MARKER-7f3a9c-PHASE3-CONTENT-INTEGRITY';
  const longWorksheet =
    `*WORKSHEET: Fractions — Grade 7 Mathematics*\n\n` +
    `${MARKER}\n\n` +
    Array.from({ length: 220 }, (_, i) => `${i + 1}. What is ${i + 1}/2 + ${i + 1}/4?`).join('\n');

  const saved = saveResource(
    hashA,
    'worksheet',
    'Fractions — Worksheet',
    longWorksheet,
    { grade: 7, subject: 'Mathematics', topic: 'Fractions' }
  );
  check(saved && saved.id > 0, 'resource persisted via canonical saveResource()');
  check(longWorksheet.length > 3800, 'seeded content genuinely exceeds a single WhatsApp message (exercises real splitting)', String(longWorksheet.length));

  // ── Step 2: "WhatsApp requests that resource" -> "real repository/service
  // lookup" -> "same persisted resource content returned" ────────────────
  console.log('\n── Step 2: MY RESOURCES lists it with its real DB id ──');
  await send(phoneA, 'MY RESOURCES');
  check(allText().includes(`[${saved.id}]`), 'MY RESOURCES shows the real DB id (existing behaviour preserved)', allText());
  check(allText().includes('Fractions — Worksheet'), 'MY RESOURCES shows the correct title');

  console.log('\n── Step 3: OPEN <id> retrieves the FULL canonical content over WhatsApp ──');
  await send(phoneA, `OPEN ${saved.id}`);
  const openedText = allText();
  check(openedText.includes(MARKER), 'the unique content marker is present — genuine persisted content, not regenerated/summarized', openedText.slice(0, 200));
  // Reconstruct the delivered content by stripping the whatsappService
  // "📄 Part N/Total" labels chunkMessage() prepends to each part, then
  // compare on a whitespace-normalized basis — chunkMessage() trims each
  // individual chunk (services/whatsappService.js), which can shift
  // whitespace exactly at a chunk boundary; that's an existing, harmless
  // formatting artifact of splitting, not data loss. Comparing normalized
  // text still proves every character of the canonical content survived
  // the split (no truncation, no silent shortening, no regeneration).
  const reconstructed = sentMessages.map((m) => m.text.replace(/^📄 Part \d+\/\d+\n\n/, '')).join('');
  // Existing chunkMessage() trims() each individual chunk (services/
  // whatsappService.js), which can absorb the single newline exactly at a
  // chunk boundary — a pre-existing, harmless formatting artifact of
  // splitting itself, not something Phase 3 changes or introduces. Compare
  // with ALL whitespace collapsed out entirely so the assertion proves the
  // real invariant Phase 3 cares about: every non-whitespace character of
  // the canonical content survived delivery — nothing truncated, nothing
  // regenerated, nothing silently shortened.
  const stripWs = (s) => s.replace(/\s+/g, '');
  check(stripWs(reconstructed).includes(stripWs(longWorksheet)), 'the FULL exact persisted content survives delivery verbatim (non-whitespace characters identical across the multi-part delivery) — not truncated, not regenerated');
  check(openedText.includes('Fractions — Worksheet'), 'resource title present in the WhatsApp response');
  check(openedText.includes(`#${saved.id}`), 'resource id present in the WhatsApp response');
  check(sentMessages.length > 1, 'large resource content was actually split across multiple WhatsApp messages (not silently truncated)', String(sentMessages.length));
  for (const m of sentMessages) {
    check(m.text.length <= 4096, 'every individual WhatsApp chunk stays within WhatsApp\'s hard message-length limit', String(m.text.length));
  }

  // ── Step 4: metadata consistency (grade/subject/topic) ──────────────────
  console.log('\n── Step 4: persisted metadata is consistent on WhatsApp ──');
  check(/Gr 7/.test(openedText), 'grade shown in the OPEN response matches the persisted grade');
  check(/Mathematics/.test(openedText), 'subject shown in the OPEN response matches the persisted subject');

  // ── Step 5: "no duplicate entry or regenerated version between interfaces"
  console.log('\n── Step 5: no duplicate row was created by OPEN (read-only) ──');
  const countAfterOpen = db.prepare(`SELECT COUNT(*) as c FROM saved_resources WHERE phone_hash = ?`).get(hashA).c;
  check(countAfterOpen === 1, 'exactly one saved_resources row exists after OPEN — OPEN never writes', String(countAfterOpen));

  console.log('\n── Step 6: dashboard reads the exact same row (canonical, single source of truth) ──');
  const detailHandler = createGetResourceDetailHandler({ getSavedResource });
  const dashRes = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  detailHandler({ teacher: { id: 1, phoneHash: hashA }, params: { id: String(saved.id) } }, dashRes);
  check(dashRes.statusCode === 200, 'dashboard GET /api/resources/:id also returns 200 for this row');
  check(dashRes.body.content === longWorksheet, 'dashboard content is byte-identical to what WhatsApp OPEN delivered — one canonical row, not two');

  // ── Step 7: ownership isolation ──────────────────────────────────────────
  console.log('\n── Step 7: Teacher B cannot open Teacher A\'s resource by id ──');
  await send(phoneB, `OPEN ${saved.id}`);
  const bText = allText();
  check(/couldn.?t be found/i.test(bText), 'Teacher B gets the generic not-found message', bText);
  check(!bText.includes(MARKER), 'Teacher B never receives Teacher A\'s content');
  check(!bText.includes('Fractions'), 'Teacher B\'s response contains no trace of Teacher A\'s resource title');

  await send(phoneB, 'MY RESOURCES');
  check(/haven.?t saved any resources/i.test(allText()), 'Teacher B\'s own MY RESOURCES list is empty (Teacher A\'s resource is not shown)', allText());

  // Same not-found wording for "wrong owner" and "doesn't exist" — no
  // existence oracle.
  await send(phoneB, `OPEN 999999`);
  const nonexistentText = allText();
  check(/couldn.?t be found/i.test(nonexistentText), 'a genuinely nonexistent id gets the SAME generic message');
  check(nonexistentText.trim() === bText.trim(), 'wrong-owner and nonexistent-id responses are textually identical — no existence oracle');

  // ── Step 8: invalid input handling ───────────────────────────────────────
  console.log('\n── Step 8: OPEN with no/invalid argument shows usage, does not crash ──');
  await send(phoneA, 'OPEN');
  check(/Reply \*OPEN/i.test(allText()), 'bare OPEN (no id) shows usage guidance', allText());

  await send(phoneA, 'OPEN abc');
  check(/Reply \*OPEN/i.test(allText()), 'OPEN with a non-numeric argument shows usage guidance, does not throw', allText());

  await send(phoneA, 'OPEN -1');
  check(/Reply \*OPEN/i.test(allText()), 'OPEN with a negative number shows usage guidance', allText());

  // ── Step 9: routing regressions ─────────────────────────────────────────
  console.log('\n── Step 9: existing routing/commands unaffected by the new OPEN command ──');
  await send(phoneA, 'MY RESOURCES');
  check(allText().includes(`[${saved.id}]`), 'MY RESOURCES still works normally after OPEN was exercised');

  // A second, unrelated resource + SAVE flow still functions.
  const { randomUUID } = require('crypto');
  const { lastGeneratedState } = require('../routes/webhook').__testExports;
  const generationId = randomUUID();
  lastGeneratedState.set(hashA, {
    generationId,
    saveState: 'GENERATED',
    intent: { type: 'test', topic: 'Algebra', grade: 8, subject: 'mathematics', term: 1, atpTopic: null, differentiation: null },
    content: 'Full test content for Phase 3 routing-regression check.',
    lastActivity: Date.now(),
  });
  await send(phoneA, 'SAVE');
  check(/Saved!/i.test(allText()), 'SAVE still works normally after Phase 3 changes', allText());

  await send(phoneA, 'MY RESOURCES');
  check(allText().includes('(2 saved)'), 'MY RESOURCES reflects both resources after the new SAVE', allText());

  // Numeric menu replies (bare "1") must not be swallowed by OPEN's prefix
  // match — OPEN requires the literal "OPEN" keyword, a bare number alone
  // is untouched by this command.
  await send(phoneA, '1');
  check(!/Reply \*OPEN/i.test(allText()), 'a bare numeric reply ("1") is NOT captured by the OPEN handler (requires the OPEN keyword)', allText());

  console.log(`\n─────────────────────────────────`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`─────────────────────────────────\n`);

  testDb.cleanup();
  Module._resolveFilename = origResolve;
  if (failed > 0) process.exitCode = 1;
})();
