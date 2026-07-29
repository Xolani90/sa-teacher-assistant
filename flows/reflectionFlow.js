'use strict';

/**
 * Reflection flow handler (PR28, ADR-011 §2/§3/§4/§7).
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js —
 * same convention as observationFlow.js.
 *
 * Expected deps shape:
 * {
 *   reflectionState,   // SessionStore instance
 *   safeSendMessage,   // async (from, text) => void
 *   parseIntent,       // (text) => intent
 *   hashPhone,         // (from) => phoneHash
 *   createReflection,  // (phoneHash, { content, term, aiAssisted, evidenceLinkIds }) => reflection
 *   getCurrentTerm,    // schoolCalendarRepository: () => number|null
 * }
 *
 * Scope note (PR28): create-only. No evidence step — evidenceLinkIds
 * is always sent as []; PR29 owns evidence linking. No class scoping —
 * the qms_reflections schema (Migration 037) has no class concept.
 * No history/edit/delete sub-flow — that's PR30/PR31.
 *
 * Correction path: reaching reviewSummary and replying NO does not
 * restart the whole flow and does not open a general edit system —
 * it offers a one-shot choice of which single field to redo
 * (awaitingCorrectionChoice), then returns straight back to
 * reviewSummary with that one field replaced. This is deliberately
 * narrower than a real edit/update flow (no arbitrary re-entry, no
 * touching already-saved rows — nothing is persisted until YES) —
 * a full editing subsystem is PR30 territory.
 */

const YES_RE = /^y(es)?$/i;
const NO_RE = /^n(o)?$/i;

/**
 * Builds the review summary message for the current collected fields.
 *
 * @param {{lesson: string, wentWell: string, improvement: string}} fields
 * @returns {string}
 */
function buildReviewSummaryMessage({ lesson, wentWell, improvement }) {
  return (
    `Here's your reflection:\n\n` +
    `*Lesson:*\n${lesson}\n\n` +
    `*What went well:*\n${wentWell}\n\n` +
    `*What I would improve:*\n${improvement}\n\n` +
    `Save this reflection? Reply *YES* or *NO*, or *CANCEL* to discard.`
  );
}

// ── Reflection flow handler ───────────────────────────────────────────────
/**
 * Handles the "log a reflection" conversation. Collects three fixed
 * free-text fields across three separate messages (lesson, what went
 * well, what to improve), shows the teacher a summary of exactly what
 * will be saved, and persists only after they reply YES. Replying NO
 * at the review step offers a lightweight single-field correction
 * before returning to the review summary.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleReflectionFlow(from, text, preClassifiedIntent, deps) {
  const {
    reflectionState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createReflection,
    getCurrentTerm,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = reflectionState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    reflectionState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'reflection') return false;

    reflectionState.set(phoneHash, {
      step: 'awaitingLesson',
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `📝 *Log a Reflection*\n\nWhat lesson is this reflection about?`
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    reflectionState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'awaitingLesson') {
    if (!trimmed) {
      reflectionState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please send a short description of the lesson, or *CANCEL* to stop.`
      );
      return true;
    }

    // Correction path: replace just this field, then go straight back
    // to reviewSummary instead of continuing the forward chain.
    if (state.correcting) {
      const fields = { lesson: trimmed, wentWell: state.wentWell, improvement: state.improvement };
      reflectionState.set(phoneHash, {
        step: 'reviewSummary',
        ...fields,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Updated summary:\n\n` + buildReviewSummaryMessage(fields));
      return true;
    }

    reflectionState.set(phoneHash, {
      step: 'awaitingWentWell',
      lesson: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What went well in this lesson?`);
    return true;
  }

  if (state.step === 'awaitingWentWell') {
    if (!trimmed) {
      reflectionState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please share what went well, or *CANCEL* to stop.`
      );
      return true;
    }

    if (state.correcting) {
      const fields = { lesson: state.lesson, wentWell: trimmed, improvement: state.improvement };
      reflectionState.set(phoneHash, {
        step: 'reviewSummary',
        ...fields,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Updated summary:\n\n` + buildReviewSummaryMessage(fields));
      return true;
    }

    reflectionState.set(phoneHash, {
      step: 'awaitingImprovement',
      lesson: state.lesson,
      wentWell: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What would you improve next time?`);
    return true;
  }

  if (state.step === 'awaitingImprovement') {
    if (!trimmed) {
      reflectionState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please share what you'd improve, or *CANCEL* to stop.`
      );
      return true;
    }

    const fields = { lesson: state.lesson, wentWell: state.wentWell, improvement: trimmed };
    reflectionState.set(phoneHash, {
      step: 'reviewSummary',
      ...fields,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, buildReviewSummaryMessage(fields));
    return true;
  }

  if (state.step === 'reviewSummary') {
    if (YES_RE.test(trimmed)) {
      let term;
      try {
        term = getCurrentTerm();
      } catch (err) {
        console.error('[Reflection] getCurrentTerm failed:', err.message);
        term = null;
      }

      if (term == null) {
        reflectionState.delete(phoneHash);
        await safeSendMessage(from,
          `⚠️ *Couldn't determine the current school term, so this reflection wasn't saved.* ` +
          `Please try again later, or contact support if this keeps happening.`
        );
        return true;
      }

      const content =
        `Lesson:\n${state.lesson}\n\n` +
        `What went well:\n${state.wentWell}\n\n` +
        `What I would improve:\n${state.improvement}`;

      let saveError = null;
      try {
        createReflection(phoneHash, {
          content,
          term,
          aiAssisted: false,
          evidenceLinkIds: [],
        });
      } catch (err) {
        saveError = err;
        console.error('[Reflection] createReflection failed:', err.message);
      }

      reflectionState.delete(phoneHash);

      if (saveError) {
        await safeSendMessage(from,
          `⚠️ *Couldn't save that reflection right now.* Please try sending it again in a moment.`
        );
        return true;
      }

      await safeSendMessage(from, `✅ *Reflection saved successfully.*`);
      return true;
    }

    if (NO_RE.test(trimmed)) {
      reflectionState.set(phoneHash, {
        step: 'awaitingCorrectionChoice',
        lesson: state.lesson,
        wentWell: state.wentWell,
        improvement: state.improvement,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `Which part would you like to change?\n\n` +
        `1. Lesson\n` +
        `2. What went well\n` +
        `3. What I would improve\n` +
        `4. Cancel`
      );
      return true;
    }

    reflectionState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Reply *YES* to save this reflection, *NO* to change something, or *CANCEL* to discard.`
    );
    return true;
  }

  if (state.step === 'awaitingCorrectionChoice') {
    if (trimmed === '4') {
      reflectionState.delete(phoneHash);
      await safeSendMessage(from, `No problem — cancelled.`);
      return true;
    }

    if (trimmed === '1') {
      reflectionState.set(phoneHash, {
        step: 'awaitingLesson',
        lesson: state.lesson,
        wentWell: state.wentWell,
        improvement: state.improvement,
        correcting: true,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `What lesson is this reflection about?`);
      return true;
    }

    if (trimmed === '2') {
      reflectionState.set(phoneHash, {
        step: 'awaitingWentWell',
        lesson: state.lesson,
        wentWell: state.wentWell,
        improvement: state.improvement,
        correcting: true,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `What went well in this lesson?`);
      return true;
    }

    if (trimmed === '3') {
      reflectionState.set(phoneHash, {
        step: 'awaitingImprovement',
        lesson: state.lesson,
        wentWell: state.wentWell,
        improvement: state.improvement,
        correcting: true,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `What would you improve next time?`);
      return true;
    }

    reflectionState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Please reply with a number:\n\n` +
      `1. Lesson\n` +
      `2. What went well\n` +
      `3. What I would improve\n` +
      `4. Cancel`
    );
    return true;
  }

  return false;
}

module.exports = {
  handleReflectionFlow,
};
