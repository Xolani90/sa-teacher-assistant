'use strict';

/**
 * Observation flow handlers — extracted from routes/webhook.js.
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js.
 *
 * Expected deps shape:
 * {
 *   observationState,          // SessionStore instance
 *   observationHistoryState,   // SessionStore instance
 *   safeSendMessage,           // async (from, text) => void
 *   parseIntent,               // (text) => intent
 *   gradeLabel,                // (grade) => string
 *   hashPhone,                 // (from) => phoneHash
 *   processObservationSubmission,
 *   getObservationFormatHelpText,
 *   saveObservationSubmission,
 *   getObservationHistory,
 *   getObservationAssessment,
 *   getTeacherClasses,          // ADR-004: (phoneHash) => Array<{id, name, ...}>
 *   formatClassSelectionPrompt, // ADR-004: (classes) => string
 *   matchClassSelection,        // ADR-004: (text, classes) => class|null
 * }
 */

// ── Observation flow handler ──────────────────────────────────────────────
/**
 * Handles the single-turn "record a Foundation Phase observation" conversation.
 * Collects one raw text block (header + per-learner domain/status/notes),
 * parses and persists it in one round-trip.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleObservationFlow(from, text, preClassifiedIntent, deps) {
  const {
    observationState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    processObservationSubmission,
    getObservationFormatHelpText,
    saveObservationSubmission,
    getTeacherClasses,
    formatClassSelectionPrompt,
    matchClassSelection,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = observationState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    observationState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'observation') return false;

    // ── ADR-004: resolve class context before collecting the observation ──
    // Same 0/1/2+ rule as assessmentFlow.js: auto-use the sole class,
    // ask only when ambiguous, stay unclassed with 0 classes.
    let classes = [];
    try {
      classes = getTeacherClasses(phoneHash);
    } catch (err) {
      console.error('[Observation] getTeacherClasses failed:', err.message);
      classes = []; // fail open into unclassed mode rather than blocking the flow
    }

    if (classes.length >= 2) {
      observationState.set(phoneHash, {
        step: 'awaitingClassSelection',
        pendingClasses: classes.map(c => ({ id: c.id, name: c.name })),
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, formatClassSelectionPrompt(
        classes.map(c => ({ id: c.id, name: c.name }))
      ));
      return true;
    }

    observationState.set(phoneHash, {
      step: 'awaitingObservationText',
      classId: classes.length === 1 ? classes[0].id : null,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `👀 *Record an Observation*\n\n` + getObservationFormatHelpText()
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    observationState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'awaitingClassSelection') {
    const matched = matchClassSelection(text.trim(), state.pendingClasses || []);
    if (!matched) {
      observationState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${(state.pendingClasses || []).length}.\n\n` +
        formatClassSelectionPrompt(state.pendingClasses || [])
      );
      return true;
    }
    observationState.set(phoneHash, {
      step: 'awaitingObservationText',
      classId: matched.id,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `👀 *Record an Observation*\n\n` + getObservationFormatHelpText()
    );
    return true;
  }

  if (state.step === 'awaitingObservationText') {
    const result = processObservationSubmission(text);

    if (!result.success) {
      // Stay in flow — let them fix and resend rather than losing the session
      observationState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `⚠️ *Couldn't read that observation:*\n\n` +
        result.errors.map(e => `• ${e}`).join('\n') +
        `\n\n${result.helpText}`
      );
      return true;
    }

    let saveError = null;
    try {
      saveObservationSubmission(phoneHash, result.header, result.records, state.classId ?? null);
    } catch (err) {
      saveError = err;
      console.error('[WEBHOOK] saveObservationSubmission failed:', err.message);
    }

    observationState.delete(phoneHash);

    if (saveError) {
      await safeSendMessage(from,
        `⚠️ *Couldn't save that observation right now.* Please try sending it again in a moment.`
      );
      return true;
    }

    await safeSendMessage(from,
      `✅ *Observation saved successfully.*\n\n${result.summary}`
    );
    return true;
  }

  return false;
}

// ── Observation history flow handler ──────────────────────────────────────
function formatObservationDate(createdAt) {
  if (!createdAt) return '';
  // SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS'
  const datePart = createdAt.slice(0, 10);
  const d = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return datePart;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Handles MY OBSERVATIONS: shows the teacher's recent saved observation
 * assessments, then lets them reply with a number to view that
 * assessment's detail (learner/record counts, per-domain breakdown).
 *
 * @param {string} from
 * @param {string} text
 * @param {Object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleObservationHistoryFlow(from, text, preClassifiedIntent, deps) {
  const {
    observationHistoryState,
    safeSendMessage,
    parseIntent,
    gradeLabel,
    hashPhone,
    getObservationAssessment,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = observationHistoryState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 15 * 60 * 1000) {
    observationHistoryState.delete(phoneHash);
    return false;
  }

  const trimmed = text.trim();

  // Entry point: not currently in this flow — check if this message
  // triggers it (either a fresh intent classification, or "BACK" from
  // inside the detail view re-entering the list).
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'observationHistory') return false;
    return sendObservationHistoryList(from, phoneHash, deps);
  }

  if (trimmed.toUpperCase() === 'CANCEL') {
    observationHistoryState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'listShown') {
    if (trimmed.toUpperCase() === 'BACK') {
      return sendObservationHistoryList(from, phoneHash, deps);
    }

    const choice = parseInt(trimmed, 10);
    const ids = state.ids || [];
    if (!Number.isInteger(choice) || choice < 1 || choice > ids.length) {
      observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Reply with a number from 1 to ${ids.length} to view that observation, or *BACK* to see the list again.`
      );
      return true;
    }

    const assessmentId = ids[choice - 1];
    let assessment;
    try {
      assessment = getObservationAssessment(assessmentId);
    } catch (err) {
      console.error('[Workspace] getObservationAssessment error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load that observation right now. Please try again.`);
      return true;
    }

    if (!assessment) {
      await safeSendMessage(from, `That observation couldn't be found — it may have been removed. Reply *BACK* to see the list.`);
      return true;
    }

    // Group records by domain for a short breakdown (counts only —
    // no invented commentary beyond what's actually in the records).
    const byDomain = {};
    for (const r of assessment.records) {
      if (!byDomain[r.domain]) byDomain[r.domain] = [];
      byDomain[r.domain].push(r.developmentalStatus);
    }

    const gradeStr = assessment.grade != null ? gradeLabel(assessment.grade === '0' || assessment.grade === 0 ? 0 : assessment.grade) : '—';
    let msg = `📋 *Grade ${gradeStr} ${assessment.subject || ''}*\n`;
    if (assessment.assessmentName) msg += `Assessment: ${assessment.assessmentName}\n`;
    msg += `${formatObservationDate(assessment.createdAt)}\n\n`;
    msg += `Learners: ${new Set(assessment.records.map(r => r.learnerName)).size}\n`;
    msg += `Records: ${assessment.records.length}\n\n`;
    msg += `*By domain:*\n`;
    for (const [domain, statuses] of Object.entries(byDomain)) {
      const counts = {};
      for (const s of statuses) counts[s] = (counts[s] || 0) + 1;
      const breakdown = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
      msg += `• ${domain}: ${breakdown}\n`;
    }
    msg += `\n_Reply *BACK* to see your other observations._`;

    observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from, msg);
    return true;
  }

  return false;
}

/**
 * Fetches and sends the observation history list, storing the
 * displayed number → assessmentId mapping so the next numeric reply
 * can be resolved back to a real assessment.
 */
async function sendObservationHistoryList(from, phoneHash, deps) {
  const {
    observationHistoryState,
    safeSendMessage,
    gradeLabel,
    getObservationHistory,
  } = deps;

  let history;
  try {
    history = getObservationHistory(phoneHash, { limit: 8 });
  } catch (err) {
    console.error('[Workspace] getObservationHistory error:', err.message);
    await safeSendMessage(from, `⚠️ Couldn't load your observations right now. Please try again.`);
    return true;
  }

  if (history.length === 0) {
    observationHistoryState.delete(phoneHash);
    await safeSendMessage(from,
      `👀 *My Observations*\n\nYou haven't saved any observations yet.\n\nReply with an observation to record your first one.`
    );
    return true;
  }

  let msg = `👀 *My Observations*\n\nHere are your most recent observations:\n\n`;
  history.forEach((h, i) => {
    const gradeStr = h.grade != null ? gradeLabel(h.grade === '0' || h.grade === 0 ? 0 : h.grade) : '—';
    msg += `${i + 1}. Grade ${gradeStr} • ${h.subject || 'General'}\n`;
    if (h.assessmentName) msg += `   "${h.assessmentName}"\n`;
    msg += `   ${formatObservationDate(h.createdAt)}\n`;
    msg += `   ${h.learnerCount} learner${h.learnerCount === 1 ? '' : 's'}\n\n`;
  });
  msg += `Reply with the number to view details.`;

  observationHistoryState.set(phoneHash, {
    step: 'listShown',
    ids: history.map(h => h.id),
    lastActivity: Date.now(),
  });

  await safeSendMessage(from, msg);
  return true;
}

module.exports = {
  handleObservationFlow,
  handleObservationHistoryFlow,
  formatObservationDate,
  sendObservationHistoryList,
};
