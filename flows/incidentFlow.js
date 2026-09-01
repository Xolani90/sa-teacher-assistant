'use strict';

/**
 * Teacher Incident Book flow (Feature 3).
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js —
 * same convention as reflectionFlow.js/growthPlanFlow.js.
 *
 * Expected deps shape:
 * {
 *   incidentState,    // SessionStore instance
 *   safeSendMessage,  // async (from, text) => void
 *   parseIntent,      // (text) => intent
 *   hashPhone,        // (from) => phoneHash
 *   createIncident,   // (phoneHash, params) => incident  (services/incidentService.js)
 * }
 *
 * Scope: create-only over WhatsApp, mirroring reflectionFlow.js/
 * growthPlanFlow.js's own create-only scope — editing an incident is a
 * dashboard-only affordance for now (Feature 3's dashboard PATCH route),
 * same "create on WhatsApp, edit on dashboard" split already established
 * for reflections/growth plans.
 *
 * Date/time capture: this codebase has no free-text date/time parser
 * (utils/dateUtils.js only has parseSqliteUtc for reading DB timestamps
 * back out), so — unlike a hypothetical NLP date parser — the teacher is
 * asked for the exact YYYY-MM-DD / HH:MM (24h) format and validated with
 * incidentService's own isValidIncidentDate/isValidIncidentTime, with a
 * clear retry prompt on a bad value. This keeps exactly one date/time
 * validation definition in the codebase (the service), rather than a
 * second parser living in this flow.
 *
 * Persistence: nothing is written until the teacher confirms YES at the
 * review step — same "review before save" convention as
 * reflectionFlow.js/growthPlanFlow.js. All persistence goes through
 * incidentService.createIncident(phoneHash, params) — this flow never
 * touches the database directly, so the incident is immediately visible
 * to the dashboard (same table, same service).
 */

const { isValidIncidentDate, isValidIncidentTime } = require('../services/incidentService');
const { listIncidentTypesOrdered, isValidIncidentType } = require('../utils/incidentTypes');

const YES_RE = /^y(es)?$/i;
const NO_RE = /^n(o)?$/i;

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ACTION_LENGTH = 1000;

/**
 * Renders the numbered incident-type menu in taxonomy order.
 * @returns {string}
 */
function formatIncidentTypeMenu() {
  const lines = listIncidentTypesOrdered().map((t, i) => `${i + 1}. ${t.label}`);
  return `What type of incident was it?\n\n${lines.join('\n')}`;
}

/**
 * Resolves a numbered-menu reply (or a typed type id/label) to an
 * incident type id. Returns null if the reply doesn't match anything.
 * @param {string} trimmed
 * @returns {string|null}
 */
function resolveIncidentTypeSelection(trimmed) {
  const ordered = listIncidentTypesOrdered();
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= ordered.length) {
    return ordered[asNumber - 1].id;
  }
  const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (isValidIncidentType(upper)) return upper;
  const byLabel = ordered.find((t) => t.label.toLowerCase() === trimmed.toLowerCase());
  return byLabel ? byLabel.id : null;
}

/**
 * @param {{incidentDate:string, incidentTime:string, incidentType:string, description:string, actionTaken:string}} fields
 * @returns {string}
 */
function buildReviewSummaryMessage({ incidentDate, incidentTime, incidentType, description, actionTaken }) {
  const typeLabel = listIncidentTypesOrdered().find((t) => t.id === incidentType)?.label || incidentType;
  return (
    `Here's the incident:\n\n` +
    `*Date:* ${incidentDate}\n` +
    `*Time:* ${incidentTime}\n` +
    `*Type:* ${typeLabel}\n` +
    `*What happened:*\n${description}\n\n` +
    `*Action taken / follow-up:*\n${actionTaken}\n\n` +
    `Save this incident to the Incident Book? Reply *YES* or *NO*, or *CANCEL* to discard.`
  );
}

/**
 * Handles the "log an incident" conversation. Collects date, time,
 * incident type, description, and action taken across separate
 * messages, shows the teacher a review summary, and persists only
 * after they reply YES.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleIncidentFlow(from, text, preClassifiedIntent, deps) {
  const { incidentState, safeSendMessage, parseIntent, hashPhone, createIncident } = deps;

  const phoneHash = hashPhone(from);
  const state = incidentState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    incidentState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'incident') return false;

    incidentState.set(phoneHash, {
      step: 'awaitingDate',
      lastActivity: Date.now(),
    });
    await safeSendMessage(
      from,
      `📋 *Incident Book*\n\nWhat date did the incident occur? (YYYY-MM-DD, e.g. 2026-09-01)`
    );
    return true;
  }

  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper === 'CANCEL') {
    incidentState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'awaitingDate') {
    if (!isValidIncidentDate(trimmed)) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(
        from,
        `That doesn't look like a valid date. Please send it as YYYY-MM-DD (e.g. 2026-09-01), or *CANCEL* to stop.`
      );
      return true;
    }
    incidentState.set(phoneHash, {
      ...state,
      step: 'awaitingTime',
      incidentDate: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What time did it occur? (24-hour HH:MM, e.g. 14:30)`);
    return true;
  }

  if (state.step === 'awaitingTime') {
    if (!isValidIncidentTime(trimmed)) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(
        from,
        `That doesn't look like a valid time. Please send it as 24-hour HH:MM (e.g. 14:30), or *CANCEL* to stop.`
      );
      return true;
    }
    incidentState.set(phoneHash, {
      ...state,
      step: 'awaitingType',
      incidentTime: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, formatIncidentTypeMenu());
    return true;
  }

  if (state.step === 'awaitingType') {
    const typeId = resolveIncidentTypeSelection(trimmed);
    if (!typeId) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(
        from,
        `Please choose a number from the list, or *CANCEL* to stop.\n\n${formatIncidentTypeMenu()}`
      );
      return true;
    }
    incidentState.set(phoneHash, {
      ...state,
      step: 'awaitingDescription',
      incidentType: typeId,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `Please describe what happened.`);
    return true;
  }

  if (state.step === 'awaitingDescription') {
    if (!trimmed) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from, `Please describe what happened, or *CANCEL* to stop.`);
      return true;
    }
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(
        from,
        `That description is too long (max ${MAX_DESCRIPTION_LENGTH} characters). Please shorten it and resend, or *CANCEL* to stop.`
      );
      return true;
    }
    incidentState.set(phoneHash, {
      ...state,
      step: 'awaitingAction',
      description: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What action was taken or what follow-up is required?`);
    return true;
  }

  if (state.step === 'awaitingAction') {
    if (!trimmed) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from, `Please share the action taken, or *CANCEL* to stop.`);
      return true;
    }
    if (trimmed.length > MAX_ACTION_LENGTH) {
      incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(
        from,
        `That's too long (max ${MAX_ACTION_LENGTH} characters). Please shorten it and resend, or *CANCEL* to stop.`
      );
      return true;
    }
    const fields = {
      incidentDate: state.incidentDate,
      incidentTime: state.incidentTime,
      incidentType: state.incidentType,
      description: state.description,
      actionTaken: trimmed,
    };
    incidentState.set(phoneHash, {
      ...state,
      step: 'reviewSummary',
      actionTaken: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, buildReviewSummaryMessage(fields));
    return true;
  }

  if (state.step === 'reviewSummary') {
    if (YES_RE.test(trimmed)) {
      try {
        await createIncident(phoneHash, {
          incidentDate: state.incidentDate,
          incidentTime: state.incidentTime,
          incidentType: state.incidentType,
          description: state.description,
          actionTaken: state.actionTaken,
        });
      } catch (err) {
        incidentState.delete(phoneHash);
        await safeSendMessage(
          from,
          `Sorry, something went wrong saving that incident. Please try again with *INCIDENT*.`
        );
        return true;
      }
      incidentState.delete(phoneHash);
      await safeSendMessage(from, `✅ Incident recorded successfully.`);
      return true;
    }
    if (NO_RE.test(trimmed)) {
      incidentState.delete(phoneHash);
      await safeSendMessage(from, `No problem — discarded. Send *INCIDENT* to start again.`);
      return true;
    }
    incidentState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from, `Please reply *YES* to save, *NO* to discard, or *CANCEL* to stop.`);
    return true;
  }

  // Defensive fallback: unknown step, treat as no active flow.
  incidentState.delete(phoneHash);
  return false;
}

module.exports = { handleIncidentFlow, formatIncidentTypeMenu, resolveIncidentTypeSelection };
