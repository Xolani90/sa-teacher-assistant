'use strict';

/**
 * Regression coverage for the four features added on top of the
 * add-note work: CORRECT (supersedes model), DELETE, RESOLVE, and
 * incremental (multi-message) observation entry.
 *
 * Follows the project's __testExports / auto-discoverable pattern:
 * a self-contained script with its own assert-based runner, no
 * external test framework dependency, discoverable by run-all.js.
 *
 * Repository behaviour is faked in-memory here rather than hitting a
 * real DB — this file is testing the FLOW layer's state machine and
 * its contract with the repository functions (call shape, ownership
 * checks surfaced as thrown errors, null-for-not-found), not SQL.
 * Repository-level behaviour itself (the actual SQL, transactions,
 * FK-less dangling references) belongs in a separate
 * observationRepository.test.js against a real db handle.
 */

const assert = require('assert');
const {
  handleObservationFlow,
  handleObservationHistoryFlow,
} = require('../flows/observationFlow');
const { parseObservation, getObservationFormatHelpText } = require('../utils/observationParser');

// ── Test harness ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ── Fakes ────────────────────────────────────────────────────────────────

class SessionStore {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.get(key); }
  set(key, val) { this.map.set(key, val); }
  delete(key) { this.map.delete(key); }
}

/**
 * In-memory stand-in for observationRepository.js. Mirrors its ownership
 * checks (throw on cross-teacher access, null on not-found) and its
 * supersedes/resolved semantics, without touching a real DB.
 */
function makeFakeRepository() {
  const assessments = new Map(); // id -> assessment row (with records array)
  let nextAssessmentId = 1;
  let nextRecordId = 1;

  function cloneAssessment(a) {
    const supersededBy = [...assessments.values()].find(x => x.correctsAssessmentId === a.id);
    return {
      id: a.id,
      phoneHash: a.phoneHash,
      grade: a.grade,
      subject: a.subject,
      assessmentName: a.assessmentName,
      classId: a.classId,
      correctsAssessmentId: a.correctsAssessmentId,
      supersededByAssessmentId: supersededBy ? supersededBy.id : null,
      createdAt: a.createdAt,
      records: a.records.map(r => ({ ...r })),
    };
  }

  return {
    saveObservationSubmission(phoneHash, header, records, classId = null, correctsAssessmentId = null) {
      if (!phoneHash) throw new Error('saveObservationSubmission: phoneHash must not be null or empty');
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('saveObservationSubmission: records must be a non-empty array');
      }
      if (correctsAssessmentId != null) {
        const original = assessments.get(correctsAssessmentId);
        if (!original) throw new Error('saveObservationSubmission: corrects_assessment_id does not reference an existing assessment');
        if (original.phoneHash !== phoneHash) throw new Error("saveObservationSubmission: cannot correct another teacher's assessment");
      }

      const id = nextAssessmentId++;
      const row = {
        id,
        phoneHash,
        grade: header?.grade ?? null,
        subject: header?.subject ?? null,
        assessmentName: header?.assessment ?? null,
        classId,
        correctsAssessmentId,
        createdAt: `2026-07-20 00:00:${String(id).padStart(2, '0')}`,
        records: records.map(r => ({
          id: nextRecordId++,
          learnerName: r.learnerName,
          domain: r.domain,
          developmentalStatus: r.developmentalStatus,
          notes: r.notes ?? null,
          resolved: false,
        })),
      };
      assessments.set(id, row);
      return { assessmentId: id, recordCount: records.length };
    },

    getObservationAssessment(assessmentId) {
      const row = assessments.get(assessmentId);
      return row ? cloneAssessment(row) : null;
    },

    getObservationHistory(phoneHash, filters = {}) {
      let list = [...assessments.values()].filter(a => a.phoneHash === phoneHash);
      if (!filters.includeSuperseded) {
        list = list.filter(a => ![...assessments.values()].some(x => x.correctsAssessmentId === a.id));
      }
      list = list.sort((a, b) => b.id - a.id);
      if (filters.limit) list = list.slice(0, filters.limit);
      return list.map(a => ({
        id: a.id,
        phoneHash: a.phoneHash,
        grade: a.grade,
        subject: a.subject,
        assessmentName: a.assessmentName,
        createdAt: a.createdAt,
        recordCount: a.records.length,
        learnerCount: new Set(a.records.map(r => r.learnerName)).size,
      }));
    },

    appendObservationNote(recordId, phoneHash, noteText) {
      for (const a of assessments.values()) {
        const rec = a.records.find(r => r.id === recordId);
        if (rec) {
          if (a.phoneHash !== phoneHash) throw new Error('appendObservationNote: record does not belong to this teacher');
          const addition = `[2026-07-20] ${noteText.trim()}`;
          rec.notes = rec.notes ? `${rec.notes}\n${addition}` : addition;
          return { recordId, notes: rec.notes };
        }
      }
      return null;
    },

    deleteObservationAssessment(assessmentId, phoneHash) {
      const row = assessments.get(assessmentId);
      if (!row) return null;
      if (row.phoneHash !== phoneHash) throw new Error('deleteObservationAssessment: assessment does not belong to this teacher');
      assessments.delete(assessmentId);
      return { assessmentId, deleted: true };
    },

    resolveObservationRecord(recordId, phoneHash) {
      for (const a of assessments.values()) {
        const rec = a.records.find(r => r.id === recordId);
        if (rec) {
          if (a.phoneHash !== phoneHash) throw new Error('resolveObservationRecord: record does not belong to this teacher');
          rec.resolved = true;
          return { recordId, resolved: true };
        }
      }
      return null;
    },

    _debug_assessments: assessments,
  };
}

function analyzeObservations(records) {
  const observationsOfConcern = records.filter(r =>
    r.developmentalStatus === 'Not Yet' ||
    (r.developmentalStatus === 'Developing' && r.notes)
  );
  return { observationsOfConcern };
}

function processObservationSubmission(text) {
  const result = parseObservation(text);
  if (!result.success) {
    return { success: false, errors: result.errors, helpText: getObservationFormatHelpText() };
  }
  return {
    success: true,
    header: result.header,
    records: result.records,
    summary: `Learners: ${result.metadata.learnerCount}\nRecords: ${result.metadata.recordCount}`,
    errors: [],
    warnings: result.warnings,
  };
}

function makeDeps(repo, { observationState, observationHistoryState, messages }) {
  return {
    observationState,
    observationHistoryState,
    safeSendMessage: async (from, text) => { messages.push({ from, text }); },
    parseIntent: () => ({ type: 'unknown' }),
    gradeLabel: (grade) => (grade === 0 || grade === '0' ? 'Grade R' : `Grade ${grade}`),
    hashPhone: (from) => `hash:${from}`,
    processObservationSubmission,
    getObservationFormatHelpText,
    saveObservationSubmission: repo.saveObservationSubmission,
    getObservationHistory: repo.getObservationHistory,
    getObservationAssessment: repo.getObservationAssessment,
    appendObservationNote: repo.appendObservationNote,
    deleteObservationAssessment: repo.deleteObservationAssessment,
    resolveObservationRecord: repo.resolveObservationRecord,
    analyzeObservations,
    getTeacherClasses: () => [], // zero-class policy — keeps tests focused
    formatClassSelectionPrompt: () => '',
    matchClassSelection: () => null,
  };
}

function lastMessage(messages) {
  return messages[messages.length - 1]?.text ?? '';
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const FROM = '27821234567';

const CHUNK_1 = [
  'Assessment: Term 3 Week 4',
  'Grade: R',
  'Subject: Mathematics',
  '',
  'Learner: Sipho',
  'Domain: Number Recognition',
  'Status: Developing',
  'Notes: Counts confidently to 10 but struggles beyond that.',
].join('\n');

const CHUNK_2 = [
  'Learner: Ayanda',
  'Domain: Oral Language',
  'Status: Achieved',
].join('\n');

const CORRECTED_SINGLE = [
  'Assessment: Term 3 Week 4',
  'Grade: R',
  'Subject: Mathematics',
  '',
  'Learner: Sipho',
  'Domain: Number Recognition',
  'Status: Not Yet',
  'Notes: Corrected — actually struggles from the start, not just beyond 10.',
].join('\n');

// ── Tests: incremental entry ────────────────────────────────────────────

async function testIncrementalDone() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });

  // Fresh entry
  await handleObservationFlow(FROM, 'record observation', { type: 'observation' }, deps);
  assert.strictEqual(observationState.get(deps.hashPhone(FROM)).step, 'awaitingObservationText');

  // First chunk — should move to collectingRecords, NOT save yet
  await handleObservationFlow(FROM, CHUNK_1, null, deps);
  let state = observationState.get(deps.hashPhone(FROM));
  assert.strictEqual(state.step, 'collectingRecords');
  assert.strictEqual(state.records.length, 1);
  assert.strictEqual(repo._debug_assessments.size, 0, 'must not save on first chunk');
  assert.ok(/Reply \*DONE\*/.test(lastMessage(messages)));

  // Second chunk — should merge, still not saved
  await handleObservationFlow(FROM, CHUNK_2, null, deps);
  state = observationState.get(deps.hashPhone(FROM));
  assert.strictEqual(state.records.length, 2);
  assert.strictEqual(repo._debug_assessments.size, 0, 'must not save on second chunk');
  assert.ok(/Total so far: 2/.test(lastMessage(messages)));

  // DONE — now it saves everything as one assessment
  await handleObservationFlow(FROM, 'DONE', null, deps);
  assert.strictEqual(repo._debug_assessments.size, 1);
  const saved = [...repo._debug_assessments.values()][0];
  assert.strictEqual(saved.records.length, 2);
  assert.strictEqual(saved.records[0].learnerName, 'Sipho');
  assert.strictEqual(saved.records[1].learnerName, 'Ayanda');
  assert.strictEqual(observationState.get(deps.hashPhone(FROM)), undefined, 'state cleared after save');
  assert.ok(/saved successfully/.test(lastMessage(messages)));
}

async function testIncrementalCancelDiscards() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });

  await handleObservationFlow(FROM, 'record observation', { type: 'observation' }, deps);
  await handleObservationFlow(FROM, CHUNK_1, null, deps);
  assert.strictEqual(observationState.get(deps.hashPhone(FROM)).step, 'collectingRecords');

  await handleObservationFlow(FROM, 'CANCEL', null, deps);
  assert.strictEqual(observationState.get(deps.hashPhone(FROM)), undefined);
  assert.strictEqual(repo._debug_assessments.size, 0, 'nothing should be saved after cancel');
}

async function testIncrementalBadAdditionKeepsEarlierRecordsSafe() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });

  await handleObservationFlow(FROM, 'record observation', { type: 'observation' }, deps);
  await handleObservationFlow(FROM, CHUNK_1, null, deps);

  // Garbage addition — not a valid observation chunk
  await handleObservationFlow(FROM, 'this is not a valid block at all', null, deps);
  const state = observationState.get(deps.hashPhone(FROM));
  assert.strictEqual(state.step, 'collectingRecords');
  assert.strictEqual(state.records.length, 1, 'earlier record must survive a bad addition');
  assert.ok(/earlier record.*are still safe|Couldn't read that addition/.test(lastMessage(messages)));

  // Can still DONE with just the original record
  await handleObservationFlow(FROM, 'DONE', null, deps);
  assert.strictEqual(repo._debug_assessments.size, 1);
  assert.strictEqual([...repo._debug_assessments.values()][0].records.length, 1);
}

// ── Tests: correction (supersedes) ──────────────────────────────────────

async function driveToDetailView(repo, deps, from) {
  await handleObservationHistoryFlow(from, 'my observations', { type: 'observationHistory' }, deps);
  await handleObservationHistoryFlow(from, '1', null, deps);
}

async function testCorrectFlowSupersedesOriginal() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  // Seed an original assessment directly via the repo.
  const parsed = parseObservation(CHUNK_1);
  const { assessmentId: originalId } = repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);

  // View it, then issue CORRECT.
  await driveToDetailView(repo, deps, FROM);
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'detailShown');

  await handleObservationHistoryFlow(FROM, 'CORRECT', null, deps);
  assert.strictEqual(observationHistoryState.get(phoneHash), undefined, 'history state handed off, not left dangling');
  const obsState = observationState.get(phoneHash);
  assert.strictEqual(obsState.step, 'awaitingObservationText');
  assert.strictEqual(obsState.correctsAssessmentId, originalId);
  assert.ok(/Correcting this observation/.test(lastMessage(messages)));

  // Send corrected content, then DONE.
  await handleObservationFlow(FROM, CORRECTED_SINGLE, null, deps);
  await handleObservationFlow(FROM, 'DONE', null, deps);
  assert.ok(/replaces the earlier version/.test(lastMessage(messages)));

  // Two assessments now exist; original is superseded and hidden from history.
  assert.strictEqual(repo._debug_assessments.size, 2);
  const history = repo.getObservationHistory(phoneHash);
  assert.strictEqual(history.length, 1, 'superseded original must be hidden from default history');
  assert.notStrictEqual(history[0].id, originalId);

  const original = repo.getObservationAssessment(originalId);
  assert.ok(original.supersededByAssessmentId, 'original must record who superseded it');

  const correction = repo.getObservationAssessment(original.supersededByAssessmentId);
  assert.strictEqual(correction.correctsAssessmentId, originalId);
  assert.strictEqual(correction.records[0].developmentalStatus, 'Not Yet');
}

async function testCorrectBlockedWhenAlreadySuperseded() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  const parsed = parseObservation(CHUNK_1);
  const { assessmentId: originalId } = repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);
  const parsedCorrection = parseObservation(CORRECTED_SINGLE);
  repo.saveObservationSubmission(phoneHash, parsedCorrection.header, parsedCorrection.records, null, originalId);

  // View the ORIGINAL directly (bypassing the now-filtered history list)
  // by manipulating state as if the teacher had it open before it was
  // superseded — exercises the "already corrected" guard on detailShown.
  observationHistoryState.set(phoneHash, {
    step: 'detailShown',
    ids: [originalId],
    assessmentId: originalId,
    assessmentClassId: null,
    supersededByAssessmentId: repo.getObservationAssessment(originalId).supersededByAssessmentId,
    recordIds: repo.getObservationAssessment(originalId).records.map(r => r.id),
    lastActivity: Date.now(),
  });

  await handleObservationHistoryFlow(FROM, 'CORRECT', null, deps);
  assert.ok(/already been corrected/.test(lastMessage(messages)));
  assert.strictEqual(observationState.get(phoneHash), undefined, 'must not hand off to observationState when blocked');
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'detailShown', 'stays put after being blocked');
}

// ── Tests: delete ────────────────────────────────────────────────────────

async function testDeleteConfirmRemoves() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  const parsed = parseObservation(CHUNK_1);
  const { assessmentId } = repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);

  await driveToDetailView(repo, deps, FROM);
  await handleObservationHistoryFlow(FROM, 'DELETE', null, deps);
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'awaitingDeleteConfirmation');
  assert.ok(/can't be undone/.test(lastMessage(messages)));

  await handleObservationHistoryFlow(FROM, 'CONFIRM', null, deps);
  assert.strictEqual(repo._debug_assessments.has(assessmentId), false);
  assert.strictEqual(observationHistoryState.get(phoneHash), undefined);
  assert.ok(/deleted/i.test(lastMessage(messages)));
}

async function testDeleteNonConfirmCancels() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  const parsed = parseObservation(CHUNK_1);
  const { assessmentId } = repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);

  await driveToDetailView(repo, deps, FROM);
  await handleObservationHistoryFlow(FROM, 'DELETE', null, deps);
  await handleObservationHistoryFlow(FROM, 'nevermind', null, deps);

  assert.strictEqual(repo._debug_assessments.has(assessmentId), true, 'must survive a non-CONFIRM reply');
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'listShown');
  assert.ok(/nothing was deleted/.test(lastMessage(messages)));
}

// ── Tests: resolve ───────────────────────────────────────────────────────

async function testResolveExcludesFromFollowUp() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  const parsed = parseObservation(CHUNK_1); // Sipho, Developing, has notes -> concern
  repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);

  await driveToDetailView(repo, deps, FROM);
  assert.ok(/Needs follow-up/.test(lastMessage(messages)), 'should flag as needing follow-up before resolving');

  await handleObservationHistoryFlow(FROM, 'RESOLVE', null, deps);
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'awaitingResolveRecordSelection');

  await handleObservationHistoryFlow(FROM, '1', null, deps);
  assert.ok(/Marked as resolved/.test(lastMessage(messages)));
  assert.strictEqual(observationHistoryState.get(phoneHash), undefined);

  // Re-view the assessment — should no longer show under "Needs follow-up".
  await driveToDetailView(repo, deps, FROM);
  const detail = lastMessage(messages);
  assert.ok(/No follow-up needed/.test(detail), 'resolved record must drop out of follow-up list');
  assert.ok(/resolved/.test(detail), 'resolved tag should still show in the record list');
}

// ── Tests: add note regression ─────────────────────────────────────────

async function testAddNoteAppendsPreservingPrior() {
  const repo = makeFakeRepository();
  const messages = [];
  const observationState = new SessionStore();
  const observationHistoryState = new SessionStore();
  const deps = makeDeps(repo, { observationState, observationHistoryState, messages });
  const phoneHash = deps.hashPhone(FROM);

  const parsed = parseObservation(CHUNK_1);
  const { assessmentId } = repo.saveObservationSubmission(phoneHash, parsed.header, parsed.records);
  const recordId = repo.getObservationAssessment(assessmentId).records[0].id;

  await driveToDetailView(repo, deps, FROM);
  await handleObservationHistoryFlow(FROM, 'ADD NOTE', null, deps);
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'awaitingNoteRecordSelection');

  await handleObservationHistoryFlow(FROM, '1', null, deps);
  assert.strictEqual(observationHistoryState.get(phoneHash).step, 'awaitingNoteText');
  assert.strictEqual(observationHistoryState.get(phoneHash).targetRecordId, recordId);

  await handleObservationHistoryFlow(FROM, 'Followed up with mom, improving.', null, deps);
  assert.ok(/Note added/.test(lastMessage(messages)));

  const updated = repo.getObservationAssessment(assessmentId).records[0];
  assert.ok(updated.notes.includes('Counts confidently to 10'), 'original note preserved');
  assert.ok(updated.notes.includes('Followed up with mom'), 'new note appended');
  assert.strictEqual(observationHistoryState.get(phoneHash), undefined);
}

// ── Tests: ownership checks (repository contract exercised via flow) ────

async function testDeleteRejectsCrossTeacherOwnership() {
  const repo = makeFakeRepository();
  const parsed = parseObservation(CHUNK_1);
  const { assessmentId } = repo.saveObservationSubmission('hash:teacher-a', parsed.header, parsed.records);

  assert.throws(
    () => repo.deleteObservationAssessment(assessmentId, 'hash:teacher-b'),
    /does not belong to this teacher/
  );
  assert.strictEqual(repo._debug_assessments.has(assessmentId), true, 'must not delete on failed ownership check');
}

async function testResolveRejectsCrossTeacherOwnership() {
  const repo = makeFakeRepository();
  const parsed = parseObservation(CHUNK_1);
  const { assessmentId } = repo.saveObservationSubmission('hash:teacher-a', parsed.header, parsed.records);
  const recordId = repo.getObservationAssessment(assessmentId).records[0].id;

  assert.throws(
    () => repo.resolveObservationRecord(recordId, 'hash:teacher-b'),
    /does not belong to this teacher/
  );
  assert.strictEqual(repo.getObservationAssessment(assessmentId).records[0].resolved, false);
}

// ── Run ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Incremental entry:');
  await test('DONE saves all accumulated records from multiple messages as one assessment', testIncrementalDone);
  await test('CANCEL discards accumulated records without saving', testIncrementalCancelDiscards);
  await test('a bad addition mid-collection keeps earlier records safe and DONE-able', testIncrementalBadAdditionKeepsEarlierRecordsSafe);

  console.log('Correction (supersedes):');
  await test('CORRECT hands off, saves as correction, hides original from history', testCorrectFlowSupersedesOriginal);
  await test('CORRECT is blocked once an assessment has already been superseded', testCorrectBlockedWhenAlreadySuperseded);

  console.log('Delete:');
  await test('DELETE + CONFIRM permanently removes the assessment', testDeleteConfirmRemoves);
  await test('DELETE + anything else cancels without removing', testDeleteNonConfirmCancels);

  console.log('Resolve:');
  await test('RESOLVE marks a record resolved and excludes it from future follow-up', testResolveExcludesFromFollowUp);

  console.log('Add note (regression):');
  await test('ADD NOTE appends to existing notes without overwriting', testAddNoteAppendsPreservingPrior);

  console.log('Ownership checks:');
  await test('deleteObservationAssessment rejects cross-teacher deletion', testDeleteRejectsCrossTeacherOwnership);
  await test('resolveObservationRecord rejects cross-teacher resolution', testResolveRejectsCrossTeacherOwnership);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
