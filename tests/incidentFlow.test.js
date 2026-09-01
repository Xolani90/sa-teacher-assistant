'use strict';

const { handleIncidentFlow } = require('../flows/incidentFlow');

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

function buildDeps(overrides = {}) {
  const incidentState = createSessionStore();
  const sentMessages = [];
  const safeSendMessage = createMockFn(async (to, text) => { sentMessages.push({ to, text }); });
  const createIncident = createMockFn(async (phoneHash, params) => ({ id: 1, phoneHash, ...params }));

  return {
    deps: {
      incidentState,
      safeSendMessage,
      parseIntent: (text) => (/^incident$/i.test(text.trim()) ? { type: 'incident' } : { type: 'unknown' }),
      hashPhone: (from) => `hash_${from}`,
      createIncident,
      ...overrides,
    },
    incidentState,
    sentMessages,
    createIncident,
  };
}

const FROM = '27821234567';

async function run() {
  // ── Starting the flow ──────────────────────────────────────────────────
  console.log('\n── Starting the Incident Book flow ─────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    const handled = await handleIncidentFlow(FROM, 'incident', null, deps);
    assert(handled === true, 'INCIDENT command is claimed by the flow');
    assertContains(sentMessages[0].text, 'What date', 'first prompt asks for the date');
  }
  {
    const { deps } = buildDeps();
    const handled = await handleIncidentFlow(FROM, 'lesson plan for grade 4 maths', null, deps);
    assert(handled === false, 'unrelated text with no active session is not claimed');
  }

  // ── Full happy path ───────────────────────────────────────────────────
  console.log('\n── Full happy-path conversation ────────────────────────');
  {
    const { deps, sentMessages, createIncident } = buildDeps();

    await handleIncidentFlow(FROM, 'incident', null, deps);
    await handleIncidentFlow(FROM, '2026-09-01', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'time', 'after date, asks for time');

    await handleIncidentFlow(FROM, '09:30', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'Injury', 'after time, shows the incident-type menu including Injury');
    assertContains(sentMessages[sentMessages.length - 1].text, 'Bullying', 'incident-type menu includes Bullying');

    await handleIncidentFlow(FROM, '1', null, deps); // Injury
    assertContains(sentMessages[sentMessages.length - 1].text, 'describe', 'after type, asks to describe what happened');

    await handleIncidentFlow(FROM, 'Learner fell during break and scraped a knee.', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'action', 'after description, asks for action taken');

    await handleIncidentFlow(FROM, 'Cleaned the wound and called the parent.', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'Save this incident', 'shows review summary before saving');
    assertContains(sentMessages[sentMessages.length - 1].text, 'Injury', 'review summary shows the chosen type');

    assert(createIncident.callCount() === 0, 'nothing persisted yet before YES');

    await handleIncidentFlow(FROM, 'YES', null, deps);
    assert(createIncident.callCount() === 1, 'createIncident is called exactly once after YES');
    const [phoneHash, params] = createIncident.calls[0];
    assert(phoneHash === `hash_${FROM}`, 'createIncident is called with the server-resolved phoneHash');
    assert(params.incidentDate === '2026-09-01', 'persisted incidentDate matches what was collected');
    assert(params.incidentTime === '09:30', 'persisted incidentTime matches what was collected');
    assert(params.incidentType === 'INJURY', 'persisted incidentType matches the menu selection');
    assertContains(sentMessages[sentMessages.length - 1].text, 'recorded successfully', 'final confirmation message sent');
  }

  // ── Validation / retry ───────────────────────────────────────────────
  console.log('\n── Validation and retry behaviour ──────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentFlow(FROM, 'incident', null, deps);

    await handleIncidentFlow(FROM, 'tomorrow-ish', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, "doesn't look like a valid date", 'invalid date is rejected with a retry prompt');
    assert(deps.incidentState.get(`hash_${FROM}`).step === 'awaitingDate', 'still on awaitingDate after an invalid date');

    await handleIncidentFlow(FROM, '2026-09-01', null, deps);
    await handleIncidentFlow(FROM, '99:99', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, "doesn't look like a valid time", 'invalid time is rejected with a retry prompt');
    assert(deps.incidentState.get(`hash_${FROM}`).step === 'awaitingTime', 'still on awaitingTime after an invalid time');

    await handleIncidentFlow(FROM, '09:30', null, deps);
    await handleIncidentFlow(FROM, '99', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'choose a number', 'invalid type selection is rejected with a retry prompt');
    assert(deps.incidentState.get(`hash_${FROM}`).step === 'awaitingType', 'still on awaitingType after an invalid selection');

    await handleIncidentFlow(FROM, '2', null, deps); // Bullying
    await handleIncidentFlow(FROM, '   ', null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'Please describe', 'empty description is rejected, no incident created');
    assert(deps.incidentState.get(`hash_${FROM}`).step === 'awaitingDescription', 'still on awaitingDescription after empty input');
  }

  // ── Excessively long input ───────────────────────────────────────────
  console.log('\n── Length validation ────────────────────────────────────');
  {
    const { deps, sentMessages } = buildDeps();
    await handleIncidentFlow(FROM, 'incident', null, deps);
    await handleIncidentFlow(FROM, '2026-09-01', null, deps);
    await handleIncidentFlow(FROM, '09:30', null, deps);
    await handleIncidentFlow(FROM, '1', null, deps);
    await handleIncidentFlow(FROM, 'x'.repeat(2001), null, deps);
    assertContains(sentMessages[sentMessages.length - 1].text, 'too long', 'excessively long description is rejected');
    assert(deps.incidentState.get(`hash_${FROM}`).step === 'awaitingDescription', 'still on awaitingDescription after an over-length description');
  }

  // ── CANCEL and NO at review ──────────────────────────────────────────
  console.log('\n── CANCEL / NO handling ─────────────────────────────────');
  {
    const { deps, sentMessages, createIncident } = buildDeps();
    await handleIncidentFlow(FROM, 'incident', null, deps);
    await handleIncidentFlow(FROM, 'CANCEL', null, deps);
    assert(deps.incidentState.get(`hash_${FROM}`) === null, 'CANCEL clears the session');
    assertContains(sentMessages[sentMessages.length - 1].text, 'cancelled', 'CANCEL sends a confirmation');
  }
  {
    const { deps, sentMessages, createIncident } = buildDeps();
    await handleIncidentFlow(FROM, 'incident', null, deps);
    await handleIncidentFlow(FROM, '2026-09-01', null, deps);
    await handleIncidentFlow(FROM, '09:30', null, deps);
    await handleIncidentFlow(FROM, '3', null, deps); // Discipline
    await handleIncidentFlow(FROM, 'Something happened.', null, deps);
    await handleIncidentFlow(FROM, 'Spoke to the learner.', null, deps);
    await handleIncidentFlow(FROM, 'NO', null, deps);
    assert(createIncident.callCount() === 0, 'NO at review does not persist anything');
    assert(deps.incidentState.get(`hash_${FROM}`) === null, 'NO clears the session');
  }

  // ── Ownership: phoneHash always server-resolved ──────────────────────
  console.log('\n── Ownership ─────────────────────────────────────────────');
  {
    const { deps, createIncident } = buildDeps();
    await handleIncidentFlow(FROM, 'incident', null, deps);
    await handleIncidentFlow(FROM, '2026-09-01', null, deps);
    await handleIncidentFlow(FROM, '09:30', null, deps);
    await handleIncidentFlow(FROM, '1', null, deps);
    await handleIncidentFlow(FROM, 'desc', null, deps);
    await handleIncidentFlow(FROM, 'action', null, deps);
    await handleIncidentFlow(FROM, 'YES', null, deps);
    assert(createIncident.calls[0][0] === `hash_${FROM}`, 'the persisted phoneHash comes from hashPhone(from), never from message text');
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Incident WhatsApp Flow Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
