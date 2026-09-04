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
 *   appendObservationNote,      // (recordId, phoneHash, noteText) => { recordId, notes }|null
 *   deleteObservationAssessment, // (assessmentId, phoneHash) => { assessmentId, deleted }|null
 *   resolveObservationRecord,    // (recordId, phoneHash) => { recordId, resolved }|null
 *   getTeacherClasses,          // ADR-004: (phoneHash) => Array<{id, name, ...}>
 *   formatClassSelectionPrompt, // ADR-004: (classes) => string
 *   matchClassSelection,        // ADR-004: (text, classes) => class|null
 * }
 */

// ── Observation flow handler ──────────────────────────────────────────────
/**
 * Handles the "record a Foundation Phase observation" conversation.
 * Collects raw text blocks (header + per-learner domain/status/notes)
 * across one or more messages — a teacher can log a few learners now
 * and add more later in the same session — then persists everything
 * together once they reply DONE.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * When deps.observationState already has a pending entry with
 * correctsAssessmentId set (placed there externally by
 * handleObservationHistoryFlow's CORRECT command), the collected
 * submission is saved as a correction of that assessment instead of a
 * fresh one — see saveObservationSubmission's correctsAssessmentId param.
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

    // Don't save yet — a teacher observing a class over a morning often
    // wants to log a few learners now and add more later. Hold what's
    // been parsed so far and let them keep appending, rather than
    // forcing everything into one atomic message.
    observationState.set(phoneHash, {
      step: 'collectingRecords',
      classId: state.classId ?? null,
      correctsAssessmentId: state.correctsAssessmentId ?? null,
      header: result.header,
      records: result.records,
      lastActivity: Date.now(),
    });

    await safeSendMessage(from,
      `Got it — ${result.records.length} record${result.records.length === 1 ? '' : 's'} so far.\n\n` +
      `Reply *DONE* to save, send more *Learner:* blocks to add to this same observation, or *CANCEL* to discard.`
    );
    return true;
  }

  if (state.step === 'collectingRecords') {
    if (trimmed.toUpperCase() === 'DONE') {
      const learnerCount = new Set(state.records.map(r => r.learnerName)).size;

      let saveError = null;
      try {
        saveObservationSubmission(
          phoneHash,
          state.header,
          state.records,
          state.classId ?? null,
          state.correctsAssessmentId ?? null
        );
      } catch (err) {
        saveError = err;
        console.error('[WEBHOOK] saveObservationSubmission failed:', err.message);
      }

      if (saveError) {
        // Cycle 20: "already been corrected by another submission" (the
        // observationRepository guard against a duplicate corrector) is
        // a PERMANENT rejection, not a transient save failure — the
        // generic "reply DONE to try again" below would loop forever on
        // this exact error since correctsAssessmentId never changes.
        // Clear state and point the teacher at the version that already
        // won, instead of preserving state for a retry that can't succeed.
        if (saveError.message && saveError.message.includes('already been corrected')) {
          observationState.delete(phoneHash);
          await safeSendMessage(from,
            `⚠️ *This observation was already corrected.*\n\nSomeone beat you to it — a newer version was saved in the meantime. Reply *BACK* to see your other observations and open the latest version instead of resubmitting this one.`
          );
          return true;
        }

        // Preserve state (records, header, and — critically for
        // correction integrity — correctsAssessmentId) so a retry
        // resubmits the same correction rather than silently becoming
        // a brand-new, unlinked observation. Mirrors the preserve-on-
        // failure fix applied to growthPlanFlow.js/reflectionFlow.js
        // in Cycle 10, which this flow was missed by.
        observationState.set(phoneHash, { ...state, lastActivity: Date.now() });
        await safeSendMessage(from,
          `⚠️ *Couldn't save that observation right now.* Nothing was lost — reply *DONE* to try saving it again, or *CANCEL* to discard.`
        );
        return true;
      }

      observationState.delete(phoneHash);

      const correctionNote = state.correctsAssessmentId
        ? `\n\n_This replaces the earlier version — the old one is now marked as corrected._`
        : '';

      await safeSendMessage(from,
        `✅ *Observation saved successfully.*\n\n` +
        `${state.records.length} record${state.records.length === 1 ? '' : 's'} for ${learnerCount} learner${learnerCount === 1 ? '' : 's'}.` +
        correctionNote
      );
      return true;
    }

    // Anything else is treated as more records to add to this same
    // observation — parsed and merged in rather than replacing what's
    // already been collected.
    const more = processObservationSubmission(text);

    if (!more.success) {
      observationState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `⚠️ *Couldn't read that addition:*\n\n` +
        more.errors.map(e => `• ${e}`).join('\n') +
        `\n\nYour ${state.records.length} earlier record${state.records.length === 1 ? '' : 's'} are still safe. ` +
        `Reply *DONE* to save just those, try the addition again, or *CANCEL* to discard everything.`
      );
      return true;
    }

    // Merge headers: keep whatever was already known, only fill in
    // fields that were still missing (header is optional per-chunk once
    // it's already been established for this observation).
    const mergedHeader = {
      assessment: state.header.assessment ?? more.header.assessment,
      grade: state.header.grade ?? more.header.grade,
      subject: state.header.subject ?? more.header.subject,
    };

    const combinedRecords = [...state.records, ...more.records];

    observationState.set(phoneHash, {
      ...state,
      header: mergedHeader,
      records: combinedRecords,
      lastActivity: Date.now(),
    });

    await safeSendMessage(from,
      `Added ${more.records.length} more record${more.records.length === 1 ? '' : 's'}. Total so far: ${combinedRecords.length}.\n\n` +
      `Reply *DONE* to save, add more, or *CANCEL* to discard.`
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
 * Builds the MY OBSERVATIONS detail-view message for a single saved
 * assessment: header, per-domain count breakdown, and — critically — the
 * specific learners who need follow-up, sourced from analyzeObservations()
 * (learner + domain + status + notes for every "Not Yet", and every
 * "Developing" with notes). Previously the detail view only showed tallies;
 * this is the actionable part teachers actually need.
 *
 * Exported via __testExports for regression coverage.
 *
 * @param {object} assessment
 * @param {(grade: any) => string} gradeLabel
 * @param {(records: Array) => {observationsOfConcern: Array}} analyzeObservations
 * @returns {string}
 */
function buildObservationDetailMessage(assessment, gradeLabel, analyzeObservations) {
  // Group records by domain for a short breakdown (counts only —
  // no invented commentary beyond what's actually in the records).
  const byDomain = {};
  for (const r of assessment.records) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r.developmentalStatus);
  }

  const gradeStr = assessment.grade != null ? gradeLabel(assessment.grade === '0' || assessment.grade === 0 ? 0 : assessment.grade) : '—';
  let msg = `📋 *${gradeStr} ${assessment.subject || ''}*\n`;
  if (assessment.assessmentName) msg += `Assessment: ${assessment.assessmentName}\n`;
  msg += `${formatObservationDate(assessment.createdAt)}\n\n`;

  if (assessment.correctsAssessmentId) {
    msg += `_This is a correction of an earlier observation._\n\n`;
  }
  if (assessment.supersededByAssessmentId) {
    msg += `⚠️ *This observation has since been corrected — a newer version exists.*\n\n`;
  }

  msg += `Learners: ${new Set(assessment.records.map(r => r.learnerName)).size}\n`;
  msg += `Records: ${assessment.records.length}\n\n`;
  msg += `*By domain:*\n`;
  for (const [domain, statuses] of Object.entries(byDomain)) {
    const counts = {};
    for (const s of statuses) counts[s] = (counts[s] || 0) + 1;
    const breakdown = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
    msg += `• ${domain}: ${breakdown}\n`;
  }

  // Resolved records are excluded from "Needs follow-up" — once a
  // teacher has worked with a learner and marked it resolved, it
  // shouldn't keep nagging them on every future view of this assessment.
  const unresolvedRecords = assessment.records.filter(r => !r.resolved);
  const analysis = analyzeObservations(unresolvedRecords);
  if (analysis.observationsOfConcern.length > 0) {
    msg += `\n⚠️ *Needs follow-up:*\n`;
    for (const c of analysis.observationsOfConcern) {
      msg += `• ${c.learnerName} — ${c.domain}: ${c.developmentalStatus}\n`;
      if (c.notes) msg += `   "${c.notes}"\n`;
    }
  } else {
    msg += `\n✅ No follow-up needed — all learners on track.\n`;
  }

  // Numbered record list, so a teacher can reference a specific one for
  // ADD NOTE or RESOLVE. Kept separate from the domain breakdown above
  // (which is a summary) — this is the addressable, per-record list.
  msg += `\n*Records:*\n`;
  assessment.records.forEach((r, i) => {
    const resolvedTag = r.resolved ? ' ✅ resolved' : '';
    msg += `${i + 1}. ${r.learnerName} — ${r.domain}: ${r.developmentalStatus}${resolvedTag}\n`;
  });

  msg += `\n_Reply *ADD NOTE*, *CORRECT*, *RESOLVE*, or *DELETE*, or *BACK* to see your other observations._`;
  return msg;
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
    analyzeObservations,
    appendObservationNote,
    deleteObservationAssessment,
    resolveObservationRecord,
    observationState,
    getObservationFormatHelpText,
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

    const msg = buildObservationDetailMessage(assessment, gradeLabel, analyzeObservations);

    // Move into a new 'detailShown' step so ADD NOTE / CORRECT / DELETE /
    // RESOLVE can be handled next turn, carrying forward what's needed
    // to act on this specific assessment and its records.
    observationHistoryState.set(phoneHash, {
      step: 'detailShown',
      ids: state.ids,
      assessmentId: assessment.id,
      assessmentClassId: assessment.classId,
      supersededByAssessmentId: assessment.supersededByAssessmentId,
      recordIds: assessment.records.map(r => r.id),
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, msg);
    return true;
  }

  // Viewing a single assessment's detail — from here a teacher can add a
  // note, correct, resolve a follow-up, or delete the whole thing.
  if (state.step === 'detailShown') {
    if (trimmed.toUpperCase() === 'BACK') {
      return sendObservationHistoryList(from, phoneHash, deps);
    }

    if (trimmed.toUpperCase() === 'ADD NOTE') {
      observationHistoryState.set(phoneHash, {
        step: 'awaitingNoteRecordSelection',
        recordIds: state.recordIds,
        listIds: state.ids,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `Which record would you like to add a note to? Reply with its number (see the list above), or *BACK* to cancel.`
      );
      return true;
    }

    if (trimmed.toUpperCase() === 'CORRECT') {
      if (state.supersededByAssessmentId) {
        // Already corrected once — point them at re-opening the list
        // rather than letting corrections chain confusingly.
        observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
        await safeSendMessage(from,
          `This observation has already been corrected by a newer one. Reply *BACK* to see your other observations and open the latest version instead.`
        );
        return true;
      }

      // Hand off to the observation-collection flow (a different session
      // store), tagged with correctsAssessmentId so the eventual save
      // supersedes this assessment instead of creating an unrelated one.
      observationHistoryState.delete(phoneHash);
      observationState.set(phoneHash, {
        step: 'awaitingObservationText',
        classId: state.assessmentClassId ?? null,
        correctsAssessmentId: state.assessmentId,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `✏️ *Correcting this observation*\n\n` +
        `Send the corrected version in full — it will replace the one you were viewing.\n\n` +
        getObservationFormatHelpText()
      );
      return true;
    }

    if (trimmed.toUpperCase() === 'DELETE') {
      observationHistoryState.set(phoneHash, {
        step: 'awaitingDeleteConfirmation',
        targetAssessmentId: state.assessmentId,
        listIds: state.ids,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `⚠️ Delete this observation permanently? This can't be undone.\n\nReply *CONFIRM* to delete, or *BACK* to cancel.`
      );
      return true;
    }

    if (trimmed.toUpperCase() === 'RESOLVE') {
      observationHistoryState.set(phoneHash, {
        step: 'awaitingResolveRecordSelection',
        recordIds: state.recordIds,
        listIds: state.ids,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `Which record has been resolved? Reply with its number (see the list above), or *BACK* to cancel.`
      );
      return true;
    }

    observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Reply *ADD NOTE*, *CORRECT*, *RESOLVE*, or *DELETE* for this observation, or *BACK* to see your other observations.`
    );
    return true;
  }

  // Teacher is confirming (or backing out of) a delete.
  if (state.step === 'awaitingDeleteConfirmation') {
    if (trimmed.toUpperCase() === 'CONFIRM') {
      let result = null;
      let deleteErr = null;
      try {
        result = deleteObservationAssessment(state.targetAssessmentId, phoneHash);
      } catch (err) {
        deleteErr = err;
        console.error('[Workspace] deleteObservationAssessment error:', err.message);
      }

      observationHistoryState.delete(phoneHash);

      if (deleteErr) {
        await safeSendMessage(from, `⚠️ Couldn't delete that observation right now. Please try again.`);
        return true;
      }

      if (!result) {
        await safeSendMessage(from, `That observation was already gone.`);
        return true;
      }

      await safeSendMessage(from, `🗑️ Observation deleted.`);
      return true;
    }

    // Any other reply (including BACK) cancels the delete without acting.
    observationHistoryState.set(phoneHash, {
      step: 'listShown',
      ids: state.listIds,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `Cancelled — nothing was deleted. Reply *BACK* to see your other observations, or a number to view detail again.`
    );
    return true;
  }

  // Teacher is picking which record to mark resolved.
  if (state.step === 'awaitingResolveRecordSelection') {
    if (trimmed.toUpperCase() === 'BACK') {
      observationHistoryState.set(phoneHash, {
        step: 'listShown',
        ids: state.listIds,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Cancelled. Reply *BACK* to see your other observations, or a number to view detail again.`);
      return true;
    }

    const recordChoice = parseInt(trimmed, 10);
    const recordIds = state.recordIds || [];
    if (!Number.isInteger(recordChoice) || recordChoice < 1 || recordChoice > recordIds.length) {
      observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${recordIds.length}, or *BACK* to cancel.`
      );
      return true;
    }

    const targetRecordId = recordIds[recordChoice - 1];
    let result = null;
    try {
      result = resolveObservationRecord(targetRecordId, phoneHash);
    } catch (err) {
      console.error('[Workspace] resolveObservationRecord error:', err.message);
      observationHistoryState.delete(phoneHash);
      await safeSendMessage(from, `⚠️ Couldn't mark that as resolved right now. Please try again.`);
      return true;
    }

    observationHistoryState.delete(phoneHash);

    if (!result) {
      await safeSendMessage(from, `That record couldn't be found — it may have changed. Please view the observation again.`);
      return true;
    }

    await safeSendMessage(from, `✅ Marked as resolved — it won't show under "Needs follow-up" anymore.`);
    return true;
  }

  // Teacher is picking which record to annotate.
  if (state.step === 'awaitingNoteRecordSelection') {
    if (trimmed.toUpperCase() === 'BACK') {
      observationHistoryState.set(phoneHash, {
        step: 'listShown',
        ids: state.listIds,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Cancelled. Reply *BACK* to see your other observations, or a number to view detail again.`);
      return true;
    }

    const recordChoice = parseInt(trimmed, 10);
    const recordIds = state.recordIds || [];
    if (!Number.isInteger(recordChoice) || recordChoice < 1 || recordChoice > recordIds.length) {
      observationHistoryState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please reply with a number from 1 to ${recordIds.length}, or *BACK* to cancel.`
      );
      return true;
    }

    observationHistoryState.set(phoneHash, {
      step: 'awaitingNoteText',
      targetRecordId: recordIds[recordChoice - 1],
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What would you like to note? Send your note as a message, or *BACK* to cancel.`);
    return true;
  }

  // Teacher is typing the note itself.
  if (state.step === 'awaitingNoteText') {
    if (trimmed.toUpperCase() === 'BACK') {
      observationHistoryState.delete(phoneHash);
      await safeSendMessage(from, `Cancelled — note not added.`);
      return true;
    }

    let result;
    try {
      result = appendObservationNote(state.targetRecordId, phoneHash, trimmed);
    } catch (err) {
      console.error('[Workspace] appendObservationNote error:', err.message);
      observationHistoryState.delete(phoneHash);
      await safeSendMessage(from, `⚠️ Couldn't save that note right now. Please try again from the start.`);
      return true;
    }

    observationHistoryState.delete(phoneHash);

    if (!result) {
      await safeSendMessage(from, `That record couldn't be found — it may have changed. Please view the observation again.`);
      return true;
    }

    await safeSendMessage(from, `✅ Note added.`);
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
    msg += `${i + 1}. ${gradeStr} • ${h.subject || 'General'}\n`;
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
  buildObservationDetailMessage,
  __testExports: {
    buildObservationDetailMessage,
  },
};
