'use strict';

const { handleIncidentHistoryFlow } = require('../flows/incidentFlow');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAILED: ${message}`);
  }
}

function assertContains(haystack, needle, message) {
  assert(typeof haystack === 'string' && haystack.includes(needle), message);
}

function createMockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation ? implementation(...args) : undefined;
  };
  fn.calls = calls;
  fn.callCount = () => calls.length;
  return fn;
}

function createSessionStore() {
  const store = new Map();
  return {
    get: (phoneHash) => store.get(phoneHash) || null,
    set: (phoneHash, value) => store.set(phoneHash, value),
    delete: (phoneHash) => store.delete(phoneHash),
    __raw: store,
  };
}

const SAMPLE_INCIDENTS_A = [
  { id: 3, phoneHash: 'hash_A', incidentDate: '2026-09-01', incidentTime: '09:30', incidentType: 'INJURY', description: 'Fell during break.', actionTaken: 'Cleaned the wound.' },
  { id: 2, phoneHash: 'hash_A', incidentDate: '2026-08-20', incidentTime: '11:00', incidentType: 'DISCIPLINE', description: 'Disrupted class.', actionTaken: 'Spoke to learner.' },
  { id: 1, phoneHash: 'hash_A', incidentDate: '2026-08-01', incidentTime: '14:00', incidentType: 'BULLYING', description: 'Reported teasing.', actionTaken: 'Involved counsellor.' },
];

function buildDeps(overrides = {}) {
  const incidentHistoryState = createSessionStore();
  const sentMessages = [];
  const safeSendMessage = createMockFn(async (to, text) => { sentMessages.push({ to, text }); });

  const db = { A: [...SAMPLE_INCIDENTS_A], B: [] };

  const listIncidents = createMockFn((phoneHash) => db[phoneHash.replace('hash_', '')] || []);
  const getIncident = createMockFn((phoneHash, id) => {
    const owner = phoneHash.replace('hash_', '');
    const rows = db[owner] || [];
    return rows.find((r) => r.id === id) || null;
  });

  return {
    deps: {
      incidentHistoryState,
      safeSendMessage,
      parseIntent: (text) => (/^my incidents$/i.test(text.trim()) ? { type: 'incidentHistory' } : { type: 'unknown' }),
      hashPhone: (from) => `hash_${from}`,
      listIncidents,
      getIncident,
      ...overrides,
    },
    incidentHistoryState,
    sentMessages,
    listIncidents,
    getIncident,
  };
}

const A = 'A'; // maps to hash_A -> db.A (has 3 incidents)
const B = 'B'; // maps to hash_B -> db.B (empty)

async function run() {
  // ── Entry point ──────────────────────────────────────────────────────
  console.log('\n── Starting the MY INCIDENTS flow ──────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    const handled = await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    assert(handled === true, 'MY INCIDENTS is claimed by the flow');
    assertContains(sentMessages[0].text, 'My Incidents', 'list message has the expected header');
    assertContains(sentMessages[0].text, 'Injury', 'list shows the most recent incident type');
    assertContains(sentMessages[0].text, 'Reply with the number', 'list prompts for a number');
  }
  {
    const { deps } = buildDeps();
    const handled = await handleIncidentHistoryFlow(A, 'lesson plan for grade 4 maths', null, deps);
    assert(handled === false, 'unrelated text with no active session is not claimed');
  }

  // ── Empty state ──────────────────────────────────────────────────────
  console.log('\n── Empty state ──────────────────────────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentHistoryFlow(B, 'my incidents', null, deps);
    assertContains(sentMessages[0].text, "haven't logged any incidents", 'empty history gets a friendly empty-state message');
    assert(deps.incidentHistoryState.get('hash_B') === null, 'empty state does not leave a lingering session');
  }

  // ── List → detail navigation ─────────────────────────────────────────
  console.log('\n── List → detail navigation ────────────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    await handleIncidentHistoryFlow(A, '2', null, deps);
    const detail = sentMessages[sentMessages.length - 1].text;
    assertContains(detail, 'Discipline', 'detail view shows the selected incident\'s type');
    assertContains(detail, 'Disrupted class.', 'detail view shows the description');
    assertContains(detail, 'Spoke to learner.', 'detail view shows the action taken');
    assertContains(detail, 'BACK', 'detail view offers BACK to return to the list');
  }
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    await handleIncidentHistoryFlow(A, '99', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'Reply with a number from 1 to', 'out-of-range number reprompts instead of crashing');
  }
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    await handleIncidentHistoryFlow(A, '1', null, deps);
    await handleIncidentHistoryFlow(A, 'BACK', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'My Incidents', 'BACK from detail returns to the list');
  }
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    await handleIncidentHistoryFlow(A, '1', null, deps);
    await handleIncidentHistoryFlow(A, 'CANCEL', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'cancelled', 'CANCEL from detail ends the session');
    assert(deps.incidentHistoryState.get('hash_A') === null, 'CANCEL clears the session');
  }

  // ── Ownership: phoneHash always server-resolved, no cross-teacher leakage ──
  console.log('\n── Ownership ─────────────────────────────────────────────');
  {
    const { deps, listIncidents } = buildDeps();
    await handleIncidentHistoryFlow(B, 'my incidents', null, deps);
    assert(listIncidents.calls[0][0] === 'hash_B', 'listIncidents is called with the server-resolved phoneHash for teacher B, never teacher A\'s');
  }
  {
    // getIncident is itself phoneHash-scoped (services/incidentService.js);
    // simulate a wrong-owner id resolving to null exactly like a
    // non-existent id would, and confirm the flow handles that gracefully.
    const { deps, sentMessages } = buildDeps({
      getIncident: () => null,
    });
    await handleIncidentHistoryFlow(A, 'my incidents', null, deps);
    await handleIncidentHistoryFlow(A, '1', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, "couldn't be found", 'a wrong-owner or missing id resolves to null and gets a graceful message, never someone else\'s data');
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Incident History WhatsApp Flow Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
